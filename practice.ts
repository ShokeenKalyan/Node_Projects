

class LRUNode<K, V> {
    key: K;
    value: V;
    prev: LRUNode<K, V> | null = null;
    next: LRUNode<K, V> | null = null

    constructor(key: K, value: V) {
        this.key = key;
        this.value = value;
    }
}


class LRUCache<K, V> {

    private readonly capacity: number;
    private size: number = 0;
    private map: Map<K, LRUNode<K, V>>;

    // Sentinel head and tail nodes
    readonly head: LRUNode<K, V>;
    readonly tail: LRUNode<K, V>;

    constructor(capacity: number) {
        if (!Number.isInteger(capacity) || capacity <=0) {
            throw new Error (`Invalid capacity ${capacity}`);
        }
        this.capacity = capacity;
        this.map = new Map<K, LRUNode<K, V>>();

        this.head = new LRUNode<K, V>(null!, null!);
        this.tail = new LRUNode<K, V>(null!, null!);
    }

    get(key: K): V | null {
        const node = this.map.get(key);
        if (!node) return null;

        this.moveToHead(node);
        return node?.value;

    }

    put(key: K, value: V): void {
        const existingNode = this.map.get(key);

        if (existingNode) {
            existingNode.value = value;
            this.moveToHead(existingNode)
            return;
        }

        const node = new LRUNode<K, V>(key, value);
        this.map.set(key, node);
        this.addToHead(node)
        this.size++;

        if (this.size > this.capacity) {
            const evictedNode = this.removeTail()
            this.map.delete(evictedNode.key);
            this.size--;
        }
    }

    private addToHead(node: LRUNode<K, V>): void {
        node.prev = this.head;
        node.next = this.head.next;
        this.head.next!.prev = node;
        this.head.next = node;
    }

    private removeNode(node: LRUNode<K, V>): void {
        node.prev!.next = node.next;
        node.next!.prev = node.prev;
    }

    private moveToHead(node: LRUNode<K, V>): void {
        this.removeNode(node);
        this.addToHead(node);
    }

    private removeTail(): LRUNode<K, V> {
        const lruNode = this.tail.prev!;
        this.removeNode(lruNode);
        return lruNode;
    }

}
