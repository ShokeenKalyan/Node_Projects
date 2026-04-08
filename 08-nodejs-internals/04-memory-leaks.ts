

/** 

// 1. Unbounded cache / global accumulation
const cache: Record<string, any> = {};
app.get('/search', (req, res) => {
  cache[req.query.q] = fetchResult(req.query.q);  // grows forever
});
// Fix: use LRU cache with bounded capacity

// 2. Event listener leak
function handleRequest(req) {
  emitter.on('data', (d) => process(d, req));  // adds listener every request
}                                                  // old listeners never removed
// Fix: emitter.once() or removeListener() in cleanup

// 3. Closure over large objects
function processLargeFile() {
  const bigBuffer = fs.readFileSync('huge.bin');
  return () => bigBuffer.length;  // closure keeps bigBuffer alive
}                                    // even after processing is done

// 4. Timers not cleared
const interval = setInterval(() => {
  heavyObject.doWork();  // keeps heavyObject and all its refs alive
}, 1000);
// Fix: clearInterval(interval) in cleanup / shutdown

*/


/** Detecting and Diagnosis Leaks
// 1. Monitor heap size over time
setInterval(() => {
  const { heapUsed, heapTotal } = process.memoryUsage();
  console.log({ heapUsedMB: Math.round(heapUsed / 1024 / 1024) });
}, 10_000);

// 2. Take heap snapshots with --inspect flag
//    node --inspect app.js → Chrome DevTools → Memory tab → Heap snapshot

// 3. Compare snapshots to find retained objects
//    snapshot1 → load test → snapshot2 → diff → find growing classes

*/


/** 
 * WeakMap and WeakRef for Leak safe caches
// WeakMap: keys are weakly held — GC can collect them
const cache = new WeakMap<object, ComputedResult>();

function getResult(obj: object) {
  if (cache.has(obj)) return cache.get(obj);
  const result = compute(obj);
  cache.set(obj, result);
  return result;
}
// When obj is GC'd, the cache entry is automatically removed
// No need to manually evict — no memory leak possible


*/
