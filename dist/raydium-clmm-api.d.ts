import { RaydiumClmmAccounts, RaydiumInstructionType, TokenTransferInfo } from "./raydium-instruction-parser";
type RaydiumClmmPairDataArray = [
    string,
    string,
    string,
    string,
    string,
    string,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number
];
export declare const CLMM_CACHE: {
    lastUpdated: string;
    pairs: RaydiumClmmPairDataArray[];
};
/** Map<pool-address, RaydiumClmmPairData> rebuilt on boot */
export declare const CLMM_MAP: Map<string, RaydiumClmmPairData>;
export interface RaydiumUsdTx {
    signature: string;
    slot: number;
    blockTime: number;
    usd: number;
}
interface RaydiumClmmPairDetail {
    id: string;
    mintA: {
        address: string;
        symbol: string;
    };
    mintB: {
        address: string;
        symbol: string;
    };
    feeRate: number;
    config: {
        tickSpacing: number;
        tradeFeeRate: number;
        protocolFeeRate: number;
        fundFeeRate: number;
    };
    price: number;
    tvl: number;
    day?: {
        apr: number;
    };
    week?: {
        apr: number;
    };
    month?: {
        apr: number;
    };
}
export interface RaydiumClmmPairData {
    /** pool_state address */
    lbPair: string;
    name: string;
    xSymbol: string;
    ySymbol: string;
    mintX: string;
    mintY: string;
    tickSpacing: number;
    feeRate: number;
    feeBps: number;
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
export declare class RaydiumClmmApi {
    private static _throttle;
    static updateThrottleParameters(params: {
        max: number;
        interval: number;
    }): void;
    /** Cached + throttled fetch of a single CLMM pool */
    static getClmmPairData(poolId: string): Promise<RaydiumClmmPairData | null>;
    static getAllRaydiumPairDetails(): Promise<RaydiumClmmPairData[]>;
    static getAllClmmPairDetails: typeof RaydiumClmmApi.getAllRaydiumPairDetails;
    /** turn Raydium’s verbose JSON into our compact `RaydiumClmmPairData` */
    static extractRaydiumPairData(item: RaydiumClmmPairDetail): RaydiumClmmPairData;
    private static _fetchPairData;
}
export declare const extractRaydiumPairData: (item: RaydiumClmmPairDetail) => RaydiumClmmPairData;
export declare const getAllRaydiumPairDetails: () => Promise<RaydiumClmmPairData[]>;
export declare const getAllClmmPairDetails: () => Promise<RaydiumClmmPairData[]>;
export {};
