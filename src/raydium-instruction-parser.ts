import {Idl, BorshInstructionCoder} from '@project-serum/anchor';
import idl from "./data/idl.json";
import {RAYDIUM_PROGRAM} from './constants';
import {
    getInstructionIndex,
    getAccountMetas,
    getTokenTransfers
} from './solana-transaction-utils';
import {
    ParsedTransactionWithMeta,
    PartiallyDecodedInstruction,
    ParsedInstruction
} from '@solana/web3.js';

export type RaydiumInstructionType = 'open' | 'add' | 'remove' | 'claim' | 'close';

export interface RaydiumClmmAccounts {
    /** personal_position PDA */
    position: string;
    /** pool_state (pair) address */
    lbPair: string;
    /** wallet that signed the tx */
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

    /** extra fields that exist on “add / remove / swap …” instructions */
    activeBinId?: number | null;
    removalBps?: number | null;
}

const RAY_INSTR_MAP: Record<string, RaydiumInstructionType> = {
    open_position: 'open',
    open_position_v2: 'open',
    open_position_with_token22_nft: 'open',
    increase_liquidity: 'add',
    increase_liquidity_v2: 'add',
    decrease_liquidity: 'remove',
    decrease_liquidity_v2: 'remove',
    collect_fund_fee: 'claim',
    collect_protocol_fee: 'claim',
    close_position: 'close'
};

const coder = new BorshInstructionCoder(idl as Idl);

export function parseRaydiumInstructions(
    transaction: ParsedTransactionWithMeta | null
): RaydiumClmmInstruction[] {
    if (!transaction) return [];

    const allInstructions: (ParsedInstruction | PartiallyDecodedInstruction)[] = [
        ...transaction.transaction.message.instructions,
        ...transaction.meta?.innerInstructions?.flatMap(inner => inner.instructions) ?? []
    ];

    return allInstructions
        .map(ix => parseSingleInstruction(transaction, ix))
        .filter((x): x is RaydiumClmmInstruction => x !== null);
}

function parseSingleInstruction(
    transaction: ParsedTransactionWithMeta,
    instruction: ParsedInstruction | PartiallyDecodedInstruction
): RaydiumClmmInstruction | null {
    if (!('data' in instruction)) return null;
    if (instruction.programId.toBase58() !== RAYDIUM_PROGRAM) return null;
    if (!transaction.blockTime) return null;

    let decoded;
    try {
        decoded = coder.decode(instruction.data, 'base58');
    } catch {
        return null; // skip unrecognised instructions
    }
    if (!decoded) return null;
    if (!(decoded.name in RAY_INSTR_MAP)) return null;

    const instructionType = RAY_INSTR_MAP[decoded.name];
    const index = getInstructionIndex(transaction, instruction);
    if (index === -1) return null;

    const accountMetas = getAccountMetas(transaction, instruction);
    const accounts = getRaydiumAccounts(decoded, accountMetas);
    const tokenTransfers = getTokenTransfers(transaction, index).map(t => ({
        mint: t.mint,
        amount: Number(t.tokenAmount.amount)
    }));

    return {
        signature: transaction.transaction.signatures[0],
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        instructionName: decoded.name,
        instructionType,
        accounts,
        tokenTransfers
    };
}

function getRaydiumAccounts(
    decoded: any,
    metas: { pubkey: { toBase58(): string } }[]
): RaydiumClmmAccounts {
    // Raydium positions typically: 0 = position, 1 = pool, 2 = owner
    return {
        position: metas[0]?.pubkey.toBase58() ?? '',
        lbPair: metas[1]?.pubkey.toBase58() ?? '',
        sender: metas[2]?.pubkey.toBase58() ?? ''
    };
}
