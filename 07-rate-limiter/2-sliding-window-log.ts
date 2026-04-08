
// =============================================================================
// SLIDING WINDOW LOG ALGORITHM — Rate Limiter
// =============================================================================
//
// CONCEPT:
//   For each client, maintain an ordered log of timestamps of past requests.
//   On every new request:
//     1. Drop all timestamps older than (now - windowMs)  ← the "slide"
//     2. If remaining log length >= limit → reject
//     3. Otherwise → allow and append current timestamp
//
// KEY PARAMETERS:
//   - limit    : max number of requests allowed in the window
//   - windowMs : rolling window size in milliseconds
//
// EXAMPLE:
//   limit=3, windowMs=1000ms (1 second rolling window)
//
//   t=0ms   → log=[]          → allow  → log=[0]
//   t=200ms → log=[0]         → allow  → log=[0,200]
//   t=400ms → log=[0,200]     → allow  → log=[0,200,400]
//   t=500ms → log=[0,200,400] → REJECT (3 requests already in window)
//   t=1100ms→ evict t=0       → log=[200,400] → allow → log=[200,400,1100]
//
// HOW IT DIFFERS FROM FIXED WINDOW:
//   Fixed window resets the counter at fixed intervals (e.g., every full second).
//   Problem: a client can fire (limit) requests at t=0.99s and (limit) more at t=1.01s
//   — that's 2× the limit in a 20ms real window. Sliding Window Log fixes this
//   because the window always looks back exactly `windowMs` from *now*.
//
// WHY SLIDING WINDOW LOG?
//   ✓ Perfectly accurate — no boundary spikes possible
//   ✓ Easy to reason about and implement
//   ✗ Memory cost: O(limit) timestamps stored per client
//   ✗ log.shift() on every request is O(n) — can be slow for high-limit windows
//      (use a deque/circular buffer to bring eviction to O(1) in production)
//
// vs. SLIDING WINDOW COUNTER (next file):
//   Counter trades perfect accuracy for O(1) time and O(1) space per client.
//   Log is exact but heavier; Counter is approximate but lightweight.
//
// REAL-WORLD USE CASES:
//   - Strict per-user API quotas where exact counts matter (billing, compliance)
//   - Low-traffic endpoints where memory overhead is acceptable
//
// TIME COMPLEXITY : O(n) worst case per request (eviction loop), where n = log length
// SPACE COMPLEXITY: O(limit) per client — at most `limit` timestamps stored
//
// =============================================================================

class SlidingWindowLog {

    private logs = new Map<string, number[]>();

    constructor(
        private limit: number, // max requests
        private windowMs: number // window size in milliseconds
    ) {}

    allow(clientId: string): boolean {
        const now = Date.now();
        const windowStart = now - this.windowMs;

        // Initialize log for new clients
        if (!this.logs.has(clientId)) {
            this.logs.set(clientId, [])
        }
        const log = this.logs.get(clientId)!;

        // Evict timestamps that are outside the current window
        while (log.length && log[0] <= windowStart) {
            log.shift(); // Remove timestamps outside the window
        }

        if (log.length >= this.limit) {
            return false; // Too many requests in the current window
        }

        log.push(now); // Record this request
        return true; // Request allowed
    }
}
