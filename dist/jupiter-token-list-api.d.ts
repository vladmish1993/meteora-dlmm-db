export declare const TOKEN_MAP: Map<string, TokenMeta>;
export type TokenMetaArray = [
    address: string,
    name: string,
    symbol: string,
    decimals: number,
    logoURI: string
];
export interface TokenMeta {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    logoURI: string;
}
export declare class JupiterTokenListApi {
    #private;
    static _ensureLoaded(): Promise<void>;
    static getToken(address: string): Promise<TokenMeta | null>;
}
export declare function getFullJupiterTokenList(): Promise<TokenMeta[]>;
export declare function _getJupiterPrices(mints: string[]): Promise<Record<string, number>>;
