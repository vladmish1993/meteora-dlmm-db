import initSqlJs, {SqlJsStatic, type Database, type Statement} from "sql.js";
import {
    RaydiumClmmAccounts,
    type RaydiumClmmInstruction,
    RaydiumInstructionType,
    TokenTransferInfo
} from "./raydium-instruction-parser";
import {type RaydiumClmmPairData, RaydiumUsdTx} from "./raydium-clmm-api";
import {_getJupiterPrices, type TokenMeta} from "./jupiter-token-list-api";
import RaydiumDownloader, {
    RaydiumDownloaderConfig,
} from "./clmm-downloader";
import {delay} from "./util";

interface ClmmDbRow {
    [column: string]:
        | number
        | boolean
        | string
        | Array<unknown>
        | Uint8Array
        | null;
}

export interface ClmmDbTx extends ClmmDbRow {
    block_time: number;
    signature: string;
    position_address: string;
    owner_address: string;
    pair_address: string;
    base_mint: string;
    base_symbol: string;
    base_decimals: number;
    base_logo: string;
    quote_mint: string;
    quote_symbol: string;
    quote_decimals: number;
    quote_logo: string;
    is_inverted: number;
    position_is_open: number;
    is_opening_transaction: number;
    is_closing_transaction: number;
    price: number;
    fee_amount: number;
    deposit: number;
    withdrawal: number;
    usd_fee_amount: number;
    usd_deposit: number;
    usd_withdrawal: number;
}

function isBrowser() {
    // Check for browser window
    if (typeof window !== "undefined" && typeof window.document !== "undefined") {
        return true;
    }

    // Check for Web Worker
    // @ts-ignore
    if (typeof self !== "undefined" && typeof self.importScripts === "function") {
        return true;
    }

    // If neither of the above, it's likely Node.js or another environment
    return false;
}

let SQL: SqlJsStatic;

async function initSql() {
    if (SQL) {
        return SQL;
    }
    SQL = isBrowser()
        ? await initSqlJs({
            locateFile: (file) =>
                `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/${file}`,
        })
        : await initSqlJs();
    return SQL;
}

export default class ClmmDb {
    private _db!: Database;
    private _addInstructionStatement!: Statement;
    private _addTransferStatement!: Statement;
    private _addPairStatement!: Statement;
    private _addTokenStatement!: Statement;
    private _addUsdYStatement!: Statement;
    private _addUsdXStatement!: Statement;
    private _fillMissingUsdStatement!: Statement;
    private _setOldestSignature!: Statement;
    private _markCompleteStatement!: Statement;
    private _getAllTransactions!: Statement;
    private _downloaders: Map<string, RaydiumDownloader> = new Map();
    private _saving = false;
    private _queue: (() => any)[] = [];
    delaySave = false;

    private constructor() {
    }

    static async create(
        data?: ArrayLike<number> | Buffer | null,
    ): Promise<ClmmDb> {
        const db = new ClmmDb();
        await db._init(data);
        return db;
    }

    static async load(): Promise<ClmmDb> {
        const {readData} = isBrowser()
            ? await import("./browser-save")
            : await import("./node-save");
        return readData();
    }

    private async _init(data?: ArrayLike<number> | Buffer | null) {
        const sql = await initSql();
        this._db = new sql.Database(data);
        this._createTables();
        if (!data) {
            this._addInitialData();
        }
        this._createStatements();
    }

