import fs from "fs";
import path from "path";
import {ApiThrottleCache} from "./util";
import {RaydiumClmmAccounts, RaydiumInstructionType, TokenTransferInfo} from "./raydium-instruction-parser";

const CACHE_FILE = "raydium-clmm-cache.ts";
const CACHE_PATH = path.resolve(
    __dirname,
    "./" + CACHE_FILE,
);

/* -------------------------------- constants ------------------------------- */
const POOL_INFO_BY_ID = "https://api-v3.raydium.io/pools/info/ids?ids=";
const RAYDIUM_API = "https://api-v3.raydium.io";

type RaydiumClmmPairDataArray = [
    /* 0  */ string,   // lbPair
    /* 1  */ string,   // name
    /* 2  */ string,   // xSymbol
    /* 3  */ string,   // ySymbol
    /* 4  */ string,   // mintX
    /* 5  */ string,   // mintY
    /* 6  */ number,   // tickSpacing
    /* 7  */ number,   // feeRate
    /* 8  */ number,   // feeBps
    /* 9  */ number,   // price
    /* 10 */ number,   // tvl
    /* 11 */ number,   // feeAprDay
    /* 12 */ number,   // feeAprWeek
    /* 13 */ number,   // feeAprMonth
];

let fileCache: { lastUpdated: string; pairs: RaydiumClmmPairDataArray[] } = {
    lastUpdated: "",
    pairs: [],
};

if (fs.existsSync(CACHE_PATH)) {
    console.log('Raydium CACHE exists')

    fileCache = require("./raydium-clmm-cache").default;
}
else {
    console.log('Raydium CACHE NOT exists')
}

export const CLMM_CACHE = fileCache;

/** Map<pool-address, RaydiumClmmPairData> rebuilt on boot */
export const CLMM_MAP: Map<string, RaydiumClmmPairData> = new Map(
    CLMM_CACHE.pairs.map((arr) => {
        const [
            lbPair, name, xSymbol, ySymbol, mintX, mintY,
            tickSpacing, feeRate, feeBps, price, tvl,
            feeAprDay, feeAprWeek, feeAprMonth,
        ] = arr;
        return [
            lbPair,
            {
                lbPair, name, xSymbol, ySymbol, mintX, mintY,
                tickSpacing, feeRate, feeBps, price, tvl,
                feeAprDay, feeAprWeek, feeAprMonth,
            } satisfies RaydiumClmmPairData,
        ];
    }),
);

/* ---------------------------------- types --------------------------------- */
export interface RaydiumUsdTx {
    signature: string;
    slot: number;
    blockTime: number;
    usd: number;
}

interface RaydiumClmmPairDetail {
    id: string;
    mintA: { address: string; symbol: string };
    mintB: { address: string; symbol: string };
    feeRate: number; // e.g. 0.0004
    config: { tickSpacing: number; tradeFeeRate: number; protocolFeeRate: number; fundFeeRate: number };
    price: number;
    tvl: number;
    day?: { apr: number };
    week?: { apr: number };
    month?: { apr: number };
}

export interface RaydiumClmmPairData {
    /** pool_state address */
    lbPair: string;
    name: string; // e.g. "WSOL‑USDC"
    xSymbol: string;
    ySymbol: string;
    mintX: string;
    mintY: string;
    /* pool parameters */
    tickSpacing: number;
    feeRate: number; // raw, 0.0004
    feeBps: number; // 40
    price: number;
    tvl: number;
    feeAprDay: number;
    feeAprWeek: number;
    feeAprMonth: number;
}

export interface RaydiumClmmInstruction {
    signature: string;
    slot: number;
    blockTime: number;
    instructionName: string;
    instructionType: RaydiumInstructionType;
    accounts: RaydiumClmmAccounts;
    tokenTransfers: TokenTransferInfo[];
    activeBinId?: number | null;
    removalBps?: number | null;
}

