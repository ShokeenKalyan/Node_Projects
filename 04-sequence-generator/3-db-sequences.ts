
// =============================================================================
// DATABASE SEQUENCES — PostgreSQL SEQUENCE & MySQL AUTO_INCREMENT
// =============================================================================
//
// MOTIVATION:
//   Most engineers use `SERIAL` or `AUTO_INCREMENT` without thinking about what
//   the DB is actually doing. Understanding the internals is a strong signal in
//   system design interviews — especially around gaps, concurrency, and performance.
//
// =============================================================================
// POSTGRESQL — SEQUENCE object
// =============================================================================
//
// PostgreSQL implements sequences as independent DB objects (not tied to a table).
// SERIAL / BIGSERIAL are syntactic sugar that create a SEQUENCE + DEFAULT for you.
//
// HOW IT WORKS INTERNALLY:
//   1. A SEQUENCE is a special single-row relation stored on disk.
//   2. nextval('seq') increments the counter and returns the new value atomically.
//   3. CACHE (default=1): Postgres can pre-allocate N values into session memory.
//      With CACHE 20, each backend fetches 20 values at once → 20× fewer disk writes.
//   4. The counter is updated with an un-logged WAL record (survives crash, but
//      if CACHE > 1, unused cached values are lost on crash → gaps appear).
//
// GAPS ARE NORMAL AND BY DESIGN:
//   - ROLLBACK: a transaction that called nextval() and then rolled back still
//     "consumed" that sequence value — it will never be reused.
//   - CACHE: unused pre-allocated values are lost on server restart.
//   - Gaps are acceptable in almost all real systems. "Gapless" sequences require
//     table-level locks and are rarely worth the trade-off.
//
// SQL — CREATING AND USING A SEQUENCE:

// -- Create a standalone sequence (full control over start, step, cache):
// CREATE SEQUENCE order_id_seq
//   START WITH 1000        -- first value returned
//   INCREMENT BY 1
//   NO MINVALUE
//   NO MAXVALUE
//   CACHE 20;              -- pre-allocate 20 values per session for performance
//
// -- Fetch next value:
// SELECT nextval('order_id_seq');   -- → 1000, 1001, 1002 ...
//
// -- Peek at current value (does NOT advance):
// SELECT currval('order_id_seq');   -- only valid after nextval in the same session
//
// -- Reset sequence (useful in tests / migrations):
// ALTER SEQUENCE order_id_seq RESTART WITH 1;

// -- SERIAL shorthand (most common usage — auto-creates sequence behind the scenes):
// CREATE TABLE orders (
//   id    BIGSERIAL PRIMARY KEY,   -- = BIGINT + sequence + DEFAULT nextval(...)
//   item  TEXT NOT NULL
// );
// INSERT INTO orders (item) VALUES ('Widget') RETURNING id;  -- → unique id

// -- IDENTITY column (SQL-standard syntax, preferred over SERIAL in Postgres 10+):
// CREATE TABLE orders (
//   id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
//   item  TEXT NOT NULL
// );

// =============================================================================
// POSTGRESQL — Node.js Usage (pg / node-postgres)
// =============================================================================
//
// In application code, you typically don't call nextval() directly.
// INSERT ... RETURNING id is the idiomatic pattern — the DB generates the ID
// and returns it in the same round-trip, so you can use it immediately.

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Insert a row and get back the generated ID in one query (no extra SELECT needed)
async function createOrder(item: string): Promise<number> {
    const result = await pool.query<{ id: number }>(
        'INSERT INTO orders (item) VALUES ($1) RETURNING id',
        [item]
    );
    return result.rows[0].id;
}

// Fetch next sequence value explicitly (useful for generating IDs before insert,
// e.g., when you need to reference the ID in multiple places before committing)
async function reserveOrderId(): Promise<number> {
    const result = await pool.query<{ nextval: string }>(
        "SELECT nextval('order_id_seq')"
    );
    return parseInt(result.rows[0].nextval, 10);
}