    private _createTables() {
        this._db.exec(`
      ----------------
      ----------------
      ---- Tables ----
      ----------------
      ----------------

      ------------------
      -- Instructions --
      ------------------
      CREATE TABLE IF NOT EXISTS instructions (
        signature TEXT NOT NULL,
        slot INTEGER NOT NULL,
        block_time INTEGER NOT NULL,
        instruction_name TEXT NOT NULL,
        instruction_type TEXT NOT NULL,
        position_address TEXT NOT NULL,
        pair_address TEXT NOT NULL,
        owner_address TEXT NOT NULL,
        active_bin_id INTEGER,
        removal_bps INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_instructions_signature_instruction_name_position_address
      ON instructions (
        signature, 
        instruction_name, 
        position_address
      );
      CREATE INDEX IF NOT EXISTS instructions_position_address ON instructions (position_address);
      CREATE INDEX IF NOT EXISTS instructions_block_time ON instructions (block_time);
      CREATE INDEX IF NOT EXISTS instructions_signature ON instructions (signature);

      ---------------------
      -- Token Transfers --
      ---------------------
      CREATE TABLE IF NOT EXISTS token_transfers (
        signature TEXT NOT NULL,
        instruction_name TEXT NOT NULL,
        position_address TEXT NOT NULL,
        mint TEXT NOT NULL,
        amount REAL NOT NULL,
        usd_load_attempted NUMERIC DEFAULT (0) NOT NULL, 
        usd_amount REAL,
        FOREIGN KEY (
          signature, 
          instruction_name, 
          position_address
        ) REFERENCES instructions (
          signature, 
          instruction_name, 
          position_address
        ) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_token_transfers_signature_instruction_name_position_address_mint
      ON token_transfers (
        signature, 
        instruction_name, 
        position_address, 
        mint
      );
      CREATE INDEX IF NOT EXISTS token_transfers_position_address ON token_transfers (position_address);

      ----------------
      -- DLMM Pairs --
      ----------------
    CREATE TABLE IF NOT EXISTS clmm_pools (
      pair_address      TEXT NOT NULL,
      name              TEXT NOT NULL,
      mint_x            TEXT NOT NULL,
      mint_y            TEXT NOT NULL,
      tick_spacing      INTEGER NOT NULL,
      trade_fee_bps     INTEGER NOT NULL,
      protocol_fee_bps  INTEGER NOT NULL,
      fund_fee_bps      INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS clmm_pools_pair_address
    ON clmm_pools (pair_address);

      ------------
      -- Tokens --
      ------------
      CREATE TABLE IF NOT EXISTS tokens (
        address TEXT NOT NULL,
        name TEXT,
        symbol TEXT,
        decimals INTEGER NOT NULL,
        logo TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tokens_address
      ON tokens (address);

      ------------------
      -- Quote Tokens --
      ------------------
      CREATE TABLE IF NOT EXISTS quote_tokens (
        priority INTEGER NOT NULL,
        mint TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS quote_tokens_priority
      ON quote_tokens (priority);
      CREATE UNIQUE INDEX IF NOT EXISTS quote_tokens_mint
      ON quote_tokens (mint);

      ------------------------
      -- Completed Accounts --
      ------------------------
      CREATE TABLE IF NOT EXISTS completed_accounts (
        account_address TEXT NOT NULL,
        completed INTEGER DEFAULT (0) NOT NULL, 
        oldest_block_time INTEGER, 
        oldest_signature TEXT,
        CONSTRAINT completed_accounts_account_address PRIMARY KEY (account_address)
      );

      -----------------
      -- Token Types --
      -----------------
      CREATE TABLE IF NOT EXISTS instruction_types (
        priority INTEGER NOT NULL,
        instruction_type INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS instruction_types_priority
      ON instruction_types (priority);
      CREATE UNIQUE INDEX IF NOT EXISTS instruction_types_instruction_type
      ON instruction_types (instruction_type);

      --------------------------------------------------------------------------

      ---------------
      ---------------
      ---- Views ----
      ---------------
      ---------------

      ------------------
      -- Transactions --
      ------------------
      DROP VIEW IF EXISTS v_transactions;
      CREATE VIEW v_transactions AS
  			WITH instructions_with_active_bin_id_groups AS (
          SELECT
            i.block_time,
            i.signature,
            i.instruction_type,
            i.position_address,
            i.owner_address,
            p.pair_address,
            p.tick_spacing,
            p.trade_fee_bps,
            p.protocol_fee_bps,
            p.fund_fee_bps,
            x.address x_mint,
            x.symbol x_symbol,
            x.decimals x_decimals,
            x.logo x_logo,
            y.address y_mint,
            y.symbol y_symbol,
            y.decimals y_decimals,
            y.logo y_logo,
            CASE
              WHEN (SELECT q.priority FROM quote_tokens q WHERE q.mint = p.mint_x) IS NULL 
              THEN FALSE
              WHEN
                (SELECT q.priority FROM quote_tokens q WHERE q.mint = p.mint_x) IS NOT NULL
                AND (SELECT q.priority FROM quote_tokens q WHERE q.mint = p.mint_y) IS NULL
              THEN TRUE
              WHEN
                (SELECT q.priority FROM quote_tokens q WHERE q.mint = p.mint_x) < (SELECT q.priority FROM quote_tokens q WHERE q.mint = p.mint_y)
              THEN TRUE
              ELSE FALSE
            END is_inverted,          
            i.active_bin_id,
            SUM(CASE WHEN i.active_bin_id IS NOT NULL THEN 1 ELSE 0 END) OVER (PARTITION BY p.pair_address ORDER BY i.block_time) prev_group_id,
            SUM(CASE WHEN i.active_bin_id IS NOT NULL THEN 1 ELSE 0 END) OVER (PARTITION BY p.pair_address ORDER BY i.block_time DESC) next_group_id,
            COALESCE(i.removal_bps, 0) removal_bps,
            i.instruction_name = "removeLiquiditySingleSide" is_one_sided_removal,
            MAX(CASE WHEN i.instruction_type = 'close' THEN 1 END) OVER (PARTITION BY i.position_address RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) IS NULL position_is_open,
            CASE WHEN i.instruction_type = 'open' THEN 1 ELSE 0 END is_opening_transaction,
            CASE WHEN i.instruction_type = 'close' THEN 1 ELSE 0 END is_closing_transaction,
            COALESCE(ttx.amount, 0) / POWER(10, x.decimals) x_amount,
            COALESCE(tty.amount, 0) / POWER(10, y.decimals) y_amount,
            COALESCE(ttx.usd_amount, 0) + COALESCE(tty.usd_amount, 0) usd_amount
          FROM
            instructions i
            JOIN instruction_types it ON
              i.instruction_type = it.instruction_type 
            JOIN clmm_pools p ON p.pair_address = i.pair_address
            JOIN tokens x ON
              p.mint_x = x.address
            JOIN tokens y ON
              p.mint_y = y.address
            LEFT JOIN token_transfers ttx ON
              ttx.signature = i.signature
              AND ttx.position_address = i.position_address
              AND ttx.instruction_name = i.instruction_name 
              AND ttx.mint = x.address
            LEFT JOIN token_transfers tty ON
              tty.signature = i.signature
              AND tty.position_address = i.position_address
              AND tty.instruction_name = i.instruction_name 
              AND tty.mint = y.address
          ORDER BY
              p.pair_address, i.block_time
        ),
        instructions_with_contiguous_active_bin_ids AS (
          SELECT
            *,
            block_time
              - MIN(block_time) FILTER (WHERE active_bin_id IS NOT NULL)
                OVER (PARTITION BY pair_address, prev_group_id
                      ORDER BY block_time, removal_bps)
              AS prev_block_time_diff,
            MAX(active_bin_id) FILTER (WHERE active_bin_id IS NOT NULL)
                OVER (PARTITION BY pair_address, prev_group_id
                      ORDER BY block_time, removal_bps)
              AS prev_active_bin_id,
            MIN(block_time) FILTER (WHERE active_bin_id IS NOT NULL)
                OVER (PARTITION BY pair_address, next_group_id
                      ORDER BY block_time, removal_bps DESC)
              - block_time
              AS next_block_time_diff,
            MIN(active_bin_id) FILTER (WHERE active_bin_id IS NOT NULL)
                OVER (PARTITION BY pair_address, next_group_id
                      ORDER BY block_time, removal_bps DESC)
              AS next_active_bin_id
          FROM
            instructions_with_active_bin_id_groups
        ),
        backfilled_active_bin_ids AS (
          SELECT
            block_time,
            signature,
            instruction_type,
            position_address,
            owner_address,
            pair_address,
            tick_spacing,
            trade_fee_bps,
            x_mint,
            x_symbol,
            x_decimals,
            x_logo,
            y_mint,
            y_symbol,
            y_decimals,
            y_logo,
            is_inverted,
            COALESCE (
              active_bin_id,
              CASE 
                WHEN prev_block_time_diff IS NOT NULL and next_block_time_diff IS NOT NULL THEN
                  CASE 
                    WHEN prev_block_time_diff <= next_block_time_diff THEN prev_active_bin_id
                    ELSE next_active_bin_id
                  END
                ELSE COALESCE (prev_active_bin_id, next_active_bin_id)
              END			
            ) active_bin_id,
            removal_bps,
            is_one_sided_removal,
            position_is_open,
            is_opening_transaction,
            is_closing_transaction,
            x_amount,
            y_amount,
            usd_amount
          FROM
              instructions_with_contiguous_active_bin_ids
        ),
        prices AS (
          SELECT
            block_time,
            signature,
            instruction_type,
            position_address,
            owner_address,
            pair_address,
            tick_spacing,
            trade_fee_bps,
            CASE 
              WHEN NOT is_inverted THEN x_mint
              ELSE y_mint
            END base_mint,
            CASE 
              WHEN NOT is_inverted THEN x_symbol
              ELSE y_symbol
            END base_symbol,
            CASE 
              WHEN NOT is_inverted THEN x_decimals
              ELSE y_decimals
            END base_decimals,
            CASE 
              WHEN NOT is_inverted THEN x_logo
              ELSE y_logo
            END base_logo,
            CASE 
              WHEN NOT is_inverted THEN y_mint
              ELSE x_mint
            END quote_mint,
            CASE 
              WHEN NOT is_inverted THEN y_symbol
              ELSE x_symbol
            END quote_symbol,
            CASE 
              WHEN NOT is_inverted THEN y_decimals
              ELSE x_decimals
            END quote_decimals,
            CASE 
              WHEN NOT is_inverted THEN y_logo
              ELSE x_logo
            END quote_logo,
            is_inverted,
            removal_bps,
            is_one_sided_removal,
            position_is_open,
            is_opening_transaction,
            is_closing_transaction,
            CASE 
              WHEN NOT is_inverted THEN POWER(1.0 + 1.0 * tick_spacing / 10000, active_bin_id)
              ELSE 1 / (POWER(1.0 + 1.0 * tick_spacing / 10000, active_bin_id) * POWER(10, x_decimals - y_decimals))
            END price,
            CASE
              WHEN NOT is_inverted THEN x_amount
              ELSE y_amount
            END base_amount,
            CASE
              WHEN NOT is_inverted THEN y_amount
              ELSE x_amount
            END quote_amount,
            usd_amount
          FROM
            backfilled_active_bin_ids
        ),
        instructions_with_base_quote as (
          SELECT
            block_time,
            signature,
            instruction_type,
            position_address,
            owner_address,
            pair_address,
            base_mint,
            base_symbol,
            base_decimals,
            base_logo,
            quote_mint,
            quote_symbol,
            quote_decimals,
            quote_logo,
            is_inverted,
            removal_bps,
            is_one_sided_removal,
            position_is_open,
            is_opening_transaction,
            is_closing_transaction,
            tick_spacing,
            trade_fee_bps,
            price * (1.0 - trade_fee_bps / 10000.0) AS price_after_trade_fee,
            price * (1.0 - tick_spacing / 10000.0 - trade_fee_bps / 10000.0) * base_amount + quote_amount amount,
            usd_amount
          FROM
            prices
        ),
        transactions AS (
          SELECT DISTINCT
            block_time,
            signature,
            position_address,
            owner_address,
            pair_address,
            base_mint,
            base_symbol,
            base_decimals,
            base_logo,
            quote_mint,
            quote_symbol,
            quote_decimals,
            quote_logo,
            is_inverted,
            MAX(position_is_open) OVER (PARTITION BY position_address) position_is_open,
            MAX(is_opening_transaction) OVER (PARTITION BY signature) is_opening_transaction,
            MAX(is_closing_transaction) OVER (PARTITION BY signature) is_closing_transaction,
            MIN(price) OVER (PARTITION BY position_address) price,
            COALESCE(
              SUM(
                CASE 
                  WHEN instruction_type = 'claim' THEN price * base_amount + quote_amount 
                  ELSE 0 
                END
              ) OVER (PARTITION BY signature, position_address),
              0
            ) fee_amount,
            COALESCE(
              SUM(
                CASE 
                  WHEN instruction_type = 'add' THEN price * base_amount + quote_amount
                  ELSE 0
                END
              ) OVER (PARTITION BY signature, position_address),
              0
            ) deposit,
            COALESCE(
              SUM(
                CASE 
                  WHEN instruction_type = 'remove' THEN price * base_amount + quote_amount
                  ELSE 0
                END
              ) OVER (PARTITION BY signature, position_address),
              0
            ) withdrawal,
            COALESCE(
              SUM(
                CASE 
                  WHEN instruction_type = 'claim' THEN usd_amount 
                  ELSE 0 
                END
              ) OVER (PARTITION BY signature, position_address),
              0
            ) usd_fee_amount,
            COALESCE(
              SUM(
                CASE 
                  WHEN instruction_type = 'add' THEN usd_amount		
                END
              ) OVER (PARTITION BY signature, position_address),
              0
            ) usd_deposit,
            COALESCE(
              SUM(
                CASE 
                  WHEN instruction_type = 'remove' THEN usd_amount
                END
              ) OVER (PARTITION BY signature, position_address),
              0
            ) usd_withdrawal          
        FROM
          prices
        )        
        SELECT
          block_time,
          signature,
          position_address,
          owner_address,
          pair_address,
          base_mint,
          base_symbol,
          base_decimals,
          base_logo,
          quote_mint,
          quote_symbol,
          quote_decimals,
          quote_logo,
          is_inverted,
          position_is_open,
          is_opening_transaction,
          is_closing_transaction,
          price,
          fee_amount,
          deposit,
          withdrawal,
          usd_fee_amount,
          usd_deposit,
          usd_withdrawal
				FROM
					transactions
        ORDER BY
          block_time,
          position_address;

      -------------------
      -- Missing Pairs --
      -------------------
      CREATE VIEW IF NOT EXISTS v_missing_pairs AS
      SELECT DISTINCT 
        i.pair_address
      FROM
        instructions i 
        JOIN clmm_pools p ON i.pair_address = p.pair_address
      WHERE 
        p.pair_address IS NULL;

      --------------------
      -- Missing Tokens --
      --------------------
      CREATE VIEW IF NOT EXISTS v_missing_tokens AS
      SELECT DISTINCT address FROM (
        SELECT
          p.mint_x address
        FROM
          instructions i 
          JOIN clmm_pools p ON i.pair_address = p.pair_address 
          LEFT JOIN tokens x ON
            p.mint_x  = x.address 
        WHERE 
          x.address IS NULL
        UNION
        SELECT 
          p.mint_y
        FROM
          instructions i 
          JOIN clmm_pools p ON i.pair_address = p.pair_address
          LEFT JOIN tokens y ON
            p.mint_y  = y.address 
        WHERE 
          y.address IS NULL
      );

      -----------------
      -- Missing USD --
      -----------------
      CREATE VIEW IF NOT EXISTS v_missing_usd AS
      SELECT 
        position_address
      FROM
        token_transfers
      GROUP BY
        position_address
      HAVING
        SUM(usd_load_attempted) <> COUNT(*);
    `);
    }

