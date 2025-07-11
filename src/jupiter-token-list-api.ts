import {ApiThrottleCache} from "./util";
import path from "path";
import fs from "fs";

const CACHE_FILE = "jupiter-token-list-cache.ts";
const TOKEN_CACHE_PATH = path.resolve(
    __dirname,
    "./" + CACHE_FILE,
);

/* ------------------------------------------------------------------ */
/* 1.  LOAD the cache (if present)                                    */
/* ------------------------------------------------------------------ */
type RawCache = { lastUpdated: string; tokens: TokenMetaArray[] };
let rawCache: RawCache = {lastUpdated: "", tokens: []};

if (fs.existsSync(TOKEN_CACHE_PATH)) {
    console.log('Jupiter CACHE exists')
    rawCache = (await import("./" + CACHE_FILE)).default as RawCache;
} else {
    console.log('Jupiter CACHE NOT exists')
}

const JUPITER_TOKEN_LIST_API = "https://tokens.jup.ag";
const PRICE_API = "https://api.jup.ag/price/v2?vsToken=USDC&ids=";
/** Jupiter allows ±20 price queries / s without an API-key */
const priceThrottle = new ApiThrottleCache(20, 1_000);

export const TOKEN_MAP: Map<string, TokenMeta> = new Map(
    rawCache.tokens.map(([address, name, symbol, decimals, logoURI]) => [
        address,
        {address, name, symbol, decimals, logoURI},
    ]),
);

interface JupiterTokenListToken {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI: string;
    tags: string[];
    daily_volume: number;
}

export type TokenMetaArray = [
    address: string,
    name: string,
    symbol: string,
    decimals: number,
    logoURI: string,
];

export interface TokenMeta {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI: string;
}

export class JupiterTokenListApi {
    /** will be populated the first time someone calls `getToken` */
    static #loaded = false;

    static async _ensureLoaded() {
        if (this.#loaded) return;
        const list = await getFullJupiterTokenList();
        list.forEach(t => TOKEN_MAP.set(t.address, t));
        this.#loaded = true;
    }

    static async getToken(address: string): Promise<TokenMeta | null> {
        await this._ensureLoaded();
        return TOKEN_MAP.get(address) ?? null;
    }
}

export async function getFullJupiterTokenList(): Promise<TokenMeta[]> {
    const response = await fetch(JUPITER_TOKEN_LIST_API + "/tokens_with_markets");
    const data = await response.json() as JupiterTokenListToken[];

    return data.map((token) => {
        const {address, name, symbol, decimals, logoURI} = token;
        return {address, name, symbol, decimals, logoURI};
    });
}

export async function _getJupiterPrices(mints: string[]): Promise<Record<string, number>> {
    const ids = [...new Set(mints)].join(",");
    return priceThrottle.processItem(ids, async () => {
        const res = await fetch(PRICE_API + ids);
        const json = await res.json();
        const out: Record<string, number> = {};
        for (const k in json.data) out[k] = Number(json.data[k].price);
        return out;
    });
}

