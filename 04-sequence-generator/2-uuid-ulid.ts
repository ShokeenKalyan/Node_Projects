
// =============================================================================
// UUID / ULID — Decentralized Unique ID Generation
// =============================================================================
//
// MOTIVATION:
//   Snowflake and DB sequences require coordination (machine IDs, shared state).
//   UUID/ULID generate globally unique IDs with zero coordination — any node
//   can generate them independently without talking to anyone else.
//
// =============================================================================
// UUID v4 — Random (RFC 4122)
// =============================================================================
//
// STRUCTURE (128 bits, displayed as 32 hex chars + 4 dashes):
//   xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
//                  ^    ^
//                  |    version=4 marker
//                  y = variant bits (8, 9, a, or b)
//
// EXAMPLE: "550e8400-e29b-41d4-a716-446655440000"
//
// HOW IT WORKS:
//   122 bits of cryptographically random data + 6 fixed version/variant bits.
//   The probability of collision with 1 billion UUIDs generated per second:
//   you'd need ~85 years before expecting the first collision. Effectively zero.
//
// WHY USE IT:
//   ✓ Zero coordination — generate anywhere, anytime, offline
//   ✓ No central authority or machine ID needed
//   ✓ Universally supported (DB columns, ORMs, languages, APIs)
//   ✗ Not sortable — random order breaks B-tree index locality (page fragmentation)
//   ✗ Large (36 chars as string, 16 bytes as binary) vs. 8-byte integer IDs
//   ✗ Not human-readable / debuggable (no timestamp embedded)

import { randomUUID, randomBytes } from "crypto";

function generateUUIDv4(): string {
    return randomUUID(); // Built into Node.js 14.17+ via crypto module
}

console.log(generateUUIDv4()); // e.g. "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"

// =============================================================================
// UUID v7 — Time-Ordered (RFC 9562, ratified 2024)
// =============================================================================
//
// STRUCTURE (128 bits):
//   | 48 bits unix_ts_ms | 4 bits version=7 | 12 bits rand_a | 2 bits variant | 62 bits rand_b |
//     (millisecond epoch)                     (extra entropy)                   (random)
//
// HOW IT DIFFERS FROM v4:
//   The first 48 bits are a millisecond-precision Unix timestamp.
//   This makes UUIDs sortable by generation time — IDs created later sort later.
//   The remaining bits are random for uniqueness within the same millisecond.
//
// WHY THIS MATTERS FOR DATABASES:
//   B-tree indexes (used by PostgreSQL, MySQL, etc.) perform best when new rows
//   are inserted in order. v4 UUIDs insert randomly across the index, causing
//   frequent page splits and cache eviction ("random write amplification").
//   v7 UUIDs always append to the end of the index — same locality as integers.
//
//   Benchmark context: at scale, switching from UUID v4 → v7 can reduce
//   index write overhead by 50–90% (similar to using SERIAL integers).
//
// ✓ Zero coordination (like v4)
// ✓ Sortable by time — B-tree friendly (unlike v4)
// ✓ Embeds timestamp — can extract creation time from the ID
// ✓ Gaining rapid adoption — Postgres 17 has uuid_generate_v7(), many ORMs support it
// ✗ Still 16 bytes (larger than 8-byte bigint)
// ✗ Node.js crypto does not have a built-in — need to construct manually or use a library

function generateUUIDv7(): string {
    const now = BigInt(Date.now()); // ms since Unix epoch — fits in 48 bits

    // 48-bit timestamp occupies the high bits of the first 8 bytes
    const timeHigh = (now >> 16n) & 0xFFFFFFFFn;  // top 32 bits of timestamp
    const timeLow  = now & 0xFFFFn;               // bottom 16 bits of timestamp

    const randBytes = randomBytes(10); // 80 bits of randomness for the rest

    // version=7 occupies bits 76-79; variant=0b10 occupies bits 64-65
    const ver  = 0x7000 | (randBytes[0] << 4 | randBytes[1] >> 4); // 4-bit version + 12-bit rand_a
    const var_ = 0x8000 | ((randBytes[1] & 0x3f) << 8 | randBytes[2]);  // 2-bit variant + rand_b start

    // Format as standard UUID string: 8-4-4-4-12
    const hex = (n: bigint | number, width: number) =>
        n.toString(16).padStart(width, '0');

    return [
        hex(timeHigh, 8),
        hex(timeLow, 4),
        hex(ver, 4),
        hex(var_, 4),
        Buffer.from(randBytes.slice(3)).toString('hex').slice(0, 12),
    ].join('-');
}