    private _createStatements() {
        this._addInstructionStatement = this._db.prepare(`
            INSERT INTO instructions(signature,
                                     slot,
                                     block_time,
                                     instruction_name,
                                     instruction_type,
                                     position_address,
                                     pair_address,
                                     owner_address,
                                     active_bin_id,
                                     removal_bps)
            VALUES ($signature,
                    $slot,
                    $block_time,
                    $instruction_name,
                    $instruction_type,
                    $position_address,
                    $pair_address,
                    $owner_address,
                    $active_bin_id,
                    $removal_bps) ON CONFLICT DO NOTHING
        `);
        this._addTransferStatement = this._db.prepare(`
            INSERT INTO token_transfers(signature,
                                        instruction_name,
                                        position_address,
                                        mint,
                                        amount)
            VALUES ($signature,
                    $instruction_name,
                    $position_address,
                    $mint,
                    $amount) ON CONFLICT DO NOTHING
        `);
        this._addPairStatement = this._db.prepare(`
            INSERT INTO clmm_pools (pair_address, name,
                                    mint_x, mint_y,
                                    tick_spacing,
                                    trade_fee_bps,
                                    protocol_fee_bps,
                                    fund_fee_bps)
            VALUES ($pair_address, $name,
                    $mint_x, $mint_y,
                    $tick_spacing,
                    $trade_fee_bps,
                    $protocol_fee_bps,
                    $fund_fee_bps) ON CONFLICT DO NOTHING
        `);
        this._addTokenStatement = this._db.prepare(`
            INSERT INTO tokens(address,
                               name,
                               symbol,
                               decimals,
                               logo)
            VALUES ($address,
                    $name,
                    $symbol,
                    $decimals,
                    $logo) ON CONFLICT DO NOTHING
        `);
        this._addUsdXStatement = this._db.prepare(`
            UPDATE token_transfers
            SET usd_load_attempted = 1,
                usd_amount         = $amount
            WHERE EXISTS (SELECT 1
                          FROM token_transfers t
                                   JOIN instructions i ON
                              i.signature = t.signature
                                  AND i.instruction_name = t.instruction_name
                                  AND i.position_address = t.position_address
                                   JOIN clmm_pools p ON i.pair_address = p.pair_address
                          WHERE t.signature = $signature
                            AND token_transfers.signature = t.signature
                            AND token_transfers.instruction_name = t.instruction_name
                            AND token_transfers.position_address = $position_address
                            AND token_transfers.mint = p.mint_x
                            AND i.instruction_type = $instruction_type)
        `);
        this._addUsdYStatement = this._db.prepare(`
            UPDATE token_transfers
            SET usd_load_attempted = 1,
                usd_amount         = $amount
            WHERE EXISTS (SELECT 1
                          FROM token_transfers t
                                   JOIN instructions i ON
                              i.signature = t.signature
                                  AND i.instruction_name = t.instruction_name
                                  AND i.position_address = t.position_address
                                   JOIN clmm_pools p ON i.pair_address = p.pair_address
                          WHERE t.signature = $signature
                            AND token_transfers.signature = t.signature
                            AND token_transfers.instruction_name = t.instruction_name
                            AND token_transfers.position_address = $position_address
                            AND token_transfers.mint = p.mint_y
                            AND i.instruction_type = $instruction_type)
        `);
        this._fillMissingUsdStatement = this._db.prepare(`
            UPDATE token_transfers
            SET usd_load_attempted = 1
            WHERE EXISTS (SELECT 1
                          FROM token_transfers t
                          WHERE t.position_address = token_transfers.position_address
                            AND token_transfers.usd_load_attempted = 0
                            AND t.position_address = $position_address)
        `);
        this._setOldestSignature = this._db.prepare(`
            INSERT INTO completed_accounts (account_address, oldest_block_time, oldest_signature)
            VALUES ($account_address, $oldest_block_time, $oldest_signature) ON CONFLICT DO
            UPDATE
                SET
                    account_address = $account_address,
                oldest_block_time = $oldest_block_time,
                oldest_signature = $oldest_signature
        `);
        this._markCompleteStatement = this._db.prepare(`
            INSERT INTO completed_accounts (account_address, completed)
            VALUES ($account_address, 1) ON CONFLICT DO
            UPDATE
                SET
                    account_address = $account_address,
                completed = 1
        `);
        this._getAllTransactions = this._db.prepare(`
            SELECT *
            FROM v_transactions
        `);
    }

