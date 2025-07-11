import { ParsedTransactionWithMeta } from "@solana/web3.js";
export type RaydiumInstructionType = "open" | "add" | "remove" | "claim" | "close";
export interface RaydiumClmmAccounts {
    position: string;
    pool: string;
    sender: string;
}
export interface TokenTransferInfo {
    mint: string;
    amount: number;
}
export interface RaydiumClmmInstruction {
    signature: string;
    slot: number;
    blockTime: number;
    instructionName: string;
    instructionType: RaydiumInstructionType;
    accounts: RaydiumClmmAccounts;
    tokenTransfers: TokenTransferInfo[];
    /** present on increase/decrease-liquidity & swap */
    activeBinId?: number | null;
    /** present on remove-liquidity instructions */
    removalBps?: number | null;
}
export declare function parseRaydiumInstructions(transaction: ParsedTransactionWithMeta | null): RaydiumClmmInstruction[];
