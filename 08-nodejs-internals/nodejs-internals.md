# Node.js Internals — Complete Reference Guide

> **Context:** GoDaddy Senior Backend Engineer Interview Prep  
> **Topic:** Node.js conceptual depth — event loop, streams, clustering, memory  
> **Key message:** Juniors use Node.js. Seniors can explain *why* it works the way it does. This is the section that separates the two.

---

## Table of Contents

1. [Architecture — The Three Layers](#1-architecture--the-three-layers)
2. [The Single-Thread Model — What It Actually Means](#2-the-single-thread-model--what-it-actually-means)
3. [The Event Loop — 6 Phases](#3-the-event-loop--6-phases)
4. [Microtasks — Between Every Phase](#4-microtasks--between-every-phase)
5. [Execution Order — The Complete Priority Chain](#5-execution-order--the-complete-priority-chain)
6. [Execution Order Puzzles — With Answers](#6-execution-order-puzzles--with-answers)
7. [Streams](#7-streams)
8. [Backpressure — The Critical Concept](#8-backpressure--the-critical-concept)
9. [Cluster vs Worker Threads](#9-cluster-vs-worker-threads)
10. [Memory Management and Leak Patterns](#10-memory-management-and-leak-patterns)
11. [AsyncLocalStorage — Request-Scoped Context](#11-asynclocalstorage--request-scoped-context)
12. [Key Interview Talking Points](#12-key-interview-talking-points)
13. [Common Interview Questions with Answers](#13-common-interview-questions-with-answers)

---

## 1. Architecture — The Three Layers

Node.js is built on three layers. Understanding the boundary between them is what senior-level interviews probe.

```
┌─────────────────────────────────┐
│      JavaScript application     │  Your code, npm packages
├─────────────────────────────────┤
│      Node.js standard library   │  fs, http, crypto, child_process
│      (C++ bindings)             │  bridges JS ↔ libuv
├─────────────────────────────────┤
│  V8              │  libuv        │
│  JS engine       │  Async I/O    │
│  JIT + GC + heap │  Event loop   │
│                  │  Thread pool  │
└─────────────────────────────────┘
              OS / Hardware
```

| Layer | Responsibility |
|---|---|
| **V8** | Compiles JS to machine code (JIT). Manages heap memory and garbage collection. Runs JavaScript — nothing else. |
| **libuv** | Implements the event loop. Handles async I/O. Maintains a thread pool (default 4) for operations the OS can't do asynchronously. |
| **Node.js stdlib** | Bridges JavaScript and libuv via C++ bindings. `fs`, `http`, `net`, `crypto`, `child_process` all call into libuv or the OS directly. |

---

## 2. The Single-Thread Model — What It Actually Means

Node.js has **one JavaScript thread**. But it is **not** single-threaded overall.

```
                     ┌─────────────────┐
                     │  JS thread      │  All JavaScript runs here
                     │  (V8)           │  Event loop runs here
                     └────────┬────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    Network I/O         File I/O          DNS / Crypto
    (epoll/kqueue/      (libuv thread     (libuv thread
     IOCP)              pool — 4 threads) pool)
    ZERO threads        Blocking ops      Blocking ops
```

| Operation type | How handled | Threads used |
|---|---|---|
| Network I/O (HTTP, TCP) | OS async primitives (epoll/kqueue/IOCP) | Zero — pure event notification |
| File I/O | libuv thread pool | Up to 4 (default) |
| DNS resolution | libuv thread pool | Up to 4 (default) |
| `crypto.pbkdf2`, `crypto.scrypt` | libuv thread pool | Up to 4 (default) |
| JavaScript execution | V8 on JS thread | 1 — the JS thread |

**Critical implication:** Blocking the JS thread blocks *every* connected client simultaneously. There's no other thread to handle requests while yours is stuck.

**Thread pool size:** Configure with `UV_THREADPOOL_SIZE=N` environment variable. Max 128. If all pool slots are busy, additional work queues and waits — this is why heavy concurrent file I/O or DNS lookups can appear to hang.

---

## 3. The Event Loop — 6 Phases

The event loop is a continuous cycle through phases. Each phase has a FIFO queue of callbacks. The loop drains each queue completely before moving to the next phase.

```
   ┌───────────────────────────┐
┌─►│  1. Timers                │  setTimeout, setInterval callbacks
│  │     (expired timers only) │
│  └──────────────┬────────────┘
│  ┌──────────────▼────────────┐
│  │  2. Pending callbacks     │  I/O errors deferred from last iteration
│  └──────────────┬────────────┘
│  ┌──────────────▼────────────┐
│  │  3. Idle, prepare         │  Internal use only — skip in interviews
│  └──────────────┬────────────┘
│  ┌──────────────▼────────────┐
│  │  4. Poll                  │  Retrieve new I/O events, run I/O callbacks
│  │     (the main phase)      │  Waits here if no timers pending
│  └──────────────┬────────────┘
│  ┌──────────────▼────────────┐
│  │  5. Check                 │  setImmediate callbacks
│  └──────────────┬────────────┘
│  ┌──────────────▼────────────┐
│  │  6. Close callbacks       │  socket.on('close'), cleanup
└──┘
```

**Phase 4 (Poll) is the most important:** This is where the loop spends most of its time waiting for I/O. If timers are scheduled and the poll queue is empty, the loop moves on to check timers. If no timers are pending and no `setImmediate` is queued, the loop blocks here waiting for new I/O events.

---

## 4. Microtasks — Between Every Phase

**Between every phase transition**, Node.js drains two special queues before moving to the next phase:

1. **`process.nextTick` queue** — drained completely first
2. **Promise microtask queue** — drained completely after nextTick

This happens between *every* phase, not just at the top of the loop.

```
Phase 1 (Timers) completes
  → drain nextTick queue completely
  → drain Promise microtask queue completely
Phase 2 (Pending callbacks) runs
  → drain nextTick queue completely
  → drain Promise microtask queue completely
Phase 3 ...
```

**The danger — nextTick starvation:**

```javascript
function recurse() {
  process.nextTick(recurse); // calls itself forever via nextTick
}
recurse();
// The nextTick queue NEVER empties.
// I/O callbacks, timers, setImmediate — none of them ever run.
// The event loop is completely starved.
```

Fix: use `setImmediate` for recursive async work — it yields to I/O between iterations.

---

## 5. Execution Order — The Complete Priority Chain

From **highest to lowest priority**:

| Priority | Mechanism | When it runs |
|---|---|---|
| 1 (highest) | Synchronous code | Right now, inline |
| 2 | `process.nextTick()` | Before next event loop phase, before Promises |
| 3 | `Promise.then()` / `await` | Before next event loop phase, after nextTick |
| 4 | `setImmediate()` | Check phase — after current I/O poll |
| 5 (lowest) | `setTimeout(fn, 0)` | Timers phase — minimum 1ms, may be delayed |

**The `setImmediate` vs `setTimeout(0)` nuance:**

- **Outside I/O callback:** Order is non-deterministic — depends on OS timer resolution. `setTimeout(0)` might fire before or after `setImmediate`.
- **Inside I/O callback:** `setImmediate` *always* wins — deterministic. You're already in the Poll phase; Check (setImmediate) comes before the next Timers check.

```javascript
// Outside I/O — non-deterministic
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
// Either order possible

// Inside I/O — setImmediate always wins
fs.readFile('file', () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});
// Always: immediate → timeout
```

---

## 6. Execution Order Puzzles — With Answers

### Puzzle 1 — Classic ordering

```javascript
console.log('1: sync');

setTimeout(() => console.log('2: setTimeout'), 0);

Promise.resolve().then(() => console.log('3: promise'));

process.nextTick(() => console.log('4: nextTick'));

setImmediate(() => console.log('5: setImmediate'));

console.log('6: sync');
```

**Output:**
```
1: sync          ← synchronous, runs immediately
6: sync          ← synchronous, runs immediately
4: nextTick      ← nextTick queue drained first
3: promise       ← Promise microtask queue next
5: setImmediate  ← Check phase
2: setTimeout    ← Timers phase (min 1ms delay)
```

**Reasoning:** All sync code runs first. After the call stack empties, nextTick queue is drained (step 4), then Promise microtasks (step 3). Then the event loop moves to Check phase (setImmediate), then Timers.

---

### Puzzle 2 — Nested microtasks

```javascript
process.nextTick(() => {
  console.log('A: nextTick 1');
  Promise.resolve().then(() => console.log('B: promise inside nextTick'));
});

Promise.resolve().then(() => {
  console.log('C: promise 1');
  process.nextTick(() => console.log('D: nextTick inside promise'));
});

console.log('E: sync');
```

**Output:**
```
E: sync
A: nextTick 1
D: nextTick inside promise   ← nextTick scheduled mid-queue still runs before promises
B: promise inside nextTick
C: promise 1
```

**Key insight:** A `process.nextTick` scheduled *during* microtask processing is added to the nextTick queue and runs before pending Promise callbacks — nextTick queue is always fully drained before the Promise queue.

---

### Puzzle 3 — async/await desugared

```javascript
async function foo() {
  console.log('A');
  await Promise.resolve();
  console.log('B');
}

foo();
console.log('C');
```

**Output:** `A → C → B`

**Why:** `async/await` desugars to generators + Promises. Everything before `await` runs synchronously. `await Promise.resolve()` schedules the continuation as a Promise microtask. So `C` runs (synchronous), then the microtask fires (`B`).

---

### Puzzle 4 — Multiple awaits

```javascript
async function bar() {
  console.log('1');
  await null;           // schedules microtask
  console.log('2');
  await null;           // schedules another microtask
  console.log('3');
}

bar();
console.log('4');
```

**Output:** `1 → 4 → 2 → 3`

Each `await` creates a new microtask checkpoint. After `1`, the function suspends and `4` runs synchronously. Then microtask 1 fires → `2`. Then microtask 2 fires → `3`.

---

## 7. Streams

### The four stream types

| Type | Direction | Examples |
|---|---|---|
| **Readable** | Source of data | `fs.createReadStream`, HTTP request body, `process.stdin` |
| **Writable** | Destination for data | `fs.createWriteStream`, HTTP response, `process.stdout` |
| **Duplex** | Both read and write | TCP socket — independent read and write channels |
| **Transform** | Reads, transforms, writes | `zlib.createGzip`, `crypto.createCipher`, custom parsers |

### Stream modes

| Mode | How data flows | How to enter |
|---|---|---|
| **Paused** (default) | Only when you call `read()` explicitly | Default; `stream.pause()` |
| **Flowing** | Automatically via `data` events | Adding a `data` listener; `stream.resume()` |

`for await...of` on a stream uses paused mode internally — clean and idiomatic.

---

## 8. Backpressure — The Critical Concept

Backpressure occurs when a writable stream can't consume data as fast as a readable produces it. Without handling it, data accumulates in memory unboundedly.

### The problem

```javascript
// BAD — ignores backpressure
const readable = fs.createReadStream('huge-file.bin');
const writable = fs.createWriteStream('output.bin');

readable.on('data', (chunk) => {
  writable.write(chunk);
  // write() returns false when the internal buffer is full
  // But we keep calling it — buffer grows unboundedly in memory
  // For a 10GB file: 10GB lives in heap before any bytes are written
});
```

### The fix — pipe handles backpressure

```javascript
// GOOD — pipe handles backpressure automatically
readable.pipe(writable);
// pipe pauses the readable when write() returns false
// resumes when 'drain' fires
```

### The best fix — pipeline

```javascript
// BEST — pipeline from stream/promises
// 1. Returns a Promise you can await
// 2. Destroys ALL streams on error (pipe does NOT do this)
// 3. Properly handles cleanup

const { pipeline } = require('stream/promises');

await pipeline(
  fs.createReadStream('input.txt'),
  zlib.createGzip(),              // Transform stream
  fs.createWriteStream('output.gz')
);
// If gzip errors: both read and write streams are destroyed
// pipe would leave the read stream open, causing a memory/handle leak
```

### Manual backpressure handling

```javascript
// When you need custom control
readable.on('data', (chunk) => {
  const canContinue = writable.write(chunk);

  if (!canContinue) {
    readable.pause();                    // stop producing data
    writable.once('drain', () => {
      readable.resume();                 // buffer drained — resume
    });
  }
});
```

### Why `pipeline` > `pipe`

| Feature | `pipe` | `pipeline` |
|---|---|---|
| Backpressure | Handled | Handled |
| Error propagation | Not handled — source keeps streaming | Destroys all streams |
| Promise interface | No | Yes — `await pipeline(...)` |
| Cleanup on finish | Partial | Complete |

**Always say in interviews:** "I use `pipeline` from `stream/promises` over `pipe`. `pipe` doesn't propagate errors — if the destination errors, the source keeps streaming and the data goes nowhere, but memory and file handles keep accumulating."

---

## 9. Cluster vs Worker Threads

Two mechanisms for multi-core utilisation. They solve different problems.

| Dimension | Cluster | Worker Threads |
|---|---|---|
| What is spawned | Multiple OS processes | Multiple threads in same process |
| Memory | Separate heaps — no sharing | Can share via `SharedArrayBuffer` |
| Communication | `process.send()` (IPC) | `postMessage()` / `Atomics` |
| Event loop | Each worker has its own | Each thread has its own |
| Best for | Scaling I/O-bound HTTP across cores | CPU-bound tasks that block main thread |
| Process crash | Worker crashes — master respawns | Worker crash can be isolated |

### When to use which

```
Problem: Express server is CPU-bound on one core under load
  → Use cluster: spawn N workers (one per CPU), each handles requests independently

Problem: Endpoint does heavy image processing and blocks for 500ms
  → Use worker_threads: offload the processing to a thread, main event loop stays responsive

Problem: Multiple concurrent file reads saturating thread pool
  → Increase UV_THREADPOOL_SIZE, or use cluster to distribute load across processes
```

### Cluster — implementation

```javascript
const cluster = require('cluster');
const os      = require('os');

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;

  // Spawn one worker per CPU core
  for (let i = 0; i < numCPUs; i++) cluster.fork();

  // Auto-restart crashed workers
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${code}) — restarting`);
    cluster.fork();
  });

} else {
  // Each worker runs the full application
  const app = require('./app');
  app.listen(3000, () => {
    console.log(`Worker ${process.pid} listening on 3000`);
  });
}
```

**Important:** Workers share the server port. The OS or Node.js (round-robin) distributes incoming connections. Each worker processes its connections independently — no shared state.

### Worker Threads — implementation

```typescript
// main.ts — spin up a worker for CPU work
import { Worker, isMainThread, workerData, parentPort } from 'worker_threads';

// Helper: run a file in a worker and get the result as a Promise
function runWorker<T>(workerFile: string, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: data });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
    });
  });
}

// Usage — doesn't block main event loop
const result = await runWorker<ProcessedImage>('./imageWorker.js', {
  buffer: imageBuffer,
  width: 800,
});
```

```typescript
// imageWorker.ts — runs in a separate thread
import { workerData, parentPort } from 'worker_threads';

// This runs on its own thread — blocking here doesn't affect main thread
const processed = processImage(workerData.buffer, workerData.width);
parentPort!.postMessage(processed);
```

### The golden rule

```
I/O bound workload (waiting on network, DB, file)
  → async + event loop already handles this — no extra threads needed

CPU bound workload (image processing, crypto, heavy computation, parsing)
  → worker_threads — offload to a separate thread

Scale HTTP throughput across CPU cores
  → cluster — multiple processes, each with own event loop
```

---

## 10. Memory Management and Leak Patterns

### V8 heap structure

| Zone | Contents | GC type |
|---|---|---|
| **New space** | Short-lived objects | Minor GC (fast, frequent) — most objects die here |
| **Old space** | Objects that survived minor GC | Major GC (slow, stop-the-world) |
| **Code space** | JIT-compiled machine code | Separate from data heap |
| **Large object space** | Objects > 512KB | Allocated directly in old space |

**process.memoryUsage() fields:**
- `heapUsed` — bytes currently in use by live JS objects
- `heapTotal` — total heap allocated (used + available)
- `rss` — total process memory including non-heap (buffers, code)
- `external` — memory for C++ objects bound to JS (Buffers)

### The four memory leak patterns

**Pattern 1 — Unbounded cache / global accumulation**
```javascript
// LEAK: grows forever
const cache = {};
app.get('/search', (req) => {
  cache[req.query.q] = expensiveResult(req.query.q);
});

// FIX: use LRU cache with bounded capacity
const cache = new LRUCache({ max: 1000 });
```

**Pattern 2 — Event listener accumulation**
```javascript
// LEAK: adds a new listener on every request, old ones never removed
function handleRequest(req) {
  emitter.on('data', (data) => process(data, req));
}

// FIX 1: use once() if you only need the first event
emitter.once('data', handler);

// FIX 2: removeListener in cleanup
function handleRequest(req) {
  const handler = (data) => process(data, req);
  emitter.on('data', handler);
  req.on('end', () => emitter.removeListener('data', handler));
}
```

**Pattern 3 — Closure over large objects**
```javascript
// LEAK: the returned function closes over bigBuffer
// bigBuffer stays alive as long as the function is referenced
function processLargeFile() {
  const bigBuffer = fs.readFileSync('huge.bin'); // 500MB
  return () => bigBuffer.length; // function holds bigBuffer forever
}

// FIX: extract only what you need from the large object
function processLargeFile() {
  const bigBuffer = fs.readFileSync('huge.bin');
  const length = bigBuffer.length; // extract the value
  return () => length;             // closure over a number, not the buffer
}
```

**Pattern 4 — Timers not cleared**
```javascript
// LEAK: setInterval holds a reference to heavyObject forever
class Service {
  constructor() {
    this.data = new LargeDataStructure();
    this.timer = setInterval(() => this.data.process(), 1000);
  }
  // No destroy() method — timer and data live forever
}

// FIX: always provide cleanup
class Service {
  constructor() {
    this.data = new LargeDataStructure();
    this.timer = setInterval(() => this.data.process(), 1000);
  }
  destroy() {
    clearInterval(this.timer);
    this.data = null;
  }
}
```

### Detecting memory leaks

```javascript
// 1. Baseline monitoring — watch for steady heap growth
setInterval(() => {
  const { heapUsed, heapTotal, rss } = process.memoryUsage();
  console.log({
    heapUsedMB:  Math.round(heapUsed  / 1024 / 1024),
    heapTotalMB: Math.round(heapTotal / 1024 / 1024),
    rssMB:       Math.round(rss       / 1024 / 1024),
  });
}, 10_000);

// 2. Heap snapshot via Chrome DevTools
// node --inspect app.js
// Open chrome://inspect → Memory tab → Take heap snapshot
// Do work → Take another snapshot → Compare

// 3. Check listener count — Node.js warns at >10
emitter.setMaxListeners(20); // suppress if intentional
// or monitor: emitter.listenerCount('event')
```

### WeakMap and WeakRef — leak-safe patterns

```typescript
// WeakMap: keys are held weakly — GC can collect them
// When the key object is GC'd, the entry is automatically removed
const computedCache = new WeakMap<object, ComputedResult>();

function getResult(obj: object): ComputedResult {
  if (computedCache.has(obj)) return computedCache.get(obj)!;
  const result = expensiveCompute(obj);
  computedCache.set(obj, result);
  return result;
}
// No need to manually evict. No memory leak possible.
// Trade-off: can't iterate WeakMap entries, can't check size.

// WeakRef: hold a reference that doesn't prevent GC
class Cache {
  private map = new Map<string, WeakRef<LargeObject>>();

  get(key: string): LargeObject | undefined {
    const ref = this.map.get(key);
    return ref?.deref(); // returns undefined if object was GC'd
  }

  set(key: string, val: LargeObject) {
    this.map.set(key, new WeakRef(val));
  }
}
```

---

## 11. AsyncLocalStorage — Request-Scoped Context

A common senior question: "How do you pass a trace ID or user context through async operations without threading it through every function call?"

```typescript
import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  requestId: string;
  userId?:   string;
  startTime: number;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

// Middleware — set context at the start of each request
app.use((req, res, next) => {
  const context: RequestContext = {
    requestId: req.headers['x-request-id'] as string ?? crypto.randomUUID(),
    startTime: Date.now(),
  };
  // Everything that runs within this callback inherits the context
  asyncLocalStorage.run(context, next);
});

// Anywhere in the call stack — even deep in services with no req reference
function logEvent(message: string) {
  const context = asyncLocalStorage.getStore();
  console.log({
    requestId: context?.requestId,  // automatically correct per request
    message,
  });
}

// Works across await boundaries
async function fetchDomainData(domainId: string) {
  logEvent(`Fetching domain ${domainId}`); // correct requestId — no prop drilling
  const data = await db.query(domainId);
  logEvent('Domain fetch complete');       // still correct requestId
  return data;
}
```

**Why it works:** `AsyncLocalStorage` hooks into async context tracking (async_hooks under the hood). The stored value propagates through Promises, async/await, callbacks, and even `setTimeout` — as long as they were initiated within the `run()` call.

---

## 12. Key Interview Talking Points

### Architecture in 30 seconds

> "Node.js has one JavaScript thread running on V8. But it's not single-threaded overall — libuv uses OS async primitives for network I/O (no threads at all), and a thread pool of 4 for blocking operations like file I/O and DNS. The JS thread processes callbacks as async operations complete. Blocking that one JS thread blocks every connected client."

### Event loop in one paragraph

> "The event loop cycles through 6 phases: Timers, Pending callbacks, Idle/Prepare, Poll, Check, and Close. Between every phase it drains the nextTick queue first, then Promise microtasks. The Poll phase is where the loop spends most of its time waiting for new I/O events. `setImmediate` runs in the Check phase — always after the current I/O poll, before the next timer check."

### The critical ordering rule

> "Execution priority: sync code first, then nextTick, then Promise microtasks, then setImmediate, then setTimeout. Inside an I/O callback, setImmediate always beats setTimeout — deterministic, because you're already past the Poll phase and Check comes next. Outside I/O, their order is non-deterministic."

### Backpressure

> "I always use `pipeline` from `stream/promises` over `pipe`. `pipe` doesn't propagate errors — if the destination errors, the source keeps streaming and data accumulates in memory. `pipeline` destroys all streams on error and returns a Promise. For backpressure: when `write()` returns false, pause the readable and resume on the drain event — or just use `pipeline` which handles all of this."

### Cluster vs Worker Threads

> "Cluster for I/O-bound HTTP traffic — spawn one process per CPU core, each with its own event loop, the OS distributes connections. Worker Threads for CPU-bound work that would block the main thread — same process, different threads, communicate via postMessage. The mistake is using cluster to fix a CPU bottleneck — every worker just has the same bottleneck. Use worker_threads for that."

### Memory leaks

> "The four patterns I watch for: unbounded caches (fix with LRU), event listener accumulation (fix with removeListener or once), closures over large objects (extract only what you need), and uncleaned timers (always clearInterval in cleanup). For object-keyed caches, WeakMap is idiomatic — the entry is automatically GC'd when the key object dies."

---

## 13. Common Interview Questions with Answers

**Q: What does "non-blocking I/O" actually mean?**  
When Node.js makes a network request or reads a file, it delegates the operation to the OS (network) or libuv's thread pool (file I/O). The JavaScript thread doesn't wait — it registers a callback and moves on to process other events. When the OS signals completion, the callback is queued. "Non-blocking" means the JS thread never idles waiting for I/O — it's always processing something else.

**Q: Why is `process.nextTick` faster than `Promise.resolve().then()`?**  
Both are microtasks, but nextTick callbacks are queued in the nextTick queue which is drained *before* the Promise microtask queue. This is a Node.js-specific design decision — nextTick predates Promises and was designed to always run before any I/O. In practice, both run before any macrotask (setTimeout, setImmediate, I/O callbacks), so the difference rarely matters in application code. Prefer Promises for new code — nextTick starvation is a real foot-gun.

**Q: What happens if you call `process.nextTick` recursively?**  
The event loop starves. The nextTick queue never empties, so no I/O callbacks, timers, or setImmediate callbacks ever run. If you need recursive async scheduling, use `setImmediate` instead — it yields to I/O between iterations.

**Q: What happens to the event loop when there's no more work?**  
The process exits. The loop continues only while there are pending I/O operations, timers, or event listeners. A server stays alive because the listening socket is a pending I/O operation. You can intentionally keep a process alive with `process.stdin.resume()` (keeps stdin open as pending I/O).

**Q: What is the libuv thread pool and when does it matter?**  
libuv maintains 4 threads (configurable via `UV_THREADPOOL_SIZE`) for blocking operations: file I/O, DNS resolution, `crypto.pbkdf2`, `crypto.scrypt`. If all 4 threads are busy, the 5th operation queues and waits — this is why DNS lookups can appear to hang under load. Network I/O does NOT use the thread pool — it uses OS-level async, which is why Node.js can handle thousands of concurrent connections with minimal overhead.

**Q: How do you avoid blocking the event loop?**  
(1) Never use sync I/O functions on large data (`fs.readFileSync` on big files). (2) Break long CPU loops into chunks using `setImmediate` to yield between chunks. (3) Offload CPU-bound work to `worker_threads`. (4) Monitor event loop lag — if `setInterval(fn, 1000)` fires at 1300ms, you have 300ms of blocking. Use `clinic.js` or `0x` to profile blocking in production.

**Q: What is `async_hooks` / `AsyncLocalStorage` used for?**  
Propagating request-scoped context (trace ID, user ID, auth context) through async call chains without threading it through every function signature. `AsyncLocalStorage.run(context, fn)` makes the context available anywhere within `fn`'s async call tree via `getStore()` — including across `await` boundaries, `setTimeout`, and callbacks. Used for distributed tracing, per-request logging, and auth context in middleware.

**Q: How do Promises relate to the event loop?**  
A resolved Promise's `.then()` callback is scheduled as a microtask — it runs after the current synchronous code completes, before the event loop advances to the next phase. `async/await` desugars to generator functions + Promises. Each `await` creates a microtask checkpoint — code after `await` is a Promise continuation. This is why `await Promise.resolve()` yields to other pending microtasks before resuming.

**Q: What is the difference between `Buffer` and `TypedArray` in Node.js?**  
`Buffer` is Node.js-specific and predates `TypedArray` — it's a subclass of `Uint8Array` with extra methods for encoding/decoding (hex, base64, utf8). `Buffer` memory is allocated outside V8's heap (in C++ land) via `Buffer.allocUnsafe()` or `Buffer.alloc()`. Modern code should use `TypedArray` where possible; `Buffer` is still idiomatic for binary I/O, streams, and network data in Node.js.

---

*Generated as part of GoDaddy Senior Backend Engineer — Round 2 Interview Prep*