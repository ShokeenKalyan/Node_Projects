
// =============================================================================
// SEQUENCE GENERATOR — From Basic to Production-Grade
// =============================================================================
//
// PROBLEM:
//   Generate unique, ordered IDs for entities (orders, users, transactions).
//   Requirements escalate quickly:
//     Level 1 → just works in a single process
//     Level 2 → survives restarts (persistent)
//     Level 3 → safe under concurrent requests (atomic)
//     Level 4 → scales across multiple servers (distributed)
//     Level 5 → high-throughput without hitting DB on every request (batching)
//
// =============================================================================
// LEVEL 1 — Basic In-Memory Counter (Single Process)
// =============================================================================
//
// Simplest possible approach: a class that increments a number on each call.
// Works fine in a single-process, single-instance environment.
//
// PROBLEMS:
//   ✗ State is lost on server restart (not persistent)
//   ✗ Multiple server instances generate duplicate IDs (not distributed-safe)
//   ✗ No concurrency control (race conditions in async code without locks)

class SequenceGenerator {
    private current: number;

    constructor(start = 1) {
        this.current = start;
    }

    next(): number {
        return this.current++;
    }
}

const gen = new SequenceGenerator();
console.log(gen.next()); // 1
console.log(gen.next()); // 2

// =============================================================================
// LEVEL 2 — Persistent + Concurrent-Safe via Database Atomic UPDATE
// =============================================================================
//
// Store the sequence in a DB table. Use an atomic UPDATE + RETURNING to
// both increment and read the new value in a single operation.
// The DB engine serializes concurrent writes — no two requests get the same value.
//
// SQL SCHEMA:
//   CREATE TABLE sequences (
//     name  VARCHAR PRIMARY KEY,
//     value BIGINT
//   );
//
// SQL OPERATION (atomic increment and fetch):
//   UPDATE sequences
//   SET    value = value + 1
//   WHERE  name = 'order_id'
//   RETURNING value;
//
// WHY THIS WORKS:
//   The DB guarantees atomicity of the UPDATE statement.
//   Even with 1000 concurrent requests, each gets a distinct value.
//   State persists across server restarts since it lives in the DB.
//
// TRADE-OFF:
//   ✓ Simple, correct, persistent
//   ✗ 1 DB round-trip per ID → becomes a bottleneck at high throughput

// =============================================================================
// LEVEL 3 — High-Throughput Optimization: Batch Allocation
// =============================================================================
//
// Instead of going to the DB for every single ID, reserve a range of IDs
// at once and serve them locally from memory. Only hit the DB when the
// local batch is exhausted.
//
//   Without batching:   req1→DB, req2→DB, req3→DB  (N round-trips for N IDs)
//   With batching:      reserve [1000–1999] from DB, serve 1000 IDs locally
//                       → 1 round-trip per 1000 IDs (1000× fewer DB hits)
//
// TRADE-OFF:
//   ✓ Massive reduction in DB load — scales to very high throughput
//   ✗ IDs are not perfectly sequential across restarts
//      (unused batch IDs are lost on crash: gaps like 1000→2000→... appear)
//   ✗ Gaps are fine for most use cases — only a problem if you need gapless IDs

class BatchSequenceGenerator {
    private current: number = 0;
    private max: number = -1;

    constructor(
        private fetchBatchFn: (size: number) => Promise<{ start: number; end: number }>,
        private batchSize: number = 1000
    ) {}

    async next(): Promise<number> {
        if (this.current > this.max) {
            // Batch exhausted — fetch next range from DB
            const { start, end } = await this.fetchBatchFn(this.batchSize);
            this.current = start;
            this.max = end;
        }
        return this.current++;
    }
}

// =============================================================================
// LEVEL 4 — Distributed Systems: Three Common Approaches
// =============================================================================
//
// When you have multiple server instances, each needs to generate globally
// unique IDs without coordinating on every request.
//
// ── APPROACH A: Central DB (simple, single point of contention) ──────────────
//   All instances hit one DB table. Works but the DB is the bottleneck.
//   Same as Level 2 above. Fine for moderate scale.
//
// ── APPROACH B: Redis INCR (very common in production) ───────────────────────
//   Redis guarantees atomic single-threaded command execution.
//   INCR order_id  → returns next integer, guaranteed unique across all callers.
//   ✓ Extremely fast (~100k ops/sec on a single Redis node)
//   ✓ Simple — one line of Redis
//   ✗ Redis becomes a dependency; needs replication for HA
//
// ── APPROACH C: Snowflake Algorithm (no central coordination) ─────────────────
//   Each server generates IDs locally using a composite bit layout:
//
//   | 41 bits timestamp | 10 bits machine_id | 12 bits sequence |
//     (ms since epoch)    (unique per node)    (per-ms counter)
//
//   Result: a 63-bit integer that is:
//     ✓ Globally unique  — machine_id differentiates nodes
//     ✓ Roughly time-ordered — good for DB index locality (B-tree friendly)
//     ✓ No central bottleneck — each node is fully independent
//     ✓ Embeds machine ID — useful for debugging ("which server made this ID?")
//     ✗ Requires unique machineId assignment per instance (e.g., from config/env)
//     ✗ Clock skew between servers can cause issues (mitigate: reject if clock drifts back)

class Snowflake {
    private sequence: number = 0;
    private lastTimestamp: number = -1;

    constructor(private machineId: number) {}

    nextId(): number {
        let timestamp = Date.now();

        if (timestamp === this.lastTimestamp) {
            this.sequence++;             // Same millisecond — bump sequence
        } else {
            this.sequence = 0;          // New millisecond — reset sequence
        }

        this.lastTimestamp = timestamp;

        // Compose the 63-bit ID using bitwise OR of shifted fields
        return (
            (timestamp << 22) |         // 41 bits of ms timestamp
            (this.machineId << 12) |    // 10 bits of machine identity
            this.sequence               // 12 bits for per-ms sequence (up to 4096/ms per node)
        );
    }
}

// =============================================================================
// LEVEL 5 — Formatting (Business / UI Requirement)
// =============================================================================
//
// Raw numeric IDs are often transformed into human-readable strings for
// display, URLs, receipts, or customer support references.
//
// Example: internal ID 42 → customer-facing "ORD-000042"
//
// padStart(6, '0') left-pads with zeros to ensure fixed-width formatting.
// Prefix (e.g., "ORD-") makes the ID's entity type self-documenting.

function formatId(id: number): string {
    return `ORD-${String(id).padStart(6, '0')}`;
}

console.log(formatId(42));    // "ORD-000042"
console.log(formatId(1000));  // "ORD-001000"
