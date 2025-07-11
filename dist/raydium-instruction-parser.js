import { BorshInstructionCoder } from "@project-serum/anchor";
import idl from "./data/idl.json";
import { RAYDIUM_PROGRAM } from "./constants";
import { getInstructionIndex, getAccountMetas, getTokenTransfers, } from "./solana-transaction-utils";
/* ────────────────────────────────────────────────────────────────────────── */
/*  Static helpers                                                           */
/* ────────────────────────────────────────────────────────────────────────── */
const RAY_INSTR_MAP = {
    openPosition: "open",
    openPositionV2: "open",
    openPositionWithToken22Nft: "open",
    increaseLiquidity: "add",
    increaseLiquidityV2: "add",
    decreaseLiquidity: "remove",
    decreaseLiquidityV2: "remove",
    collectFundFee: "claim",
    collectProtocolFee: "claim",
    closePosition: "close",
};
const CODER = new BorshInstructionCoder(idl);
/* ────────────────────────────────────────────────────────────────────────── */
/*  Public API                                                               */
/* ────────────────────────────────────────────────────────────────────────── */
export function parseRaydiumInstructions(transaction) {
    if (transaction == null)
        return [];
    const allIxs = [
        ...transaction.transaction.message.instructions,
        ...(transaction.meta?.innerInstructions?.flatMap((i) => i.instructions) ??
            []),
    ];
    return allIxs
        .map((ix) => parseSingleInstruction(transaction, ix))
        .filter((x) => x !== null);
}
/* ────────────────────────────────────────────────────────────────────────── */
/*  Implementation                                                           */
/* ────────────────────────────────────────────────────────────────────────── */
function parseSingleInstruction(tx, ix) {
    if (!("data" in ix))
        return null;
    if (ix.programId.toBase58() !== RAYDIUM_PROGRAM)
        return null;
    if (!tx.blockTime)
        return null;
    /* — decode the instruction — */
    let decoded;
    try {
        decoded = CODER.decode(ix.data, "base58");
    }
    catch {
        return null; // not a recognised instruction
    }
    if (!decoded || !(decoded.name in RAY_INSTR_MAP))
        return null;
    const instructionType = RAY_INSTR_MAP[decoded.name];
    const index = getInstructionIndex(tx, ix);
    if (index === -1)
        return null;
    /* — derive accounts & transfers — */
    const metas = getAccountMetas(tx, ix);
    const accounts = getRaydiumAccounts(decoded, metas);
    const tokenTransfers = getTokenTransfers(tx, index).map((t) => {
        const info = t.parsed.info;
        const rawAmount = info.tokenAmount?.amount ?? /* transferChecked */ info.amount ?? "0";
        return {
            mint: info.mint,
            amount: Number(rawAmount),
        };
    });
    /* — extras: activeBinId & removalBps — */
    const { activeBinId, removalBps } = getExtraFields(decoded);
    return {
        signature: tx.transaction.signatures[0],
        slot: tx.slot,
        blockTime: tx.blockTime,
        instructionName: decoded.name,
        instructionType,
        accounts,
        tokenTransfers,
        activeBinId,
        removalBps,
    };
}
/* ------------------------------------------------------------------------- */
/*  Helpers                                                                  */
/* ------------------------------------------------------------------------- */
function getRaydiumAccounts(decoded, metas) {
    /* 1º try Anchor › format() so we get the real account names */
    try {
        const { accounts } = CODER.format(decoded, metas);
        const position = accounts.find((a) => /position/i.test(a.name ?? ""))?.pubkey.toBase58() ??
            metas[0]?.pubkey.toBase58() ??
            "";
        const pool = accounts.find((a) => /(pool_state|pool|pair)/i.test(a.name ?? ""))?.pubkey.toBase58() ??
            metas[1]?.pubkey.toBase58() ??
            "";
        const sender = accounts.find((a) => /(owner|sender|signer)/i.test(a.name ?? ""))?.pubkey.toBase58() ??
            metas[2]?.pubkey.toBase58() ??
            "";
        return { position, pool, sender };
    }
    catch {
        /* fallback: the original hard-coded indices */
        return {
            position: metas[0]?.pubkey.toBase58() ?? "",
            pool: metas[1]?.pubkey.toBase58() ?? "",
            sender: metas[2]?.pubkey.toBase58() ?? "",
        };
    }
}
/** Pull extra numeric fields straight off the decoded Borsh struct */
function getExtraFields(decoded) {
    const d = decoded.data ?? {};
    /* activeBinId appears as either `activeBinId` or `binId` in different
       Raydium IDLs */
    const activeBinId = "activeBinId" in d
        ? Number(d.activeBinId)
        : "binId" in d
            ? Number(d.binId)
            : null;
    /* removal bps only makes sense for *remove*-liquidity instructions           */
    const removalBps = "removalBps" in d
        ? Number(d.removalBps)
        : "bpsToRemove" in d
            ? Number(d.bpsToRemove)
            : null;
    return { activeBinId, removalBps };
}
//# sourceMappingURL=raydium-instruction-parser.js.map