
// =============================================================================
// GENERATOR FUNCTIONS — Lazy, Infinite Sequences in JavaScript/TypeScript
// =============================================================================
//
// WHAT IS A GENERATOR FUNCTION?
//   A function declared with `function*` that can pause execution mid-way using
//   `yield`, and resume from that exact point on the next call to `.next()`.
//   It returns a Generator object that implements both the Iterator and Iterable
//   protocols — so it works with `for...of`, spread, destructuring, etc.
//
// THE ITERATOR PROTOCOL:
//   Any object with a `.next()` method that returns { value, done } is an Iterator.
//   When done=false → value is the yielded item.
//   When done=true  → sequence is exhausted (value is the return value, if any).
//
// THE ITERABLE PROTOCOL:
//   Any object with a [Symbol.iterator]() method that returns an Iterator.
//   Built-ins like Array, Map, Set, String are all iterables.
//   Generators satisfy both protocols simultaneously.
//
// WHY GENERATORS FOR SEQUENCES?
//   ✓ Lazy evaluation — values computed only when requested (no memory wasted)
//   ✓ Infinite sequences — a while(true) loop that never crashes
//   ✓ Composable — generators can consume other generators (pipeline pattern)
//   ✓ Cleaner than a class for stateful iteration — state is implicit in the call stack
//   ✓ Works natively with for...of, Array.from(), destructuring, spread
//
// =============================================================================
// LEVEL 1 — Basic Counter (vs. the class in file 1)
// =============================================================================
//
// Compare to the SequenceGenerator class in 1-basic-in-memory.ts:
//   Class version needs constructor + field + method (8 lines)
//   Generator version is 3 lines — state lives in the local variable `current`

function* counter(start = 1): Generator<number> {
    let current = start;
    while (true) {
        yield current++; // pause here, hand value to caller, resume on next .next()
    }
}

const gen = counter(1);
console.log(gen.next()); // { value: 1, done: false }
console.log(gen.next()); // { value: 2, done: false }
console.log(gen.next()); // { value: 3, done: false }

// Destructure the first 3 values using Array.from with a count limit:
const first5 = Array.from({ length: 5 }, () => gen.next().value);
console.log(first5); // [4, 5, 6, 7, 8]  (continues from where it left off)

// =============================================================================
// LEVEL 2 — Finite Sequence with a return value
// =============================================================================
//
// A generator can also be finite — just let the function body end naturally.
// The final `return` sets { value: returnValue, done: true }.
// For...of loops stop when done=true (they ignore the return value).

function* range(start: number, end: number, step = 1): Generator<number> {
    for (let i = start; i < end; i += step) {
        yield i;
    }
    // implicit return → { value: undefined, done: true }
}

console.log([...range(0, 10, 2)]); // [0, 2, 4, 6, 8]

for (const n of range(1, 4)) {
    console.log(n); // 1, 2, 3
}

// =============================================================================
// LEVEL 3 — ID Generator with Prefix Formatting
// =============================================================================
//
// Generators compose naturally with formatting logic.
// Here the generator handles sequencing; the formatter handles presentation.
// Clean separation of concerns — same pattern used in real CLI tools and ORMs.

function* idGenerator(prefix: string, start = 1): Generator<string> {
    let seq = start;
    while (true) {
        yield `${prefix}-${String(seq++).padStart(6, '0')}`;
    }
}

const orderIds = idGenerator('ORD');
console.log(orderIds.next().value); // "ORD-000001"
console.log(orderIds.next().value); // "ORD-000002"

const invoiceIds = idGenerator('INV', 500);
console.log(invoiceIds.next().value); // "INV-000500"

// Each call to idGenerator() creates an independent generator with its own state.
// No shared mutable state — unlike a singleton class counter.

// =============================================================================
// LEVEL 4 — Fibonacci (classic infinite generator interview question)
// =============================================================================
//
// "Implement an infinite Fibonacci sequence" is a canonical generator question.
// Without generators, you'd need a class or closure. With generators: 4 lines.

function* fibonacci(): Generator<number> {
    let [a, b] = [0, 1];
    while (true) {
        yield a;
        [a, b] = [b, a + b];
    }
}

const fib = fibonacci();
const first8Fibs = Array.from({ length: 8 }, () => fib.next().value);
console.log(first8Fibs); // [0, 1, 1, 2, 3, 5, 8, 13]

