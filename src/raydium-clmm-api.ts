import { ApiThrottleCache } from "./util";
import {RaydiumClmmAccounts, RaydiumInstructionType, TokenTransferInfo} from "./raydium-instruction-parser";

const API = "https://api-v3.raydium.io/pools/info/ids?ids=";

export interface RaydiumUsdTx {
  signature:  string;
  slot:       number;
  blockTime:  number;
  usd:        number;
}

export interface RaydiumClmmPairData {
  /** pool_state / pair id */
  id: string;
  name: string;

  /** token-mints */
  mintA: string;
  mintB: string;

  /** pool parameters */
  tickSpacing:     number;   // a.k.a. tickSpacing in Raydium’s JSON
  tradeFeeBps:     number;   // tradeFeeRate  (basis-points)
  protocolFeeBps:  number;   // protocolFeeRate (basis-points)
  fundFeeBps:  number;
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

const MAX_CONCURRENT_REQUESTS = 10;
const DELAY_MS = 3000;

export class RaydiumClmmApi {

  private static _throttle = new ApiThrottleCache(
      MAX_CONCURRENT_REQUESTS,
      DELAY_MS,
      new Map(),
      RaydiumClmmApi._fetchPairData
  );

  static updateThrottleParameters(params: { max: number; interval: number }) {
    RaydiumClmmApi._throttle.max = params.max;
    RaydiumClmmApi._throttle.interval = params.interval;
  }

  static getDlmmPairData(pool: string): Promise<RaydiumClmmPairData | null> {
    return RaydiumClmmApi._throttle.processItem(
        pool,
        RaydiumClmmApi._fetchPairData
    );
  }

  private static async _fetchPairData(pool: string): Promise<RaydiumClmmPairData | null> {
    try {
      const response = await fetch(API + pool);
      const text = await response.text();
      if (text.trim().startsWith('<')) {
        console.error(`HTML response instead of JSON from Raydium API for pair ${pool}`);
        return null;
      }
      const json = JSON.parse(text);
      const p = json.data[0];
      return {
        id: p.id,
        name: p.name,
        mintA: p.mintA.address,
        mintB: p.mintB.address,
        tickSpacing: p.config.tickSpacing,
        tradeFeeBps: p.config.tradeFeeRate,
        protocolFeeBps: p.config.protocolFeeRate,
        fundFeeBps: p.config.fundFeeBps,
      };
    } catch (e) {
      console.error(`Error fetching Raydium pair ${pool}:`, e);
      return null;
    }
  }
}