// =============================================================================
// MYSQL — AUTO_INCREMENT
// =============================================================================
//
// MySQL (and MariaDB) embed the auto-increment counter inside the table definition
// rather than as a separate object like PostgreSQL's SEQUENCE.
//
// HOW IT WORKS:
//   - Counter stored in the table's metadata (in InnoDB, in the tablespace header).
//   - On INSERT with no explicit id, MySQL locks the counter, increments it,
//     assigns it to the row, and releases the lock.
//   - "auto_increment_increment" and "auto_increment_offset" system variables
//     let you configure step size and starting offset — used in multi-master setups
//     (e.g., server A uses odd IDs, server B uses even IDs).
//
// GAPS IN MYSQL:
//   Same root causes as PostgreSQL: rollbacks and InnoDB's internal pre-allocation.
//   InnoDB pre-allocates auto-increment values in batches internally and does NOT
//   give them back on rollback — gaps are inevitable.
//
// IMPORTANT MYSQL GOTCHA:
//   In MySQL < 8.0, the AUTO_INCREMENT counter was only stored in memory —
//   it reset to MAX(id)+1 on server restart, potentially reusing IDs if rows
//   were deleted. Fixed in MySQL 8.0 (counter persisted to redo log).
//
// SQL:

// -- Basic table with AUTO_INCREMENT:
// CREATE TABLE orders (
//   id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
//   item  VARCHAR(255)   NOT NULL,
//   PRIMARY KEY (id)
// ) ENGINE=InnoDB;
//
// INSERT INTO orders (item) VALUES ('Widget');
// SELECT LAST_INSERT_ID();   -- → the generated id for this connection
//
// -- Check current counter:
// SHOW TABLE STATUS LIKE 'orders';  -- Auto_increment column shows next value
//
// -- Reset counter (only safe if table is empty or you know max(id)):
// ALTER TABLE orders AUTO_INCREMENT = 1;
//
// -- Multi-master setup (odd/even IDs to avoid conflicts):
// SET @@auto_increment_increment = 2;   -- step size
// SET @@auto_increment_offset    = 1;   -- server A starts at 1: 1, 3, 5 ...
// -- server B: offset=2 → 2, 4, 6 ...

// MySQL Node.js usage (mysql2):
import mysql from 'mysql2/promise';

const mysqlPool = mysql.createPool({ uri: process.env.MYSQL_URL });

async function createOrderMysql(item: string): Promise<number> {
    const [result] = await mysqlPool.execute(
        'INSERT INTO orders (item) VALUES (?)',
        [item]
    ) as [mysql.ResultSetHeader, unknown];
    return result.insertId; // auto-generated ID returned by mysql2 driver
}

// =============================================================================
// COMPARISON: PostgreSQL SEQUENCE vs MySQL AUTO_INCREMENT
// =============================================================================
//
//  Feature                    | PostgreSQL SEQUENCE        | MySQL AUTO_INCREMENT
//  ---------------------------|----------------------------|----------------------
//  Scope                      | Independent DB object      | Embedded in table
//  Reuse across tables        | ✓ yes (share one sequence) | ✗ per-table only
//  Custom step / start        | ✓ full control             | ✓ limited (global vars)
//  Pre-allocation (cache)     | ✓ configurable             | ✓ internal only
//  Gaps on rollback           | ✓ yes (by design)          | ✓ yes (by design)
//  Persist across restart     | ✓ always                   | ✓ MySQL 8.0+ only
//  Multi-master support       | via sequences per shard    | auto_increment_offset
//  Get ID after insert        | RETURNING id               | LAST_INSERT_ID()
//
// =============================================================================
// INTERVIEW TALKING POINTS
// =============================================================================
//
// "Why are gaps okay?"
//   Gaps signal that transactions occurred and were rolled back, or that the server
//   crashed mid-operation. They don't imply data loss. Gapless sequences require
//   serialized table-level locks — a massive throughput bottleneck not worth it
//   for cosmetic sequential appearance.
//
// "How would you generate IDs before inserting (e.g. for event sourcing)?"
//   Use PostgreSQL's nextval() to reserve an ID, then include it explicitly in
//   the INSERT. This lets you write the ID to a message queue before the row
//   exists, while still using DB sequences for uniqueness guarantees.
//
// "When would you NOT use DB sequences?"
//   - When you need IDs generated at the application layer (offline, no DB connection)
//   - When you have multiple DB shards (sequences are per-database, not global)
//   - When you need globally unique IDs across heterogeneous systems → use UUID/Snowflake
