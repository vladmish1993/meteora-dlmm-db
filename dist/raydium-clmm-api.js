import fs from "fs";
import path from "path";
import { ApiThrottleCache } from "./util";
const CACHE_FILE = "raydium-clmm-cache.ts";
const CACHE_PATH = path.resolve(__dirname, "./" + CACHE_FILE);
/* -------------------------------- constants ------------------------------- */
const POOL_INFO_BY_ID = "https://api-v3.raydium.io/pools/info/ids?ids=";
const RAYDIUM_API = "https://api-v3.raydium.io";
let fileCache = {
    lastUpdated: "",
    pairs: [],
};
if (fs.existsSync(CACHE_PATH)) {
    console.log('Raydium CACHE exists');
    fileCache = require("./raydium-clmm-cache").default;
}
else {
    console.log('Raydium CACHE NOT exists');
}
export const CLMM_CACHE = fileCache;
/** Map<pool-address, RaydiumClmmPairData> rebuilt on boot */
export const CLMM_MAP = new Map(CLMM_CACHE.pairs.map((arr) => {
    const [lbPair, name, xSymbol, ySymbol, mintX, mintY, tickSpacing, feeRate, feeBps, price, tvl, feeAprDay, feeAprWeek, feeAprMonth,] = arr;
    return [
        lbPair,
        {
            lbPair, name, xSymbol, ySymbol, mintX, mintY,
            tickSpacing, feeRate, feeBps, price, tvl,
            feeAprDay, feeAprWeek, feeAprMonth,
        },
    ];
}));
/* ───────────────  Throttle parameters  ─────────────── */
const MAX_CONCURRENT_REQUESTS = 10;
const DELAY_MS = 3000;
export class RaydiumClmmApi {
    // @ts-ignore
    static _throttle = new ApiThrottleCache(MAX_CONCURRENT_REQUESTS, DELAY_MS);
    static updateThrottleParameters(params) {
        RaydiumClmmApi._throttle.max = params.max;
        RaydiumClmmApi._throttle.interval = params.interval;
    }
    /* ------------------------------------------------------------------ */
    /*                      SINGLE-PAIR public helper                      */
    /* ------------------------------------------------------------------ */
    /** Cached + throttled fetch of a single CLMM pool */
    static getClmmPairData(poolId) {
        return this._throttle.processItem(poolId, this._fetchPairData);
    }
    /* ------------------------------------------------------------------ */
    /*                    ALL-PAIRS list public helper                     */
    /* ------------------------------------------------------------------ */
    static async getAllRaydiumPairDetails() {
        const pageSize = 1_000; // we keep the existing pageSize=1000
        let page = 1;
        let hasNext = true;
        const result = [];
        while (hasNext) {
            const url = `${RAYDIUM_API}` +
                `/pools/info/list` +
                `?poolType=concentrated` +
                `&poolSortField=default` +
                `&sortType=desc` +
                `&pageSize=${pageSize}` +
                `&page=${page}`;
            const resp = await fetch(url);
            if (!resp.ok) {
                throw new Error(`Raydium API page ${page} → ${resp.status} ${resp.statusText}`);
            }
            const outer = (await resp.json());
            if (!outer.success || !outer.data)
                break;
            // transform & push into our running array
            const transformed = outer.data.data.map(this.extractRaydiumPairData);
            result.push(...transformed);
            // advance pagination
            hasNext = outer.data.hasNextPage;
            page += 1;
        }
        return result;
    }
    /* `getAllClmmPairDetails` kept for backwards-compat */
    static getAllClmmPairDetails = RaydiumClmmApi.getAllRaydiumPairDetails;
    /* ------------------------------------------------------------------ */
    /*                       Pure data-massage helpers                     */
    /* ------------------------------------------------------------------ */
    /** turn Raydium’s verbose JSON into our compact `RaydiumClmmPairData` */
    static extractRaydiumPairData(item) {
        const { id: lbPair, mintA, mintB, feeRate, config: { tickSpacing }, price, tvl, day, week, month, } = item;
        const xSymbol = mintA.symbol;
        const ySymbol = mintB.symbol;
        const name = `${xSymbol}-${ySymbol}`;
        const feeBps = Math.round(feeRate * 1e6) / 100; // 0.0004 → 40
        return {
            lbPair,
            name,
            xSymbol,
            ySymbol,
            mintX: mintA.address,
            mintY: mintB.address,
            tickSpacing,
            feeRate,
            feeBps,
            price,
            tvl,
            feeAprDay: day?.apr ?? 0,
            feeAprWeek: week?.apr ?? 0,
            feeAprMonth: month?.apr ?? 0,
        };
    }
    /* ------------------------------------------------------------------ */
    /*                    INTERNAL  ―  single-pair fetch                   */
    /* ------------------------------------------------------------------ */
    static async _fetchPairData(poolId) {
        try {
            const resp = await fetch(POOL_INFO_BY_ID + poolId);
            const text = await resp.text();
            /* Raydium sometimes returns a Cloudflare HTML page → detect early */
            if (text.trim().startsWith("<")) {
                console.error(`HTML instead of JSON for pool ${poolId} – likely rate-limited`);
                return null;
            }
            const json = JSON.parse(text);
            const raw = json.data?.[0];
            return raw ? this.extractRaydiumPairData(raw) : null;
        }
        catch (e) {
            console.error(`Raydium pair ${poolId} fetch error:`, e);
            return null;
        }
    }
}
/* ----------------------------------------------------------------------
 *  Stand-alone re-exports  (so external code that previously imported
 *  the helpers directly continues to compile unchanged)
 * -------------------------------------------------------------------- */
export const extractRaydiumPairData = (item) => RaydiumClmmApi.extractRaydiumPairData(item);
export const getAllRaydiumPairDetails = () => RaydiumClmmApi.getAllRaydiumPairDetails();
export const getAllClmmPairDetails = getAllRaydiumPairDetails;
//# sourceMappingURL=raydium-clmm-api.js.map