    private _addInitialData() {
        this._db.run(`
            INSERT INTO quote_tokens (priority, mint)
            VALUES (1, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
                   (2, 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
                   (3, 'So11111111111111111111111111111111111111112') ON CONFLICT DO NOTHING
        `);
        this._db.run(`
            INSERT INTO instruction_types (priority, instruction_type)
            VALUES (1, 'open'),
                   (2, 'add'),
                   (3, 'claim'),
                   (4, 'remove'),
                   (5, 'close')
            ON CONFLICT DO NOTHING
        `);
    }

    download(config: RaydiumDownloaderConfig): RaydiumDownloader {
        let callbacks = config.callbacks;
        if (this._downloaders.has(config.account)) {
            return this._downloaders.get(config.account)!;
        }
        if (callbacks) {
            if (callbacks.onDone) {
                const onDone = callbacks.onDone;
                callbacks.onDone = () => {
                    this._downloaders.delete(config.account);
                    onDone();
                };
            } else {
                callbacks.onDone = () => this._downloaders.delete(config.account);
            }
        } else {
            callbacks = {
                onDone: () => this._downloaders.delete(config.account),
            };
        }
        const downloader = new RaydiumDownloader(this, config);
        this._downloaders.set(config.account, downloader);
        return downloader;
    }

