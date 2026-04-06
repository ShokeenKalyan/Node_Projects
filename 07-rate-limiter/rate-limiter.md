# Rate Limiter — Complete Reference Guide

> **Context:** GoDaddy Senior Backend Engineer Interview Prep  
> **Topic:** Implementing rate limiting algorithms in Node.js + TypeScript  
> **Key message:** Always ask which algorithm fits the use case before writing code. Token bucket for bursty APIs, sliding window log for strict quotas, sliding window counter for high-scale approximation.

---

## Table of Contents

1. [What Is a Rate Limiter?](#1-what-is-a-rate-limiter)
2. [The Four Algorithms — Know All, Pick the Right One](#2-the-four-algorithms--know-all-pick-the-right-one)
3. [The Boundary Spike Problem](#3-the-boundary-spike-problem)
4. [Algorithm 1 — Token Bucket](#4-algorithm-1--token-bucket)
5. [Algorithm 2 — Sliding Window Log](#5-algorithm-2--sliding-window-log)
6. [Algorithm 3 — Sliding Window Counter](#6-algorithm-3--sliding-window-counter)
7. [Algorithm 4 — Fixed Window Counter](#7-algorithm-4--fixed-window-counter)
8. [Express Middleware — Production Quality](#8-express-middleware--production-quality)
9. [Key Extraction Strategies](#9-key-extraction-strategies)
10. [HTTP Headers — Always Set These](#10-http-headers--always-set-these)
11. [Distributed Rate Limiting with Redis](#11-distributed-rate-limiting-with-redis)
12. [Algorithm Comparison Table](#12-algorithm-comparison-table)
13. [Key Interview Talking Points](#13-key-interview-talking-points)
14. [Common Interview Follow-up Questions](#14-common-interview-follow-up-questions)

---

## 1. What Is a Rate Limiter?

A rate limiter controls how many requests a client can make within a time window. It protects backend services from:

- **Abuse** — malicious clients hammering endpoints
- **Overload** — well-intentioned clients sending too much traffic
- **Cost control** — limiting expensive operations (DB writes, external API calls)
- **Fair use** — preventing one client from starving others

At GoDaddy specifically: domain registration APIs, domain search (high volume), login/auth flows, and public APIs all need rate limiting.

---

## 2. The Four Algorithms — Know All, Pick the Right One

**The question to ask first:** "Before I implement — is this for bursty traffic where short bursts should be allowed, or strictly smooth throughput? Do I need exact counts or is ~5% approximation acceptable?"

| Algorithm | Space | Burst allowed? | Accuracy | Best for |
|---|---|---|---|---|
| Token bucket | O(1) per client | Yes — up to capacity | Exact | APIs with natural bursty traffic |
| Sliding window log | O(limit) per client | No | Exact | Strict per-user quotas |
| Sliding window counter | O(1) per client | No | ~95% | High-scale, approximation acceptable |
| Fixed window counter | O(1) per client | At boundaries | Exact within window | Coarse limits, simple to reason about |

---

## 3. The Boundary Spike Problem

This is the killer weakness of **fixed window counter** — bring it up proactively.

```
Window 1: 11:59:00 → 11:59:59  (limit: 100 req/min)
Window 2: 12:00:00 → 12:00:59

Scenario:
  11:59:58 — client sends 100 requests  → allowed (window 1 at limit)
  12:00:00 — client sends 100 requests  → allowed (window 2 resets)

Result: 200 requests in 2 seconds — 2× the intended limit
```

Token bucket and sliding window algorithms prevent this because they look at actual elapsed time, not window boundaries.

---

## 4. Algorithm 1 — Token Bucket

### How it works

- Bucket holds up to `capacity` tokens
- Tokens are added at `refillRate` per second
- Each request consumes 1 token
- If bucket is empty → request rejected
- Bucket never exceeds capacity

### The lazy refill insight

**Never use `setInterval` to refill tokens.** Instead, on every request compute:

```
tokensToAdd = elapsed_seconds × refillRate
newTokens   = min(capacity, currentTokens + tokensToAdd)
```

This is "lazy refill" — tokens are computed on demand from elapsed time. No background timer needed, no memory leak from per-client intervals.

### Implementation

```typescript
interface BucketState {
  tokens:     number;  // current token count (can be fractional)
  lastRefill: number;  // timestamp in seconds of last check
}

class TokenBucketLimiter {
  private buckets = new Map<string, BucketState>();

  constructor(
    private capacity:   number,  // max tokens (= max burst size)
    private refillRate: number,  // tokens added per second
  ) {}

  allow(clientId: string): boolean {
    const now = Date.now() / 1000;  // work in seconds for rate math
    let bucket = this.buckets.get(clientId);

    if (!bucket) {
      // New client — start with a full bucket
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(clientId, bucket);
    }

    // Lazy refill — tokens accumulated since last check
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsed * this.refillRate
    );
    bucket.lastRefill = now;

    if (bucket.tokens < 1) return false;  // insufficient tokens

    bucket.tokens -= 1;  // consume one token
    return true;
  }

  // Returns ms until next token is available — used for Retry-After header
  retryAfterMs(clientId: string): number {
    const bucket = this.buckets.get(clientId);
    if (!bucket || bucket.tokens >= 1) return 0;
    return Math.ceil((1 - bucket.tokens) / this.refillRate * 1000);
  }

  remaining(clientId: string): number {
    const bucket = this.buckets.get(clientId);
    if (!bucket) return this.capacity;
    const now = Date.now() / 1000;
    const elapsed = now - bucket.lastRefill;
    return Math.min(this.capacity, bucket.tokens + elapsed * this.refillRate);
  }
}
```

### Behaviour examples

```
capacity=5, refillRate=1 token/sec

t=0:    tokens=5, request arrives → tokens=4, ALLOW
t=0.1:  tokens=4, request arrives → tokens=3, ALLOW
t=0.2:  tokens=3, request arrives → tokens=2, ALLOW
t=0.3:  tokens=2, request arrives → tokens=1, ALLOW
t=0.4:  tokens=1, request arrives → tokens=0, ALLOW
t=0.5:  tokens=0, request arrives → DENY (retry in 500ms)
t=1.5:  tokens=1.0, request arrives → tokens=0, ALLOW
```

---

## 5. Algorithm 2 — Sliding Window Log

### How it works

Maintain a sorted list of timestamps for each client. On each request:
1. Remove all timestamps older than `windowMs` ago
2. If count ≥ limit → reject
3. Otherwise → append current timestamp and allow

### Implementation

```typescript
class SlidingWindowLog {
  // Map of clientId → sorted array of request timestamps (ms)
  private logs = new Map<string, number[]>();

  constructor(
    private limit:    number,  // max requests in window
    private windowMs: number,  // window size in ms
  ) {}

  allow(clientId: string): boolean {
    const now         = Date.now();
    const windowStart = now - this.windowMs;

    if (!this.logs.has(clientId)) this.logs.set(clientId, []);
    const log = this.logs.get(clientId)!;

    // Evict timestamps outside the window — critical for memory management
    while (log.length && log[0] <= windowStart) log.shift();

    if (log.length >= this.limit) return false;

    log.push(now);  // record this request's timestamp
    return true;
  }

  remaining(clientId: string): number {
    const log = this.logs.get(clientId) ?? [];
    const windowStart = Date.now() - this.windowMs;
    const recent = log.filter(t => t > windowStart);
    return Math.max(0, this.limit - recent.length);
  }

  resetAt(clientId: string): number {
    const log = this.logs.get(clientId) ?? [];
    if (!log.length) return Date.now() + this.windowMs;
    return log[0] + this.windowMs;  // oldest entry + window = when it expires
  }
}
```

### Trade-offs

- **Pros:** Exact counts, no boundary spike problem, simple to reason about
- **Cons:** Memory grows with traffic — stores one timestamp per request per client. For `limit=1000`, each client can consume 1000 timestamp entries

---

## 6. Algorithm 3 — Sliding Window Counter

### How it works

Approximate a sliding window using two fixed counters (current window + previous window). Weight the previous window's count by how much of it is still "in scope":

```
estimate = prevCount × (1 - elapsed/windowMs) + currCount
```

Uses O(1) space per client regardless of limit size.

### Implementation

```typescript
interface WindowState {
  prevCount:   number;
  currCount:   number;
  windowStart: number;  // timestamp when current window started
}

class SlidingWindowCounter {
  private windows = new Map<string, WindowState>();

  constructor(
    private limit:    number,
    private windowMs: number,
  ) {}

  allow(clientId: string): boolean {
    const now = Date.now();
    let w = this.windows.get(clientId)
          ?? { prevCount: 0, currCount: 0, windowStart: now };

    // Roll window forward if current window has expired
    if (now - w.windowStart >= this.windowMs) {
      w.prevCount = (now - w.windowStart) < this.windowMs * 2
        ? w.currCount  // previous window is immediately adjacent
        : 0;           // there's a gap — prev window is irrelevant
      w.currCount  = 0;
      w.windowStart = now;
    }

    // Weighted estimate: fraction of previous window still "in scope"
    const elapsed  = (now - w.windowStart) / this.windowMs;
    const estimate = w.prevCount * (1 - elapsed) + w.currCount;

    if (estimate >= this.limit) return false;

    w.currCount++;
    this.windows.set(clientId, w);
    return true;
  }
}
```

### The ~5% error

At the window boundary, this algorithm estimates how much of the previous window is still relevant using linear interpolation. The true sliding window might show slightly different counts. This ~5% error is acceptable for most production use cases.

---

## 7. Algorithm 4 — Fixed Window Counter

```typescript
class FixedWindowCounter {
  private windows = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private limit:    number,
    private windowMs: number,
  ) {}

  allow(clientId: string): boolean {
    const now = Date.now();
    let w = this.windows.get(clientId);

    // New client or window has expired — reset
    if (!w || now - w.windowStart >= this.windowMs) {
      w = { count: 0, windowStart: now };
      this.windows.set(clientId, w);
    }

    if (w.count >= this.limit) return false;

    w.count++;
    return true;
  }
}
```

**Warning:** Subject to boundary spike problem. Use token bucket or sliding window unless you explicitly need the simpler reset behaviour.

---

## 8. Express Middleware — Production Quality

```typescript
import { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  limit:      number;                              // max requests
  windowMs:   number;                              // window in ms
  keyFn?:     (req: Request) => string;           // extract client identifier
  onLimited?: (req: Request, res: Response) => void; // custom 429 handler
}

function createRateLimiter(opts: RateLimitOptions) {
  const limiter = new SlidingWindowLog(opts.limit, opts.windowMs);
  const getKey  = opts.keyFn ?? ((req) => req.ip ?? 'unknown');

  return (req: Request, res: Response, next: NextFunction) => {
    const key     = getKey(req);
    const allowed = limiter.allow(key);

    // Always set rate limit headers — even on allowed requests
    // Well-behaved clients use these to throttle themselves proactively
    res.setHeader('X-RateLimit-Limit',     opts.limit);
    res.setHeader('X-RateLimit-Remaining', limiter.remaining(key));
    res.setHeader('X-RateLimit-Reset',     limiter.resetAt(key));

    if (!allowed) {
      // Retry-After tells client how many seconds to wait
      res.setHeader('Retry-After', Math.ceil(opts.windowMs / 1000));

      if (opts.onLimited) return opts.onLimited(req, res);

      return res.status(429).json({
        error:      'Too Many Requests',
        retryAfter: Math.ceil(opts.windowMs / 1000),
      });
    }

    next();
  };
}
```

### Usage — different limits per route

```typescript
// Global limit: 100 req/min per IP across all routes
const globalLimit = createRateLimiter({
  limit:    100,
  windowMs: 60_000,
});

// Tight limit on login — prevent brute force
const loginLimit = createRateLimiter({
  limit:    5,
  windowMs: 60_000,
  keyFn:    (req) => `login:${req.ip}`,
  onLimited: (_, res) => res.status(429).json({
    error: 'Too many login attempts. Try again in 1 minute.',
  }),
});

// Per-user limit after authentication
const apiLimit = createRateLimiter({
  limit:    1000,
  windowMs: 60_000,
  keyFn:    (req) => `user:${(req as any).user?.id ?? req.ip}`,
});

app.use(globalLimit);                              // applies to all routes
app.post('/auth/login', loginLimit, loginHandler);
app.use('/api', apiLimit, apiRouter);
```

---

## 9. Key Extraction Strategies

The `keyFn` determines the granularity of rate limiting:

```typescript
// By IP — simplest, works without auth
// Caveat: shared IPs (corporate NAT, mobile proxies) can cause false positives
keyFn: (req) => req.ip ?? 'unknown'

// By authenticated user — after auth middleware
// Per-user quota, not affected by shared IPs
keyFn: (req) => `user:${(req as any).user?.id}`

// By API key — for developer plans
keyFn: (req) => `apikey:${req.headers['x-api-key']}`

// Composite — per IP + per endpoint (different budgets for expensive operations)
keyFn: (req) => `${req.ip}:${req.path}`

// Behind a load balancer — trust X-Forwarded-For
// IMPORTANT: only trust this header when you control the proxy
keyFn: (req) => {
  const forwarded = req.headers['x-forwarded-for'] as string;
  return forwarded?.split(',')[0].trim() ?? req.ip ?? 'unknown';
}

// Tiered by user plan
keyFn: (req) => {
  const user = (req as any).user;
  return `${user?.plan ?? 'anon'}:${user?.id ?? req.ip}`;
}
```

---

## 10. HTTP Headers — Always Set These

| Header | When to set | Value |
|---|---|---|
| `X-RateLimit-Limit` | Every response | The configured limit |
| `X-RateLimit-Remaining` | Every response | Requests left in window |
| `X-RateLimit-Reset` | Every response | Unix timestamp when window resets |
| `Retry-After` | 429 responses only | Seconds until client can retry |

**Why this matters:** Well-behaved clients (and libraries like `axios-retry`) check these headers to throttle themselves. Without these headers, rejected clients simply retry immediately, amplifying the overload instead of backing off. Always set them — it's the difference between graceful degradation and a retry storm.

---

## 11. Distributed Rate Limiting with Redis

### The race condition problem

In-process rate limiters fail with multiple Node.js instances. Without atomicity:

```
Instance 1: reads count=99 (under limit of 100)
Instance 2: reads count=99 (under limit of 100)
Instance 1: increments to 100 → ALLOW
Instance 2: increments to 100 → ALLOW  ← both allowed, 2× the limit
```

This is a **time-of-check-to-time-of-use (TOCTOU)** race condition.

### Redis Lua script — atomic sliding window

Lua scripts run atomically on the Redis server. No interleaving between clients.

```typescript
import Redis from 'ioredis';

const redis = new Redis();

// Lua script — runs atomically on Redis server
const SLIDING_WINDOW_SCRIPT = `
  local key        = KEYS[1]
  local now        = tonumber(ARGV[1])
  local window_ms  = tonumber(ARGV[2])
  local limit      = tonumber(ARGV[3])
  local window_start = now - window_ms

  -- Remove expired entries (older than window)
  redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

  -- Count remaining entries
  local count = redis.call('ZCARD', key)

  if count >= limit then
    return 0  -- denied
  end

  -- Add current request with timestamp as score
  redis.call('ZADD', key, now, now .. '-' .. math.random())

  -- Set TTL on the key to auto-expire idle clients
  redis.call('PEXPIRE', key, window_ms)

  return 1  -- allowed
`;

class RedisRateLimiter {
  constructor(
    private redis:    Redis,
    private limit:    number,
    private windowMs: number,
  ) {}

  async allow(clientId: string): Promise<boolean> {
    const key = `ratelimit:${clientId}`;
    const now = Date.now();

    const result = await this.redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,           // number of keys
      key,         // KEYS[1]
      now,         // ARGV[1]
      this.windowMs, // ARGV[2]
      this.limit,  // ARGV[3]
    );

    return result === 1;
  }
}
```

### Redis token bucket — atomic with HINCRBY

```typescript
const TOKEN_BUCKET_SCRIPT = `
  local key        = KEYS[1]
  local now        = tonumber(ARGV[1])
  local capacity   = tonumber(ARGV[2])
  local rate       = tonumber(ARGV[3])   -- tokens per second

  local data = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens     = tonumber(data[1]) or capacity
  local last_refill = tonumber(data[2]) or now

  -- Lazy refill
  local elapsed = (now - last_refill) / 1000
  tokens = math.min(capacity, tokens + elapsed * rate)

  if tokens < 1 then
    return 0  -- denied
  end

  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('PEXPIRE', key, math.ceil(capacity / rate * 1000 * 2))

  return 1  -- allowed
`;
```

### Architecture for multi-instance deployments

```
Request
  ↓
L1: In-process rate limiter   ← fast path, catches obvious abuse
    (per Node.js instance)       no network round-trip
  pass ↓
L2: Redis rate limiter        ← shared state across all instances
    (shared across cluster)      ~1ms latency
  pass ↓
Application handler
```

The in-process L1 can use a very high limit (e.g. 10× the Redis limit) just to protect against per-instance spikes. The Redis L2 enforces the true global limit.

---

## 12. Algorithm Comparison Table

| Dimension | Token bucket | Sliding window log | Sliding window counter | Fixed window |
|---|---|---|---|---|
| Space per client | O(1) | O(limit) | O(1) | O(1) |
| Burst allowed | Yes — up to capacity | No | No | At boundaries only |
| Boundary spike | No | No | No | Yes |
| Accuracy | Exact | Exact | ~95% | Exact within window |
| Implementation complexity | Low | Low | Medium | Very low |
| Best use case | Public APIs, search | Auth, payments | High-scale APIs | Simple internal limits |
| Redis implementation | HMSET + Lua | ZADD + ZREMRANGE | HINCRBY + Lua | INCR + EXPIRE |

---

## 13. Key Interview Talking Points

### Open with a clarifying question

> "Before I write any code — is this for an API where bursty traffic is natural (e.g. a search endpoint where a user quickly types multiple characters), or do I need strictly even throughput? And is this in a single-process context or distributed across multiple instances? The algorithm and storage mechanism change significantly."

### Token bucket lazy refill

> "I won't use setInterval to refill tokens. Instead, on every request I calculate elapsed time since the last check and compute tokens = min(capacity, current + elapsed × rate). This avoids a background timer per client — with thousands of clients, those timers would be a significant overhead and a memory leak if clients churn."

### Boundary spike

> "Fixed window counter has a boundary spike problem. A client can send limit requests at 11:59:59 and another limit requests at 12:00:00 — both windows are within limit but the client sent 2× the intended rate in 2 seconds. Token bucket prevents this because the bucket doesn't reset — you have to wait for tokens to accumulate regardless of clock boundaries."

### HTTP 429 vs 503

> "I'd return 429 not 503. 429 tells the client the issue is their rate — they should slow down and respect Retry-After. 503 tells them the server is having problems — they might retry immediately. Using 429 correctly enables client-side cooperation; the wrong status code makes the overload worse."

### Distributed upgrade

> "This in-process implementation works for a single instance. At GoDaddy's scale with multiple instances behind a load balancer, each instance has its own counter — a client can get N× the limit by rotating requests across instances. The fix: Redis with atomic Lua scripts. The Lua script runs atomically on the Redis server, so check-then-increment is never interleaved with another client's operation."

### Tiered rate limits

> "For GoDaddy's API plans, I'd parameterise by user tier. Free users: 60 req/min. Pro: 1000 req/min. Enterprise: unlimited or very high. The key function includes the user ID after auth, so even users on the same plan have independent buckets."

---

## 14. Common Interview Follow-up Questions

**Q: What is the difference between token bucket and leaky bucket?**  
Token bucket allows bursts up to the bucket capacity — if you have 10 tokens, you can fire 10 requests at once. Leaky bucket enforces a strictly smooth output rate — requests are queued and released at a fixed rate like water dripping. Token bucket is better for APIs where bursty-but-bounded traffic is natural. Leaky bucket is better for smoothing traffic to a downstream service that can't handle spikes.

**Q: Why 429 instead of 503?**  
429 (Too Many Requests) signals the client should slow down — it's a client-side problem. 503 (Service Unavailable) signals the server is overloaded and will recover regardless of client behaviour. On 429, clients should respect `Retry-After`; on 503, clients might retry immediately. Using 429 correctly enables cooperative client backoff.

**Q: How do you handle the race condition in a distributed rate limiter?**  
Without atomicity, two instances can both read count=99 under the limit, both increment to 100, and both allow the request — doubling the effective limit. This is a TOCTOU race. Redis Lua scripts run atomically: read-check-increment is a single uninterruptible operation on the Redis server, so it's impossible for two clients to interleave.

**Q: How would you implement rate limiting by user tier?**  
After auth middleware, look up the user's plan. Parameterise the limiter config by plan: free → 60 req/min, paid → 1000 req/min, enterprise → unlimited. The key function includes the user ID to ensure per-user isolation even within the same tier. Store plan limits in a config map keyed by plan name.

**Q: How do you handle warm-up / new client scenarios?**  
Token bucket: new clients start with a full bucket — they get the full burst allowance immediately. This is usually correct (they haven't been abusive yet). Sliding window log: new clients start with an empty log — first request is always allowed. For abuse prevention you might want to start with a partial token count, but full bucket is the standard default.

**Q: How would you make the rate limiter itself highly available?**  
Redis is a single point of failure in the distributed design. Mitigations: (1) Redis Cluster or Redis Sentinel for replication and failover; (2) Fall open on Redis errors — if Redis is unreachable, allow requests (trading safety for availability); (3) Fall closed on Redis errors — reject requests (trading availability for safety). For most APIs, falling open is preferable. Use a circuit breaker to detect Redis outage and fall back to in-process limiting temporarily.

**Q: What is the thundering herd problem in rate limiting?**  
When a rate limit resets (e.g. at the top of every minute), all clients whose requests were queued or rejected simultaneously retry. This creates a spike of traffic right at the reset boundary — ironically causing the overload you were trying to prevent. Solutions: (1) jitter in Retry-After (tell different clients slightly different retry times); (2) token bucket doesn't have this problem since it has no reset boundary.

---

*Generated as part of GoDaddy Senior Backend Engineer — Round 2 Interview Prep*