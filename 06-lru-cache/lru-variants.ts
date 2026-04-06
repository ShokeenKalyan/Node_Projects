
/**  VARIANT 1 - TTL AWARE LRU CACHE
 * This variant extends the basic LRU cache to support Time-To-Live (TTL) for each entry. 
 * Each cache entry has an associated expiration time, and the cache automatically evicts entries that have expired when accessed. 
 * This allows the cache to not only manage its size based on usage but also ensure that stale data is not returned.
 *


interface CacheEntry<V> {
    value: V;
    expiresAt: number; // Date.now() + ttlMs Timestamp when the entry expires
}


get(key: K): V | -1 {
    const node = this.map.get(key);
    if (!node) {
        return -1; // Cache miss
    }

    // Check TTL expiration before returning - If expired, treat as cache miss and remove entry
    if (Date.now() > node.expiresAt) {
        this.removeNode(node); // Remove from linked list
        this.map.delete(key);
        return -1; // Cache miss due to expiration
    }

    this.moveToHead(node); // Mark as recently used
    return node.value; // Cache hit
}

*/


/** 
 * VARIANT 2 - LRU AS AN HTTP RESPONSE CACHE MIDDLEWARE
 
// Wrap LRU cache as Express middleware for API response caching
const cache = new LRUCache<string, string>(500);

function cacheMiddleware(ttlMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.method}:${req.originalUrl}`;
    const cached = cache.get(key);
    if (cached !== -1) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(JSON.parse(cached));
    }
    // Intercept res.json to store the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      cache.put(key, JSON.stringify(body));
      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };
    next();
  };
}

*/

/** 
 * 
 Variant 3 — Thread-safe LRU for Node.js (single-threaded note)

// Node.js is single-threaded — no mutex needed for in-process cache.
// BUT: if using worker_threads, each thread gets its own cache.
// For shared state across workers, use SharedArrayBuffer or
// an external store (Redis). Mention this proactively.

// For distributed caching at GoDaddy scale:
// - In-process LRU: L1 cache (fast, per-instance, small)
// - Redis:          L2 cache (shared, survives restarts, larger)
// - DB:             source of truth
//
// Write-through: update cache + DB on every put()
// Write-behind:  update cache immediately, DB async (risk: data loss)
// Cache-aside:   app manages: check cache → miss → load DB → cache it

*/