    async addInstruction(instruction: RaydiumClmmInstruction) {
        await this._queueDbCall(() => {
            const {
                signature: $signature,
                slot: $slot,
                blockTime: $block_time,
                instructionName: $instruction_name,
                instructionType: $instruction_type,
                accounts,
                activeBinId: $active_bin_id = null,   // ← comes from the interface now
                removalBps: $removal_bps = null,
            } = instruction;

            const {
                position: $position_address,
                pool: $pair_address,
                sender: $owner_address,
            } = accounts;

            this._addInstructionStatement.run({
                $signature,
                $slot,
                $block_time,
                $instruction_name,
                $instruction_type,
                $position_address,
                $pair_address,
                $owner_address,
                $active_bin_id,
                $removal_bps,
            });

            this.addTransfers(instruction);
        });
    }

    async addTransfers(instruction: RaydiumClmmInstruction) {
        await this._queueDbCall(() => {
            const {
                signature: $signature,
                instructionName: $instruction_name,
                accounts,
            } = instruction;
            const {position: $position_address} = accounts;
            const transfers = instruction.tokenTransfers;
            transfers.forEach((transfer) => {
                const {mint: $mint, amount: $amount} = transfer;
                this._addTransferStatement.run({
                    $signature,
                    $instruction_name,
                    $position_address,
                    $mint,
                    $amount,
                });
            });
        });
    }