/* ───────────────  Throttle parameters  ─────────────── */
const MAX_CONCURRENT_REQUESTS = 10;
const DELAY_MS = 3000;

export class RaydiumClmmApi {

    // @ts-ignore
    private static _throttle = new ApiThrottleCache<string | { positionAddress: string; endpoint: string },
        any>(MAX_CONCURRENT_REQUESTS, DELAY_MS);

    static updateThrottleParameters(params: { max: number; interval: number }) {
        RaydiumClmmApi._throttle.max = params.max;
        RaydiumClmmApi._throttle.interval = params.interval;
    }

    /* ------------------------------------------------------------------ */
    /*                      SINGLE-PAIR public helper                      */

    /* ------------------------------------------------------------------ */

    /** Cached + throttled fetch of a single CLMM pool */
    static getClmmPairData(poolId: string): Promise<RaydiumClmmPairData | null> {
        return this._throttle.processItem(poolId, this._fetchPairData);
    }

    /* ------------------------------------------------------------------ */
    /*                    ALL-PAIRS list public helper                     */

    /* ------------------------------------------------------------------ */

    static async getAllRaydiumPairDetails(): Promise<RaydiumClmmPairData[]> {
        const pageSize = 1_000;          // we keep the existing pageSize=1000
        let  page      = 1;
        let  hasNext   = true;
        const result: RaydiumClmmPairData[] = [];

        while (hasNext) {
            const url =
                `${RAYDIUM_API}` +
                `/pools/info/list` +
                `?poolType=concentrated` +
                `&poolSortField=default` +
                `&sortType=desc` +
                `&pageSize=${pageSize}` +
                `&page=${page}`;

            const resp = await fetch(url);
            if (!resp.ok) {
                throw new Error(
                    `Raydium API page ${page} → ${resp.status} ${resp.statusText}`,
                );
            }

            const outer = (await resp.json()) as {
                success: boolean;
                data?: {
                    hasNextPage: boolean;
                    data: RaydiumClmmPairDetail[];
                };
            };

            if (!outer.success || !outer.data) break;

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
    static extractRaydiumPairData(
        item: RaydiumClmmPairDetail,
    ): RaydiumClmmPairData {
        const {
            id: lbPair,
            mintA, mintB,
            feeRate,
            config: {tickSpacing},
            price, tvl,
            day, week, month,
        } = item;

        const xSymbol = mintA.symbol;
        const ySymbol = mintB.symbol;
        const name = `${xSymbol}-${ySymbol}`;
        const feeBps = Math.round(feeRate * 1e6) / 100;   // 0.0004 → 40

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

    private static async _fetchPairData(
        poolId: string,
    ): Promise<RaydiumClmmPairData | null> {
        try {
            const resp = await fetch(POOL_INFO_BY_ID + poolId);
            const text = await resp.text();

            /* Raydium sometimes returns a Cloudflare HTML page → detect early */
            if (text.trim().startsWith("<")) {
                console.error(
                    `HTML instead of JSON for pool ${poolId} – likely rate-limited`,
                );
                return null;
            }
            const json = JSON.parse(text);
            const raw = json.data?.[0] as RaydiumClmmPairDetail | undefined;
            return raw ? this.extractRaydiumPairData(raw) : null;

        } catch (e) {
            console.error(`Raydium pair ${poolId} fetch error:`, e);
            return null;
        }
    }
}

/* ----------------------------------------------------------------------
 *  Stand-alone re-exports  (so external code that previously imported
 *  the helpers directly continues to compile unchanged)
 * -------------------------------------------------------------------- */
export const extractRaydiumPairData = (
    item: RaydiumClmmPairDetail,
): RaydiumClmmPairData =>
    RaydiumClmmApi.extractRaydiumPairData(item);
export const getAllRaydiumPairDetails = (): Promise<RaydiumClmmPairData[]> =>
    RaydiumClmmApi.getAllRaydiumPairDetails();
export const getAllClmmPairDetails = getAllRaydiumPairDetails;
