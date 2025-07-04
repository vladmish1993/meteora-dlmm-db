import cache from "./jupiter-token-list-cache";
import { ApiThrottleCache } from "./util";

const JUPITER_TOKEN_LIST_API = "https://tokens.jup.ag";
const PRICE_API = "https://api.jup.ag/price/v2?vsToken=USDC&ids=";
/** Jupiter allows ±20 price queries / s without an API-key */
const priceThrottle = new ApiThrottleCache(20, 1_000);
const MAX_CONCURRENT_REQUESTS = 10;
const DELAY_MS = 30 * 1000;
const JUPITER_TOKEN_LIST_CACHE = cache as {
  lastUpdated: string;
  ignore: string[];
  tokens: TokenMetaArray[];
};
export const TOKEN_MAP: Map<string, TokenMeta> = new Map(
  JUPITER_TOKEN_LIST_CACHE.tokens.map((array) => {
    const [address, name, symbol, decimals, logoURI] = array;
    return [array[0], { address, name, symbol, decimals, logoURI }];
  }),
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

export async function getFullJupiterTokenList(): Promise<TokenMeta[]> {
  const response = await fetch(JUPITER_TOKEN_LIST_API + "/tokens_with_markets");
  const responseText = await response.text();

  const data = JSON.parse(responseText) as JupiterTokenListToken[];

  return data.map((token) => {
    const { address, name, symbol, decimals, logoURI } = token;
    return { address, name, symbol, decimals, logoURI };
  });
}

export class JupiterTokenListApi {
  private static _api = new ApiThrottleCache(
    MAX_CONCURRENT_REQUESTS,
    DELAY_MS,
    TOKEN_MAP,
    this._getToken,
  );

  static updateThrottleParameters(params: { max: number; interval: number }) {
    JupiterTokenListApi._api.max = params.max;
    JupiterTokenListApi._api.interval = params.interval;
  }

  static getToken(address: string): Promise<TokenMeta | null> {
    return JupiterTokenListApi._api.processItem(address, this._getToken);
  }

  private static async _getToken(address: string): Promise<TokenMeta | null> {
    const response = await fetch(JUPITER_TOKEN_LIST_API + `/token/${address}`);
    if (response.status == 429) {
      throw new Error(`Too many requests made to Jupiter API`);
    }
    const token = JSON.parse(
      await response.text(),
    ) as JupiterTokenListToken | null;
    if (token == null || !token.address) {
      return null;
    }
    const { name, symbol, decimals, logoURI } = token;
    return { address: token.address, name, symbol, decimals, logoURI };
  }
}

export async function _getJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(mints)].join(",");
  return priceThrottle.processItem(ids, async () => {
    const res  = await fetch(PRICE_API + ids);
    const json = await res.json();
    const out: Record<string, number> = {};
    for (const k in json.data) out[k] = Number(json.data[k].price);
    return out;
  });
}