    async getPoolForPosition(position_address: string): Promise<string | undefined> {
        return this._queueDbCall(() => {
            const result = this._db
                .exec(
                    `
                        SELECT pair_address
                        FROM instructions
                        WHERE position_address = '${position_address}' LIMIT 1
                    `,
                )
                .map((result) => result.values)
                .flat()
                .flat();

            if (result.length === 0) {
                return undefined;
            }
            return result[0] as string;
        });
    }

    async addPair(pair: RaydiumClmmPairData) {
        await this._queueDbCall(() => {
            const {
                lbPair:      $pair_address,
                name:        $name,
                mintX:       $mint_x,
                mintY:       $mint_y,
                tickSpacing: $tick_spacing,
                feeBps:      $fee_bps,
            } = pair;

            this._addPairStatement.run({
                $pair_address,
                $name,
                $mint_x,
                $mint_y,
                $tick_spacing,
                $fee_bps,
            });
        });
    }

    async addToken(token: TokenMeta) {
        await this._queueDbCall(() => {
            const {address: $address, decimals: $decimals} = token;
            try {
                this._addTokenStatement.run({
                    $address,
                    $name: token.name || null,
                    $symbol: token.symbol || null,
                    $decimals,
                    $logo: token.logoURI || null,
                });
            } catch (err) {
                console.error(err);
                throw err;
            }
        });
    }

