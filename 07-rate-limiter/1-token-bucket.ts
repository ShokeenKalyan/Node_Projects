
// =============================================================================
// TOKEN BUCKET ALGORITHM — Rate Limiter
// =============================================================================
//
// CONCEPT:
//   Imagine a bucket that holds tokens. Each request consumes 1 token.
//   Tokens are refilled at a steady rate over time (up to the bucket's capacity).
//   If the bucket is empty, the request is rejected until tokens refill.
//
// KEY PARAMETERS:
//   - capacity    : max tokens the bucket can hold  → controls burst size
//   - refillRate  : tokens added per second         → controls sustained throughput
//
// BEHAVIOUR EXAMPLES:
//   capacity=10, refillRate=2 tokens/sec
//   → A client can burst 10 requests instantly, then sustain 2 req/sec afterward.
//
//   capacity=1, refillRate=1 token/sec
//   → Strictly 1 req/sec, no bursting allowed.
//
// WHY TOKEN BUCKET?
//   ✓ Allows controlled bursts (unlike Leaky Bucket which enforces a strict queue)
//   ✓ Simple math — no queue needed
//   ✓ Per-client state is tiny: just { tokens, lastRefill }
//   ✗ A fully-charged bucket can still produce a large burst — consider this in design
//
// LAZY REFILL PATTERN (key interview insight):
//   Instead of a background timer (setInterval) refilling tokens for every client,
//   we calculate accumulated tokens only when a request arrives:
//     newTokens = elapsed_ms * refillRate / 1000
//   This avoids memory/CPU overhead of per-client background tasks.
//
// REAL-WORLD USE CASES:
//   - API gateways (AWS API Gateway, Kong)
//   - Per-user/IP rate limiting in REST APIs
//   - Controlling DB query rates
//
// TIME COMPLEXITY : O(1) per request
// SPACE COMPLEXITY: O(n) — one bucket entry per unique client
//
// =============================================================================

interface BucketState {
    tokens: number;
    lastRefill: number;
}

class TokenBucketLimiter {
    private buckets = new Map<string, BucketState>();

    constructor(
        private capacity: number, // Max tokens (Burst Size)
        private refillRate: number // Tokens added per second (Refill Rate)
    ) {}

    allow(clientId: string): boolean {
        const now = Date.now(); // seconds
        let bucket = this.buckets.get(clientId);

        if (!bucket) {
            // New client, start with a full bucket
            bucket = { tokens: this.capacity, lastRefill: now };
            this.buckets.set(clientId, bucket);
        }

        // Refill tokens based on elapsed time since last check
        const elapsed = now - bucket.lastRefill;
        bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillRate / 1000);
        bucket.lastRefill = now;

        if ( bucket.tokens < 1) {
            return false; // Not enough tokens, reject the request
        }

        bucket.tokens = bucket.tokens - 1; // Consume a token
        return true; // Request allowed
    }

    // How long until the next token is available (for Retry-After header)
    retryAfterMs(clientId: string): number {
        const bucket = this.buckets.get(clientId);
        if (!bucket || bucket.tokens >= 1) {
            return 0;
        }
        return Math.ceil((1 - bucket.tokens) * 1000 / this.refillRate); // Time until next token is available
    }

}

// ✓ The lazy refill insight: "I don't run a setInterval to refill tokens.
// Instead, on every request I calculate how many tokens should have accumulated since the last check: elapsed × rate.
// This avoids a background timer for every client and keeps memory clean."
