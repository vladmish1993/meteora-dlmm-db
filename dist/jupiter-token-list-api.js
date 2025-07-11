import { ApiThrottleCache } from "./util";
import path from "path";
import fs from "fs";
const CACHE_FILE = "jupiter-token-list-cache.ts";
const TOKEN_CACHE_PATH = path.resolve(__dirname, "./" + CACHE_FILE);
let rawCache = { lastUpdated: "", tokens: [] };
if (fs.existsSync(TOKEN_CACHE_PATH)) {
    console.log('Jupiter CACHE exists');
    rawCache = (await import("./" + CACHE_FILE)).default;
}
else {
    console.log('Jupiter CACHE NOT exists');
}
const JUPITER_TOKEN_LIST_API = "https://tokens.jup.ag";
const PRICE_API = "https://api.jup.ag/price/v2?vsToken=USDC&ids=";
/** Jupiter allows ±20 price queries / s without an API-key */
const priceThrottle = new ApiThrottleCache(20, 1_000);
export const TOKEN_MAP = new Map(rawCache.tokens.map(([address, name, symbol, decimals, logoURI]) => [
    address,
    { address, name, symbol, decimals, logoURI },
]));
export class JupiterTokenListApi {
    /** will be populated the first time someone calls `getToken` */
    static #loaded = false;
    static async _ensureLoaded() {
        if (this.#loaded)
            return;
        const list = await getFullJupiterTokenList();
        list.forEach(t => TOKEN_MAP.set(t.address, t));
        this.#loaded = true;
    }
    static async getToken(address) {
        await this._ensureLoaded();
        return TOKEN_MAP.get(address) ?? null;
    }
}
export async function getFullJupiterTokenList() {
    const response = await fetch(JUPITER_TOKEN_LIST_API + "/tokens_with_markets");
    const data = await response.json();
    return data.map((token) => {
        const { address, name, symbol, decimals, logoURI } = token;
        return { address, name, symbol, decimals, logoURI };
    });
}
export async function _getJupiterPrices(mints) {
    const ids = [...new Set(mints)].join(",");
    return priceThrottle.processItem(ids, async () => {
        const res = await fetch(PRICE_API + ids);
        const json = await res.json();
        const out = {};
        for (const k in json.data)
            out[k] = Number(json.data[k].price);
        return out;
    });
}
//# sourceMappingURL=jupiter-token-list-api.js.map