    async setOldestSignature(
        $account_address: string,
        $oldest_block_time: number,
        $oldest_signature: string,
    ) {
        await this._queueDbCall(() => {
            this._setOldestSignature.run({
                $account_address,
                $oldest_block_time,
                $oldest_signature,
            });
        });
    }

    async markComplete($account_address: string) {
        await this._queueDbCall(() => {
            this._markCompleteStatement.run({$account_address});
        });
    }

    async isComplete(account_address: string): Promise<boolean> {
        return await this._queueDbCall(() => {
            const completed = this._db
                .exec(
                    `
                        SELECT account_address
                        FROM completed_accounts
                        WHERE account_address = '${account_address}'
                          AND completed
                    `,
                )
                .map((result) => result.values)
                .flat()
                .flat();

            return completed.length == 1;
        });
    }

    async getMissingPools(): Promise<string[]> {
        return this._queueDbCall(() => {
            return this._db
                .exec(`SELECT *
                       FROM v_missing_pairs`)
                .map((result) => result.values)
                .flat()
                .flat() as string[];
        });
    }

    async getMissingTokens(): Promise<string[]> {
        return this._queueDbCall(() => {
            return this._db
                .exec(`SELECT *
                       FROM v_missing_tokens`)
                .map((result) => result.values)
                .flat()
                .flat() as string[];
        });
    }

    async getMissingUsd(): Promise<string[]> {
        return await this._queueDbCall(() => {
            return this._db
                .exec(`SELECT *
                       FROM v_missing_usd`)
                .map((result) => result.values)
                .flat()
                .flat() as string[];
        });
    }

    async getMostRecentSignature(
        owner_address: string,
    ): Promise<string | undefined> {
        return await this._queueDbCall(() => {
            const signature = this._db
                .exec(
                    `
                        SELECT signature
                        FROM instructions i
                        WHERE owner_address = '${owner_address}'
                        ORDER BY block_time DESC LIMIT 1
                    `,
                )
                .map((result) => result.values)
                .flat()
                .flat();

            if (signature.length == 0) {
                return undefined;
            }
            return signature[0] as string;
        });
    }

    async getOldestSignature(owner_address: string): Promise<string | undefined> {
        return await this._queueDbCall(() => {
            const signature = this._db
                .exec(
                    `
                        WITH signatures AS (SELECT block_time,
                                                   signature
                                            FROM instructions
                                            WHERE owner_address = '${owner_address}'
                                            UNION
                                            SELECT oldest_block_time,
                                                   oldest_signature
                                            FROM completed_accounts
                                            WHERE account_address = '${owner_address}')
                        SELECT signature
                        FROM signatures
                        ORDER BY block_time LIMIT 1
                    `,
                )
                .map((result) => result.values)
                .flat()
                .flat();

            if (signature.length == 0) {
                return undefined;
            }
            return signature[0] as string;
        });
    }

