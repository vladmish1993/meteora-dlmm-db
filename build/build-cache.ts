import fs from "fs";
import path from "path";
import {CLMM_MAP, getAllClmmPairDetails, RaydiumClmmPairData} from "../src/raydium-clmm-api";
import {
    getFullJupiterTokenList,
    JupiterTokenListApi,
    TOKEN_MAP,
    TokenMeta,
} from "../src/jupiter-token-list-api";

import {Connection, PublicKey} from "@solana/web3.js";
import {delay} from "../src/util";

const now = new Date();
const connection = new Connection("https://api.mainnet-beta.solana.com");

const FULL_LIST_PATH = path.resolve("./build/full-jupiter-tokens.json");
const USE_LOCAL_LIST = fs.existsSync(FULL_LIST_PATH);

async function saveTokens(tokens: TokenMeta[]) {
    await Bun.write(
        "./src/jupiter-token-list-cache.ts",
        `
const cache = ${JSON.stringify({
            lastUpdated: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
            tokens: tokens.map((token) => {
                const {address, name, symbol, decimals, logoURI} = token;
                return [address, name, symbol, decimals, logoURI];
            }),
        })};
export default cache;
  `,
    );
}

async function getMissingToken(address: string) {
    await delay(1000);
    const tokenData = await connection.getParsedAccountInfo(
        new PublicKey(address),
    );
    if (
        tokenData.value &&
        tokenData.value.data &&
        "parsed" in tokenData.value.data
    ) {
        return {
            address,
            name: tokenData.value.data.parsed.info.name || null,
            symbol: tokenData.value.data.parsed.info.symbol || null,
            decimals: tokenData.value.data.parsed.info.decimals,
            logoURI: tokenData.value.data.parsed.info.logoURI || null,
        };
    }
    return null;
}

// Update the DLMM cache
console.log("Updating DLMM cache");
const fetchedPairs = await getAllClmmPairDetails();
const pairs = Array.from(CLMM_MAP.values());
let newPairCount = 0;
fetchedPairs.forEach((pair: RaydiumClmmPairData) => {
    if (!CLMM_MAP.has(pair.lbPair)) {
        pairs.push(pair);
        newPairCount++;
    }
});
await Bun.write(
    "./src/raydium-clmm-cache.ts",
    `
const cache = ${JSON.stringify({
        lastUpdated: `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
        pairs: pairs.map((pair) => Object.values(pair)),
    })};
export default cache;
  `,
);
if (newPairCount > 0) {
    console.log(`Saved ${newPairCount} new pairs`);
} else {
    console.log("No new pairs found");
}

// Update the Jupiter token list cache
if (newPairCount > 0) {
    console.log("Fetching full Jupiter token list");
    let tokensFromApi: TokenMeta[];

    if (USE_LOCAL_LIST) {
        console.log("Loading full token list from disk …");
        const buf = await fs.promises.readFile(FULL_LIST_PATH, "utf8");
        tokensFromApi = JSON.parse(buf) as TokenMeta[];
    } else {
        console.log("Downloading full token list from Jupiter …");
        tokensFromApi = await getFullJupiterTokenList();

        /* save a fresh copy so next run can skip the download */
        await fs.promises.mkdir(path.dirname(FULL_LIST_PATH), { recursive: true });
        await fs.promises.writeFile(FULL_LIST_PATH,
            JSON.stringify(tokensFromApi), "utf8");
    }
    const oldTokenListSize = TOKEN_MAP.size;
    tokensFromApi.forEach((token) => TOKEN_MAP.set(token.address, token));
    const allDlmmTokenAddresses = Array.from(
        new Set(pairs.map((pair) => [pair.mintX, pair.mintY]).flat()),
    );
    const missingTokenAddresses = allDlmmTokenAddresses.filter(
        (address) => !TOKEN_MAP.has(address),
    );
    const tokens = Array.from(TOKEN_MAP.values()).filter(
        (token) => token && allDlmmTokenAddresses.includes(token.address),
    );

    let updatedCount = 0;
    let elapsed = 0;
    let estimated_time = 0;
    let remaining = missingTokenAddresses.length - updatedCount;
    const start = Date.now();
    if (oldTokenListSize < tokens.length) {
        console.log(
            `Saving ${
                tokens.length - oldTokenListSize
            } new tokens fetched from full token list.`,
        );
        await saveTokens(tokens);
    }
    if (missingTokenAddresses.length > 0) {
        console.log(
            `Fetching ${missingTokenAddresses.length} individual tokens not found in full list.  Current # of tokens: ${tokens.length}`,
        );

        for (const mint of missingTokenAddresses) {
            // 1) already-cached in memory?
            let token: TokenMeta | null | undefined = TOKEN_MAP.get(mint);

            // 2) try the Jupiter single-token endpoint
            if (!token) token = await JupiterTokenListApi.getToken(mint);

            // 3) last-resort on-chain PDA read
            if (!token) token = await getMissingToken(mint);

            // ─── update state if we finally obtained metadata ───
            if (token) {
                tokens.push(token);
                TOKEN_MAP.set(token.address, token);

                updatedCount++;
                remaining = missingTokenAddresses.length - updatedCount;

                // persist cache every 10 new tokens
                if (updatedCount % 10 === 0 || updatedCount === missingTokenAddresses.length) {
                    await saveTokens(tokens);

                    elapsed = Date.now() - start;
                    estimated_time =
                        Math.round((remaining * elapsed) / (updatedCount || 1) / 100 / 60) / 10;

                    console.log(
                        `Fetched ${updatedCount} new tokens out of ${missingTokenAddresses.length}, ` +
                        `total of ${tokens.length}, ${remaining} remaining, ` +
                        `estimated time to complete: ${estimated_time} minutes`,
                    );
                }
            }
        }
    } else {
        console.log("No new tokens found");
    }
}
