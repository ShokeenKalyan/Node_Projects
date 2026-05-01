
// JS specific implementation of LRU Cache using Map
// Map iteration order = insertion order, so we can use it to maintain the order of usage
// Move to end on access, delete first entry on eviction
// Time Complexity: O(1) for get and put operations

// WHY MAP WORKS PERFECTLY FOR LRU CACHE
// ─────────────────────────────────────
// Map guarantees iteration in INSERTION ORDER (spec-mandated).
// This maps LRU logic directly onto Map's internal structure:
//
//   | LRU concept                        | Map behavior                               |
//   | "most recently used" → move to end | delete(key) + set(key, val) re-inserts     |
//   | "least recently used" → at front   | keys().next().value → first inserted key   |
//   | evict LRU                          | delete(firstKey) → O(1)                    |
//
// Example:
//   Map state (oldest → newest): [A, B, C]
//   Access B → delete B, re-insert B:  [A, C, B]   ← B is now "most recent"
//   Cache full → evict first key (A):  [C, B]
//
// WHY NOT a plain object {}?
//   Plain objects also preserve insertion order for string keys, but
//   Object.keys(obj)[0] is O(n) — it builds a full array to get the first key.
//   Map's keys().next().value is O(1) via its internal linked-list iterator.
//
// WHY ALL OPERATIONS ARE O(1):
//   map.has() / map.get() / map.set() / map.delete() → O(1) hash table ops
//   map.keys().next().value                           → O(1) linked-list head access
//
//   V8 implements Map as a hash table + doubly linked list (ordered by insertion).
//   That linked list IS the LRU order — Map gives it for free, so we don't need
//   to implement the doubly linked list manually (as the canonical LRU solution does).

class LRUCacheSimple<K, V> {
    private map = new Map<K, V>();
    constructor(private capacity: number) {}

    // Returns the value of the key if the key exists, otherwise returns -1.
    get(key: K): V | -1 {
        if (!this.map.has(key)) {
            return -1;
        }

        const value = this.map.get(key)!;
        this.map.delete(key); // Remove the key to update its position
        this.map.set(key, value);
        return value
    }

    // Updates the value of the key if the key exists, otherwise adds the key-value pair to the cache.
    // If the number of keys exceeds the capacity from this operation, evict the least recently used key.
    put(key: K, value: V): void {
        if (this.map.has(key)) {
            this.map.delete(key); // Remove the key to update its position
        }
        this.map.set(key, value);

        if (this.map.size > this.capacity) {
            // The first key in the Map is the least recently used key
            const lruKey = this.map.keys().next().value;
            if (lruKey !== undefined) {
                this.map.delete(lruKey); // Remove the least recently used key
            }
        }

    }
}