
// =============================================================================
// SLIDING WINDOW COUNTER ALGORITHM — Rate Limiter
// =============================================================================
//
// CONCEPT:
//   A memory-efficient approximation of the Sliding Window Log.
//   Instead of storing every timestamp, we only store two integer counters:
//     - prevCount : requests in the previous fixed window
//     - currCount : requests in the current fixed window
//   The "sliding" effect is achieved by linearly interpolating between the two:
//
//     elapsed  = (now - windowStart) / windowMs       ← how far into current window (0→1)
//     estimate = prevCount * (1 - elapsed) + currCount
//
//   As elapsed grows from 0→1, the weight on prevCount fades from 1→0,
//   smoothly blending the past window into the present.
//
// EXAMPLE (limit=10, windowMs=1000ms):
//
//   Previous window: 8 requests
//   Current window start: t=0ms, currCount=3
//   Request arrives at t=600ms → elapsed = 0.6
//
//   estimate = 8 * (1 - 0.6) + 3
//            = 8 * 0.4 + 3
//            = 3.2 + 3
//            = 6.2  → below limit=10 → ALLOW
//
//   If currCount were already 7:
//   estimate = 8 * 0.4 + 7 = 10.2 → REJECT
//
// WINDOW ROLLING (what happens when a new fixed window begins):
//   When now - windowStart >= windowMs, we "roll":
//     prevCount = currCount   (current becomes the new "previous")
//     currCount = 0           (reset for fresh window)
//     windowStart = now
//   Special case: if more than 2 full windows have elapsed with no traffic,
//   prevCount resets to 0 (client was idle long enough that the past is irrelevant).
//
// WHY SLIDING WINDOW COUNTER?
//   ✓ O(1) time and O(1) space per client — just 3 numbers stored
//   ✓ No timestamp log, no eviction loop
//   ✓ Smooths the boundary spike problem of Fixed Window
//   ✗ Approximation only — up to ~5% error at window boundaries
//      (assumes traffic was uniformly distributed in prev window, which may not be true)
//
// THE ~5% ERROR (key interview insight):
//   The linear weighting assumes requests were spread evenly across the previous window.
//   Worst case: all prev requests clustered at the very end of that window → we
//   underestimate and allow slightly more than intended. In practice this error
//   is ≤ 5% and is acceptable for most production rate limiting.
//
// vs. SLIDING WINDOW LOG:
//   Log   → exact, but O(limit) memory and O(n) eviction per request
//   Counter → ~5% error, but O(1) memory and O(1) time — scales to millions of clients
//
// REAL-WORLD USE CASES:
//   - High-traffic API gateways (Cloudflare, Nginx rate limiting modules)
//   - Redis-backed distributed rate limiters (store prevCount, currCount, windowStart per key)
//   - Any scenario where exact precision is less important than scale and performance
//
// TIME COMPLEXITY : O(1) per request
// SPACE COMPLEXITY: O(1) per client — only 3 values stored regardless of traffic volume
//
// =============================================================================

interface WindowState {
    prevCount: number;
    currCount: number;
    windowStart: number;
}

class SlidingWindowCounter {
    private windows = new Map<string, WindowState>();

    constructor(
        private limit: number, // max requests,
        private windowMs: number // window size in milliseconds
    ) {}

    allow(clientId: string): boolean {
        const now = Date.now();
        let window = this.windows.get(clientId);

        // Initialize window state for new clients
        if (!window) {
            window = { prevCount: 0, currCount: 0, windowStart: now };
        }

        // Roll the window if current time has passed the window duration
        if (now - window.windowStart >= this.windowMs) {
            window.prevCount = now - window.windowStart >= 2 * this.windowMs ?
            0 : window.currCount; // If we skipped more than 2 windows, reset prevCount

            window.currCount = 0;
            window.windowStart = now;
        }

        // Calculate the weighted count of requests in the current window
        const elapsed = (now - window.windowStart) / this.windowMs;
        const estimate = window.prevCount * (1 - elapsed) + window.currCount; // Weighted count of requests in the current window

        if (estimate >= this.limit) {
            return false; // Too many requests, reject
        }

        window.currCount += 1; // Record this request
        this.windows.set(clientId, window);
        return true; // Request allowed
    }
}

// The ~5% error: At the boundary between windows, this algorithm estimates how many requests from the previous window are still "in scope" using a linear weighting.
// This is an approximation — the actual count could differ by up to ~5% from the true sliding window. Acceptable for most production use cases.