console.log(generateUUIDv7()); // e.g. "018f6a3b-2c1d-7e4f-b892-1a3c5e7f9b0d"
//                                       ^^^^^^^^^^^^^ timestamp prefix → sortable

// =============================================================================
// ULID — Universally Unique Lexicographically Sortable Identifier
// =============================================================================
//
// STRUCTURE (128 bits, encoded as 26 Crockford Base32 characters):
//   | 48 bits timestamp | 80 bits random |
//   ttttttttttrrrrrrrrrrrrrrrrr   (26 chars, no dashes)
//
// EXAMPLE: "01ARZ3NDEKTSV4RRFFQ69G5FAV"
//
// KEY PROPERTIES:
//   - Lexicographic sort  = chronological sort (string comparison works correctly)
//   - URL-safe            — no special characters, no dashes, uppercase by default
//   - Compact             — 26 chars vs UUID's 36 chars (28% smaller as string)
//   - Case-insensitive    — Crockford Base32 excludes ambiguous chars (I, L, O, U)
//   - Same timestamp resolution as UUID v7 (millisecond)
//   - 80 bits of randomness → 2^80 ≈ 1.2 × 10^24 unique values per millisecond
//
// vs UUID v7:
//   ULID  → shorter string, URL-safe, no dashes, slightly more common in JS/Go ecosystems
//   UUIDv7 → standardized RFC, wider DB/ORM native support, hyphenated format
//   Functionally very similar — both solve the "sortable unique ID" problem.
//
// ✓ Sortable by creation time (lexicographic = chronological)
// ✓ No dashes — cleaner in URLs, logs, filenames
// ✓ No coordination needed
// ✗ Not an official RFC standard (unlike UUID)
// ✗ No native Node.js support — need the `ulid` package

// Implementation (manual, no external deps — shows the algorithm):
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32 alphabet (32 chars, no I/L/O/U)
const ENCODING_LEN = ENCODING.length;

function encodeTime(timestamp: number, len: number): string {
    let str = '';
    for (let i = len - 1; i >= 0; i--) {
        str = ENCODING[timestamp % ENCODING_LEN] + str;
        timestamp = Math.floor(timestamp / ENCODING_LEN);
    }
    return str;
}

function encodeRandom(len: number): string {
    const bytes = randomBytes(len);
    return Array.from(bytes)
        .map(b => ENCODING[b % ENCODING_LEN])
        .join('');
}

function generateULID(): string {
    const timestamp = Date.now();           // 48-bit ms epoch
    return encodeTime(timestamp, 10)        // 10 Base32 chars = 50 bits (covers 48-bit ts)
         + encodeRandom(16);               // 16 Base32 chars ≈ 80 bits of randomness
}

console.log(generateULID()); // e.g. "01ARZ3NDEKTSV4RRFFQ69G5FAV"

// =============================================================================
// COMPARISON SUMMARY
// =============================================================================
//
//  Feature              | UUID v4        | UUID v7        | ULID
//  ---------------------|----------------|----------------|----------------
//  Sortable             | ✗ random       | ✓ by time      | ✓ by time
//  Coordination needed  | ✗ none         | ✗ none         | ✗ none
//  String length        | 36 chars       | 36 chars       | 26 chars
//  URL-safe             | ✗ (has dashes) | ✗ (has dashes) | ✓ (no dashes)
//  RFC standard         | ✓ RFC 4122     | ✓ RFC 9562     | ✗ spec only
//  DB index friendly    | ✗ poor         | ✓ good         | ✓ good
//  Timestamp embedded   | ✗              | ✓ (48-bit ms)  | ✓ (48-bit ms)
//  Native Node.js       | ✓ crypto       | ✗ manual       | ✗ ulid package
//  Randomness bits      | 122 bits       | 74 bits        | 80 bits
//
// INTERVIEW DECISION GUIDE:
//   "I need unique IDs, coordination is fine"      → DB SERIAL / Snowflake
//   "I need unique IDs, no coordination, any order"→ UUID v4
//   "I need unique IDs, no coordination, sortable" → UUID v7 (or ULID)
//   "I need sortable IDs in URLs / filenames"      → ULID