    async getUsdTransactions(position_address: string): Promise<RaydiumUsdTx[]> {
        // 1. pull every transfer for this position
        const rows = await this._queueDbCall(() => {
            return this._db.exec(`
      SELECT
        t.signature,
        i.slot,
        i.block_time,
        t.mint,
        t.amount,
        tok.decimals
      FROM token_transfers t
        JOIN instructions i
          ON i.signature = t.signature
         AND i.position_address = t.position_address
        JOIN tokens tok
          ON tok.address = t.mint
      WHERE t.position_address = '${position_address}'
    `)[0]?.values ?? [];
        });

        if (rows.length === 0) return [];

        // 2. fetch spot prices for every mint (Raydium first, Jupiter fallback)
        const mints = [...new Set(rows.map(r => r[3]))] as string[];
        let prices: Record<string, number> = {};

        // Raydium price endpoint – returns { data: { mint: price } }
        try {
            const ray = await fetch(
                'https://api-v3.raydium.io/mint/price?ids=' + mints.join(',')
            ).then(r => r.json());
            prices = ray?.data ?? {};
        } catch { /* ignore – Jupiter fallback next */ }

        if (Object.keys(prices).length < mints.length) {
            const jup = await _getJupiterPrices(mints);
            prices = { ...jup, ...prices };   // Raydium price wins if duplicated
        }

        // 3. aggregate → usd-per-signature
        const map = new Map<string, RaydiumUsdTx>();

        for (const [signature, slot, blockTime, mint, rawAmount, decimals] of rows) {
            const key = signature as string;
            const amount = Number(rawAmount) / 10 ** Number(decimals);
            const usd = amount * (prices[mint as string] ?? 0);

            if (!map.has(key)) {
                map.set(key, {
                    signature: key,
                    slot: Number(slot),
                    blockTime: Number(blockTime),
                    usd: 0
                });
            }
            map.get(key)!.usd += usd;
        }

        return [...map.values()];
    }

    async addUsdTransactions(
        position_address: string,
        usdTxs: RaydiumUsdTx[]
    ) {
        await this._queueDbCall(() => {
            for (const tx of usdTxs) {
                // locate the instruction_type once for this tx
                const r = this._db.exec(`
        SELECT instruction_type
        FROM   instructions
        WHERE  signature = '${tx.signature}'
          AND  position_address = '${position_address}'
        LIMIT  1
      `)[0]?.values;

                if (!r?.length) continue;
                const instruction_type = r[0][0] as string;

                // split evenly across the two token rows
                const half = tx.usd / 2;

                this._addUsdXStatement.run({
                    $signature:        tx.signature,
                    $position_address: position_address,
                    $instruction_type: instruction_type,
                    $amount:           half,
                });
                this._addUsdYStatement.run({
                    $signature:        tx.signature,
                    $position_address: position_address,
                    $instruction_type: instruction_type,
                    $amount:           half,
                });
            }

            // finally flag any untouched rows as “attempted”
            this._fillMissingUsdStatement.run({ $position_address: position_address });
        });
    }

    async getOwnerTransactions(
        owner_address: string,
    ): Promise<ClmmDbTx[]> {
        return this._queueDbCall(() => {
            const result = this._db.exec(
                `SELECT *
                 FROM v_transactions
                 where owner_address = '${owner_address}'`,
            );
            const columns = result[0].columns;
            return result[0].values.map((row) => {
                const result: { [key: string]: any } = {};
                columns.forEach((key, i) => (result[key] = row[i]));
                return result as ClmmDbTx;
            });
        });
    }

    async cancelDownload(account: string) {
        this._downloaders.get(account)?.cancel();
        this._downloaders.delete(account);
        await this.save();
    }

    async getAllTransactions(): Promise<ClmmDbTx[]> {
        return this._getAll(this._getAllTransactions);
    }

    private async _getAll<ClmmDbRow>(
        statement: Statement,
    ): Promise<ClmmDbRow[]> {
        return await this._queueDbCall(() => {
            const output: ClmmDbRow[] = [];
            while (statement.step())
                output.push(statement.getAsObject() as ClmmDbRow);
            statement.reset();
            return output;
        });
    }

    private _queueDbCall<T>(fn: () => T): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this._queue.push(async () => {
                try {
                    const result = fn();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            });
            this._processQueue();
        });
    }

    private async _processQueue() {
        if (this._saving || this._queue.length == 0) {
            return;
        }
        this._saving = true;
        while (this._queue.length > 0) {
            const fn = this._queue.shift();
            if (fn) {
                fn();
            }
        }
        await this.save();
        this._saving = false;
        this._processQueue();
    }

    async save(): Promise<void> {
        this._saving = true;
        if (this.delaySave) {
            await this._waitUntilReady();
        }
        const data = this._db.export();
        this._db.close();
        await this._init(data);

        const {writeData} = isBrowser()
            ? await import("./browser-save")
            : await import("./node-save");
        await writeData(data);
    }

    private async _waitUntilReady() {
        while (this.delaySave) {
            await delay(10);
        }
    }

    async waitForSave() {
        while (this._saving) {
            await delay(10);
        }
    }
}