// =============================================================================
// LEVEL 5 — Generator Composition with yield*
// =============================================================================
//
// `yield*` delegates to another iterable (array, string, or another generator).
// This is the generator equivalent of function composition / flatMap.
//
// USE CASE: build a sequence from multiple sources in order.

function* concat<T>(...iterables: Iterable<T>[]): Generator<T> {
    for (const iterable of iterables) {
        yield* iterable; // delegate — yield every item from this iterable, then move on
    }
}

const combined = [...concat([1, 2], [3, 4], [5, 6])];
console.log(combined); // [1, 2, 3, 4, 5, 6]

// yield* with another generator:
function* take<T>(n: number, source: Generator<T>): Generator<T> {
    for (let i = 0; i < n; i++) {
        const { value, done } = source.next();
        if (done) return;
        yield value as T;
    }
}

const firstTenIds = [...take(10, idGenerator('USR'))];
console.log(firstTenIds);
// ["USR-000001", "USR-000002", ..., "USR-000010"]

// =============================================================================
// LEVEL 6 — Two-Way Communication via next(value)
// =============================================================================
//
// Generators are not just output pipes — callers can also SEND values back in
// via gen.next(value). The sent value becomes the result of the `yield` expression
// inside the generator. This is how async/await works under the hood.
//
// This is an advanced concept — most sequence generators don't use it, but
// interviewers sometimes probe for it to test depth of knowledge.

function* resettableCounter(start = 1): Generator<number, void, boolean> {
    //                                                          ^^^^^^^ type of next(value)
    let current = start;
    while (true) {
        const reset: boolean = yield current; // yield current out; receive reset signal in
        if (reset) {
            current = start; // caller sent true → reset to start
        } else {
            current++;
        }
    }
}

const rc = resettableCounter(1);
console.log(rc.next().value);       // 1   (first .next() starts the generator; value ignored)
console.log(rc.next(false).value);  // 2   (false → increment)
console.log(rc.next(false).value);  // 3
console.log(rc.next(true).value);   // 1   (true → reset back to start)
console.log(rc.next(false).value);  // 2

// =============================================================================
// LEVEL 7 — Making a Custom Class Iterable with [Symbol.iterator]
// =============================================================================
//
// Any class can be made iterable by adding a [Symbol.iterator]() method.
// This lets it work with for...of, spread, and Array.from natively.
// Common interview question: "Make this class work in a for...of loop."

class IdPool {
    private current: number;

    constructor(
        private prefix: string,
        private start = 1,
        private end = Infinity
    ) {
        this.current = start;
    }

    // Makes instances iterable — [Symbol.iterator] is the iterable protocol
    [Symbol.iterator](): Iterator<string> {
        return this; // the class itself acts as the iterator
    }

    // Makes instances an iterator — next() is the iterator protocol
    next(): IteratorResult<string> {
        if (this.current > this.end) {
            return { value: undefined as unknown as string, done: true };
        }
        return {
            value: `${this.prefix}-${String(this.current++).padStart(6, '0')}`,
            done: false,
        };
    }
}

const pool = new IdPool('TKT', 1, 3); // ticket IDs, only 3

for (const id of pool) {
    console.log(id); // "TKT-000001", "TKT-000002", "TKT-000003"
}
console.log([...new IdPool('TKT', 1, 3)]); // ["TKT-000001", "TKT-000002", "TKT-000003"]

// =============================================================================
// COMPARISON: Generator Function vs. Class-based Counter
// =============================================================================
//
//  Dimension              | Generator Function          | Class (file 1)
//  -----------------------|-----------------------------|---------------------------
//  State management       | Implicit (local variables)  | Explicit (class fields)
//  Boilerplate            | Minimal (3–5 lines)         | More (constructor + method)
//  for...of support       | ✓ built-in                  | ✗ need [Symbol.iterator]
//  Spread / destructure   | ✓ built-in                  | ✗ need [Symbol.iterator]
//  Two-way communication  | ✓ next(value)               | ✗ not supported
//  Composable pipelines   | ✓ yield*                    | ✗ manual wiring
//  Persistence / DB       | ✗ in-memory only            | ✓ can encapsulate async
//  Distributed safety     | ✗ single process only       | ✗ single process only
//  Best for               | Lazy local sequences, APIs  | When you need methods/reset
//
// BOTTOM LINE:
//   Generator functions are the idiomatic JS answer for any "model an infinite
//   or lazy sequence" question. They do NOT replace persistence or distributed
//   ID generation (files 1–3) — they're a cleaner in-process tool for the same
//   single-process problem that the basic counter in file 1 solves.
