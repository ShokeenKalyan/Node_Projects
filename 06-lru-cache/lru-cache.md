# LRU Cache — Complete Reference Guide

> **Context:** GoDaddy Senior Backend Engineer Interview Prep  
> **Topic:** Implementing an O(1) LRU Cache in TypeScript  
> **Key message:** This question tests whether you know that O(1) get AND O(1) eviction requires two data structures together — neither a HashMap nor a LinkedList alone is sufficient.

---

## Table of Contents

1. [The Core Problem](#1-the-core-problem)
2. [Why HashMap + Doubly Linked List](#2-why-hashmap--doubly-linked-list)
3. [The Two Sentinel Nodes Trick](#3-the-two-sentinel-nodes-trick)
4. [Data Structure — Visual Model](#4-data-structure--visual-model)
5. [Complete Implementation](#5-complete-implementation)
   - [DLLNode class](#51-dllnode-class)
   - [LRUCache class — full implementation](#52-lrucache-class--full-implementation)
   - [Private helper methods explained](#53-private-helper-methods-explained)
6. [JavaScript Map Shortcut](#6-javascript-map-shortcut)
7. [Complexity Analysis](#7-complexity-analysis)
8. [Operation Walkthroughs](#8-operation-walkthroughs)
9. [Variants](#9-variants)
   - [TTL-aware LRU Cache](#91-ttl-aware-lru-cache)
   - [LRU as HTTP middleware](#92-lru-as-http-middleware)
   - [Distributed caching strategy](#93-distributed-caching-strategy)
10. [Key Interview Talking Points](#10-key-interview-talking-points)
11. [Common Mistakes to Avoid](#11-common-mistakes-to-avoid)
12. [LRU vs LFU](#12-lru-vs-lfu)
13. [Common Interview Follow-up Questions](#13-common-interview-follow-up-questions)

---

## 1. The Core Problem

An LRU (Least Recently Used) Cache must support two operations, **both in O(1) time**:

- `get(key)` — return the value if key exists, else -1. Mark the key as recently used.
- `put(key, value)` — insert or update the key. If at capacity, evict the least recently used entry first.

The eviction policy: when the cache is full and a new key arrives, the entry that **has not been accessed for the longest time** is removed.

---

## 2. Why HashMap + Doubly Linked List

The trick is recognising that no single data structure achieves both requirements:

| Structure | get | eviction | verdict |
|---|---|---|---|
| HashMap only | O(1) | O(n) — must scan for LRU | ✗ too slow |
| Singly linked list only | O(n) — must traverse | O(1) — remove head/tail | ✗ too slow |
| Array/heap | O(1) or O(log n) | O(n) — shift or re-heap | ✗ too slow |
| **HashMap + Doubly Linked List** | **O(1)** | **O(1)** | **✓ correct** |

**The insight in one sentence:** The HashMap gives O(1) access to any node by key. The doubly linked list gives O(1) reorder (move-to-front on access) and O(1) eviction (remove from tail). You need both.

**Why doubly linked, not singly?** To remove a node from the middle of the list in O(1), you need a pointer to the node's *previous* node — otherwise you'd have to traverse from the head to find it. The `prev` pointer is what makes mid-list removal O(1).

---

## 3. The Two Sentinel Nodes Trick

Use two dummy nodes — `head` and `tail` — that are never evicted and never stored in the HashMap. They serve as permanent bookends.

**Benefits:**
- Every real node always has a non-null `prev` and `next`
- No null checks needed in `insertAtHead`, `removeNode`, or `removeTail`
- Eliminates all edge cases: empty list, single node, insert into empty list
- This is the production-grade pattern — an implementation without sentinels will have scattered null checks and is error-prone

```
head ↔ [MRU node] ↔ ... ↔ [LRU node] ↔ tail
       (most recent)       (evict this)
```

The most recently used node lives **immediately after `head`**.  
The least recently used node lives **immediately before `tail`**.

---

## 4. Data Structure — Visual Model

### After `put(A,1)`, `put(B,2)`, `put(C,3)`, `put(D,4)` with capacity=4:

```
HEAD ↔ D:4 ↔ C:3 ↔ B:2 ↔ A:1 ↔ TAIL
       MRU                  LRU
```

### After `get(A)` — A moves to front:

```
HEAD ↔ A:1 ↔ D:4 ↔ C:3 ↔ B:2 ↔ TAIL
       MRU                  LRU
```

### After `put(E,5)` — cache full, B evicted (LRU):

```
HEAD ↔ E:5 ↔ A:1 ↔ D:4 ↔ C:3 ↔ TAIL
       MRU                  LRU
(B was evicted — it was the least recently used)
```

### HashMap at this point:

```
{ A → nodeA, D → nodeD, C → nodeC, E → nodeE }
B has been deleted from the Map
```

---

## 5. Complete Implementation

### 5.1 DLLNode class

```typescript
// Doubly linked list node — stores key AND value
class DLLNode<K, V> {
  key:  K;
  val:  V;
  prev: DLLNode<K, V> | null = null;
  next: DLLNode<K, V> | null = null;

  constructor(key: K, val: V) {
    this.key = key;
    this.val = val;
  }
}
```

**Critical design note:** The node stores the **key** in addition to the value. This is essential — when we evict the tail node, we must also delete it from the HashMap. Without the key stored in the node, we'd have no way to do that deletion, and the HashMap would grow unboundedly (memory leak).

---

### 5.2 LRUCache class — full implementation

```typescript
class LRUCache<K = string, V = unknown> {
  private capacity: number;
  private map  = new Map<K, DLLNode<K, V>>();

  // Sentinel nodes — never evicted, never in the Map
  private head = new DLLNode<any, any>(null, null);
  private tail = new DLLNode<any, any>(null, null);

  constructor(capacity: number) {
    if (capacity < 1) throw new Error('Capacity must be >= 1');
    this.capacity = capacity;

    // Wire sentinels — list is always "non-empty" from the DLL's perspective
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  // O(1) — HashMap lookup + O(1) DLL move-to-front
  get(key: K): V | -1 {
    const node = this.map.get(key);
    if (!node) return -1;        // cache miss
    this.moveToHead(node);       // mark as most recently used
    return node.val;
  }

  // O(1) — HashMap set + O(1) DLL insert + optional O(1) eviction
  put(key: K, val: V): void {
    const existing = this.map.get(key);

    if (existing) {
      existing.val = val;        // update value in-place
      this.moveToHead(existing); // mark as recently used
      return;
    }

    // New key — create node and insert at head (MRU position)
    const node = new DLLNode(key, val);
    this.map.set(key, node);
    this.insertAtHead(node);

    // Evict LRU if over capacity
    if (this.map.size > this.capacity) {
      const lru = this.removeTail();   // O(1) — remove node before TAIL sentinel
      this.map.delete(lru.key);        // O(1) — this is why the node stores its key
    }
  }

  // Convenience accessors
  get size(): number    { return this.map.size; }
  has(key: K): boolean  { return this.map.has(key); }

  // Expose ordered keys for debugging/testing (MRU → LRU order)
  keys(): K[] {
    const result: K[] = [];
    let curr = this.head.next;
    while (curr !== this.tail) {
      result.push(curr!.key);
      curr = curr!.next;
    }
    return result;
  }

  // ── Private helpers ──────────────────────────────────────────

  private insertAtHead(node: DLLNode<K, V>): void {
    node.prev = this.head;
    node.next = this.head.next;
    this.head.next!.prev = node;
    this.head.next = node;
  }

  private removeNode(node: DLLNode<K, V>): void {
    // Splice the node out — works on ANY node because sentinels
    // guarantee prev and next are always non-null
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private moveToHead(node: DLLNode<K, V>): void {
    this.removeNode(node);
    this.insertAtHead(node);
  }

  private removeTail(): DLLNode<K, V> {
    const lru = this.tail.prev!;  // node immediately before TAIL sentinel
    this.removeNode(lru);
    return lru;                   // caller must delete from Map
  }
}
```

---

### 5.3 Private helper methods explained

**`insertAtHead(node)`** — inserts a node immediately after the `head` sentinel:
```
Before: head ↔ X ↔ ...
After:  head ↔ node ↔ X ↔ ...
```
Four pointer updates: `node.prev`, `node.next`, `head.next.prev`, `head.next`.

**`removeNode(node)`** — splices a node out of the list:
```
Before: ... ↔ A ↔ node ↔ B ↔ ...
After:  ... ↔ A ↔ B ↔ ...
```
Two pointer updates: `node.prev.next = node.next`, `node.next.prev = node.prev`.  
Works on any node because sentinels guarantee `prev` and `next` are never null.

**`moveToHead(node)`** — two steps: `removeNode` then `insertAtHead`. Called on every `get` hit and every `put` update. This is what maintains the access-order invariant.

**`removeTail()`** — returns the node at `this.tail.prev` (the LRU item). Called only when `map.size > capacity`. The caller is responsible for deleting the returned node's key from the Map.

---

## 6. JavaScript Map Shortcut

JavaScript's `Map` preserves insertion order. You can exploit this for a much simpler LRU implementation:

```typescript
class LRUCacheSimple<K, V> {
  private map = new Map<K, V>();

  constructor(private capacity: number) {}

  get(key: K): V | -1 {
    if (!this.map.has(key)) return -1;
    const val = this.map.get(key)!;
    // delete + re-insert = move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  put(key: K, val: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, val);

    if (this.map.size > this.capacity) {
      // map.keys().next().value = oldest insertion = LRU key
      const lruKey = this.map.keys().next().value;
      this.map.delete(lruKey);
    }
  }
}
```

**When to use this:** In a JS/TS-only context where you want a quick, correct implementation.  
**What to say:** "This works and is still O(1) because Map operations are O(1) in V8. But this is JavaScript-specific behaviour — in a language-agnostic interview or if asked to implement the underlying structure, I'd use the HashMap + DLL approach."

---

## 7. Complexity Analysis

| Operation | Time | Why |
|---|---|---|
| `get(key)` | O(1) | HashMap lookup + DLL pointer rewire (4 pointer updates) |
| `put(key, val)` — update | O(1) | HashMap lookup + DLL move-to-head |
| `put(key, val)` — insert, no eviction | O(1) | HashMap set + DLL insert-at-head |
| `put(key, val)` — insert with eviction | O(1) | + DLL remove-tail + HashMap delete |
| Space | O(n) | n = capacity. Both Map and DLL hold n entries |

Every pointer operation is a fixed number of assignments — no loops, no recursion. True O(1).

---

## 8. Operation Walkthroughs

### Scenario: capacity=3, operations: put(A,1), put(B,2), put(C,3), get(A), put(D,4)

```
put(A, 1):
  List: HEAD ↔ A:1 ↔ TAIL
  Map:  { A→nodeA }

put(B, 2):
  List: HEAD ↔ B:2 ↔ A:1 ↔ TAIL
  Map:  { A→nodeA, B→nodeB }

put(C, 3):
  List: HEAD ↔ C:3 ↔ B:2 ↔ A:1 ↔ TAIL     (full, capacity=3)
  Map:  { A→nodeA, B→nodeB, C→nodeC }

get(A):
  nodeA found in Map → moveToHead
  List: HEAD ↔ A:1 ↔ C:3 ↔ B:2 ↔ TAIL
  Map:  (unchanged)
  return 1  (HIT)

put(D, 4):
  New key → insert at head → size=4 > capacity=3
  LRU = node before TAIL = B:2 → removeTail() + map.delete(B)
  List: HEAD ↔ D:4 ↔ A:1 ↔ C:3 ↔ TAIL
  Map:  { A→nodeA, C→nodeC, D→nodeD }

get(B):
  Not in Map → return -1  (MISS — B was evicted)
```

---

## 9. Variants

### 9.1 TTL-aware LRU Cache

```typescript
interface CacheEntry<V> {
  val:       V;
  expiresAt: number;   // Date.now() + ttlMs at insertion time
}

// In the LRUCache, store CacheEntry<V> as the value type
get(key: K): V | -1 {
  const node = this.map.get(key);
  if (!node) return -1;

  // Expired entries are treated as misses — evict on access
  if (Date.now() > node.val.expiresAt) {
    this.removeNode(node);
    this.map.delete(key);
    return -1;
  }

  this.moveToHead(node);
  return node.val.val;
}

put(key: K, val: V, ttlMs = 60_000): void {
  // Wrap value with expiry timestamp
  const entry: CacheEntry<V> = { val, expiresAt: Date.now() + ttlMs };
  // ... rest of put logic unchanged, using entry as the value
}
```

**Note:** This is "lazy eviction" — expired entries are only removed when accessed. For proactive cleanup, add a `setInterval` that scans the list from the tail (LRU items are most likely expired).

---

### 9.2 LRU as HTTP Response Cache Middleware

```typescript
// Wrap LRU cache as Express middleware
const responseCache = new LRUCache<string, string>(500);

function cacheMiddleware(ttlMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') return next();

    const key = req.originalUrl;
    const cached = responseCache.get(key);

    if (cached !== -1) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(JSON.parse(cached));
    }

    // Intercept res.json to capture and cache the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      responseCache.put(key, JSON.stringify(body));
      res.setHeader('X-Cache', 'MISS');
      return originalJson(body);
    };

    next();
  };
}

// Usage
app.use('/api/domains', cacheMiddleware(30_000), domainRouter);
```

---

### 9.3 Distributed Caching Strategy

For multi-instance deployments (the real-world GoDaddy context):

```
Request
  ↓
L1: In-process LRU Cache     ← ~0ms, ~500 entries, per-instance
  miss ↓
L2: Redis                    ← ~1ms, millions of entries, shared across all instances
  miss ↓
L3: Database                 ← ~10-50ms, source of truth

On write (put):
  Option A — Write-through:  update DB + L2 + invalidate L1 atomically
  Option B — Write-behind:   update L1/L2 immediately, DB async (risk: data loss on crash)
  Option C — Cache-aside:    app manages: check cache → miss → load DB → populate cache
```

**Cache invalidation strategies:**

```typescript
// Strategy 1: TTL — accept stale window (simplest, good for domain data)
cache.put(key, val, ttlMs = 60_000);

// Strategy 2: Event-driven invalidation via Redis pub/sub
redisSubscriber.subscribe('cache:invalidate', (key) => {
  localLRU.delete(key);  // all instances get the message
});

// Strategy 3: Write-through — update cache on every DB write
async function updateDomain(id: string, data: DomainData) {
  await db.update(id, data);         // update DB
  await redis.set(id, data, ttl);    // update L2
  localLRU.put(id, data);            // update L1
}
```

**Say this in the interview:** "An in-process LRU is fine for a single Node.js instance. At GoDaddy's scale with many instances behind a load balancer, each instance would have a different cache view — cache misses on instance 2 for something cached on instance 1. The fix is to use Redis as a shared L2 cache, and keep the in-process LRU only for the hottest items where even 1ms Redis latency matters."

---

## 10. Key Interview Talking Points

### Open with the data structure choice

> "Before I write any code — the requirement is O(1) get and O(1) put with eviction. A HashMap alone can't do O(1) eviction — you'd have to scan for the LRU item. A linked list alone can't do O(1) lookup. Combined, the HashMap gives O(1) access to any node by key, and the doubly linked list gives O(1) reorder on access and O(1) evict from tail. I need both."

### Explain why the node stores its key

> "I'm storing the key in each DLL node, not just the value. When I evict the tail node, I need to delete it from the HashMap too — otherwise the Map grows unboundedly. To do that deletion, I need to know the key. That's why the node carries it."

### Mention sentinel nodes proactively

> "I'll use dummy head and tail sentinel nodes that are never evicted. This means every real node always has a non-null prev and next — no edge cases for empty list or single-node operations. Cleaner code, fewer bugs."

### JavaScript Map shortcut

> "There's a JS-specific shortcut: JavaScript's Map preserves insertion order, so I can implement LRU in 15 lines by deleting and re-inserting on access. Still O(1). But if you want me to implement the underlying structure explicitly, I'll use the HashMap + DLL approach."

### Real-world relevance

> "For GoDaddy's domain lookup or pricing APIs — multiple Node.js instances behind a load balancer. In-process LRU as L1 for the hottest ~500 items with zero latency. Redis as L2 shared cache across all instances. Without the shared layer, you get cache inconsistency — one instance caches a price, another doesn't."

---

## 11. Common Mistakes to Avoid

| Mistake | Why it's wrong | Fix |
|---|---|---|
| Not storing key in the node | Map grows unboundedly on eviction — memory leak | Always store key in DLLNode |
| Using Array.shift() or sort for eviction | O(n) — defeats the purpose | Use DLL tail removal |
| Forgetting to update Map on eviction | Stale Map entries — `get` returns evicted values | Always `map.delete(lru.key)` after `removeTail()` |
| No sentinel nodes | Null pointer errors on empty list or single node | Always use sentinel head+tail |
| Not moving node to head on `get` | Cache order not maintained — wrong items evicted | Always `moveToHead` on cache hit |
| Not moving to head on `put` update | Existing key update doesn't refresh recency | Call `moveToHead` even on value updates |
| Capacity check before inserting | Off-by-one in eviction logic | Insert first, then check `map.size > capacity` |

---

## 12. LRU vs LFU

| Aspect | LRU | LFU |
|---|---|---|
| Evicts | Least *recently* used | Least *frequently* used |
| Good for | Temporal locality — recent items likely reused | Permanently popular items |
| Implementation | O(1) with HashMap + DLL | O(1) possible but complex — needs frequency HashMap + per-frequency DLL |
| When it fails | Scanning patterns (every item touched once in order, all evicted) | New/rare items evicted before they get a chance to accumulate frequency |
| Typical use | Browser cache, CDN, DB query cache | DNS cache, recommendation cache |

For most interview contexts, LRU is what's expected. If asked about LFU, describe the two-layer structure: a `freqMap` that maps frequency → doubly linked list of nodes at that frequency, and a `keyMap` for O(1) lookup. Min-frequency is tracked as a variable.

---

## 13. Common Interview Follow-up Questions

**Q: Why not just use a Map with timestamps and sort on eviction?**  
Sorting is O(n log n). Even just finding the minimum timestamp is O(n). With a DLL, the LRU item is always the node before the TAIL sentinel — removing it is O(1). The DLL is the entire reason eviction is O(1).

**Q: Why doubly linked, not singly linked?**  
To remove a node from the middle of the list in O(1), you need a pointer to its previous node. With a singly linked list, you'd have to traverse from the head to find the predecessor — O(n). The `prev` pointer is what makes O(1) mid-list removal possible.

**Q: How would you make this thread-safe?**  
Node.js is single-threaded — no synchronisation needed for in-process use. With `worker_threads` and shared state, you'd need a Mutex. For multi-instance production, don't share in-process state — use Redis which handles concurrency with atomic operations.

**Q: How would you add TTL (expiry)?**  
Store `{ val, expiresAt }` as the value. On `get`, check `Date.now() > expiresAt` — if expired, remove and return -1. For proactive cleanup, scan from the tail on an interval (LRU items are most likely expired anyway).

**Q: How would you handle cache stampede (thundering herd)?**  
When a popular key expires, many concurrent requests all miss and simultaneously query the DB. Solutions: (1) Set a short lock in Redis while one request refills the cache; (2) Return stale data while refreshing in the background; (3) Use probabilistic early expiry — refresh slightly before TTL expires to avoid the cliff.

**Q: What's the hit rate and how do you tune capacity?**  
Instrument with metrics: `hits / (hits + misses)`. A hit rate below ~80% suggests the cache is too small or TTL too short. Use a sliding window of recent access patterns to auto-tune. For GoDaddy's domain lookup: most traffic is concentrated on a small set of popular TLDs/domains — LRU is very effective here.

---
