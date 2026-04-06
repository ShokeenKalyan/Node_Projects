

// LRU CACHE — CANONICAL IMPLEMENTATION (Doubly Linked List + HashMap)
// ════════════════════════════════════════════════════════════════════
//
// PROBLEM: Cache with fixed capacity. On every get/put, the accessed item
// becomes "most recently used". When capacity is exceeded, evict the
// "least recently used" item. All operations must be O(1).
//
// WHY TWO DATA STRUCTURES?
//   HashMap alone   → O(1) lookup, but no way to track usage ORDER
//   DLL alone       → O(1) insert/delete/reorder, but O(n) lookup by key
//   HashMap + DLL   → O(1) lookup (via map) + O(1) reorder (via DLL pointers)
//   Map stores: key → DLLNode, so we can jump straight to any node in O(1).
//
// DOUBLY LINKED LIST LAYOUT (head = most recent, tail = least recent):
//
//   [HEAD sentinel] ↔ [most recent] ↔ [....] ↔ [least recent] ↔ [TAIL sentinel]
//
//   Sentinel nodes (dummy head & tail) eliminate null checks on edge cases
//   (empty list, single item) — the list is ALWAYS non-empty with them wired up.
//
// CORE INVARIANT:
//   Every get/put moves the accessed node right after HEAD.
//   The node just before TAIL is always the LRU candidate for eviction.
//
// EXAMPLE — capacity 3, operations: put(A), put(B), put(C), get(A), put(D)
//
//   put(A):  HEAD ↔ A ↔ TAIL
//   put(B):  HEAD ↔ B ↔ A ↔ TAIL
//   put(C):  HEAD ↔ C ↔ B ↔ A ↔ TAIL
//   get(A):  move A to head →  HEAD ↔ A ↔ C ↔ B ↔ TAIL
//   put(D):  insert D at head → HEAD ↔ D ↔ A ↔ C ↔ B ↔ TAIL  (size=4 > capacity=3)
//            evict tail.prev (B) →  HEAD ↔ D ↔ A ↔ C ↔ TAIL
//            map.delete(B)
//
// TIME COMPLEXITY:
//   get  → O(1): map lookup + DLL pointer rewire (constant steps)
//   put  → O(1): map insert + DLL insert at head + optional tail eviction
//
// SPACE COMPLEXITY: O(capacity) — map and DLL hold at most `capacity` nodes.

class DLLNode<K, V> {
    key: K;
    value: V;
    prev: DLLNode<K, V> | null = null;
    next: DLLNode<K, V> | null = null;

    constructor(key: K, value: V) {
        this.key = key;
        this.value = value;
    }
}

class LRUCache<K, V> {
    private capacity: number;
    private map = new Map<K, DLLNode<K, V>>();
    private head = new DLLNode<any, any>(null, null); // Dummy sentinel head
    private tail = new DLLNode<any, any>(null, null); // Dummy sentinel tail

    constructor(capacity: number) {
        if (capacity < 1) {
            throw new Error("Capacity must be at least 1");
        }
        this.capacity = capacity;

        // Wire sentinel nodes together - List is always non-empty with these two
        this.head.next = this.tail;
        this.tail.prev = this.head;
    }

    // Returns the value associated with the key if it exists, otherwise returns -1
    get(key: K): V | -1 {
        const node = this.map.get(key);
        if (!node) {
            return -1; // Cache miss
        }
        this.moveToHead(node); // Mark as recently used
        return node.value; // Cache hit
    }

    // Inserts or updates the value associated with the key. If the cache exceeds its capacity, it evicts the least recently used item.
    put(key: K, value: V): void {
        const existingNode = this.map.get(key);
        if (existingNode) {
            existingNode.value = value; // Update value in place
            this.moveToHead(existingNode); // Mark as recently used
            return;
        }
        const newNode = new DLLNode(key, value);
        this.map.set(key, newNode);
        this.insertAtHead(newNode); // New node is most recently used

        if (this.map.size > this.capacity) {
            const lruNode = this.removeTail(); // Evict least recently used node
            this.map.delete(lruNode.key);
        }


    }

    // Returns the current number of items in the cache
    get size(): number {
        return this.map.size;
    }

    // Inserts a node right after the head (most recently used position)
    private insertAtHead(node: DLLNode<K, V>): void {
        node.prev = this.head; // New node's previous is head
        node.next = this.head.next; // New node's next is current first node
        this.head.next!.prev = node; // Current first node's previous is new node
        this.head.next = node; // Head's next is new node
    }

    // Removes a node from the linked list
    private removeNode(node: DLLNode<K, V>): void {
        // Bypass the node to remove it from the list
        node.prev!.next = node.next; 
        node.next!.prev = node.prev;
    }

    // Move a node to the head of the list to mark it as recently used
    private moveToHead(node: DLLNode<K, V>): void {
        this.removeNode(node); // Remove from current position
        this.insertAtHead(node); // Re-insert at head to mark as recently used
    }

    // Removes the least recently used node (the one just before the tail)
    private removeTail(): DLLNode<K, V> {
        const lru = this.tail.prev!;
        this.removeNode(lru);
        return lru;
    }

}