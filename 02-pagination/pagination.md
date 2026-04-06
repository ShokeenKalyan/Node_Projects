# Pagination

## Overview

Pagination controls how large datasets are split and served in chunks. Two primary strategies:

| | Offset-based | Cursor-based |
|---|---|---|
| Also called | Page-based / Skip-limit | Keyset / Seek pagination |
| Works like | "Skip N, take M" | "Give me items after ID X" |
| Best for | Admin UIs, static data | Feeds, real-time data, APIs |
| DB query | `LIMIT + OFFSET` | `WHERE id > cursor LIMIT N` |
| Problem | Skips/dupes on live data | No random page access |

---

## Offset-based Pagination

**API shape:** `GET /users?page=2&limit=10`

### How it works
- Calculate `offset = (page - 1) * limit`
- Fetch `items[offset .. offset + limit]`
- Return data + metadata (totalItems, totalPages, hasNextPage, hasPreviousPage)

### Implementation ([01-offset.ts](01-offset.ts))

```typescript
interface PaginationParams {
    page: number;
    limit: number;
}

interface PaginatedResult {
    data: any[];
    metadata: {
        page: number;
        limit: number;
        totalItems: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    }
}

function getPaginatedResults(items: any[], params: PaginationParams): PaginatedResult {
    const { page, limit } = params;

    const safePage = Math.max(1, page);                        // clamp: min page = 1
    const safeLimit = Math.min(Math.max(1, limit), 100);       // clamp: 1–100

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / safeLimit);
    const offset = (safePage - 1) * safeLimit;
    const paginatedData = items.slice(offset, offset + safeLimit);

    return {
        data: paginatedData,
        metadata: {
            page: safePage,
            limit: safeLimit,
            totalItems,
            totalPages,
            hasNextPage: safePage < totalPages,
            hasPreviousPage: safePage > 1
        }
    };
}
```

### Key implementation details
- **Input sanitization:** `safePage` clamps to min 1; `safeLimit` clamps to 1–100 to prevent abuse.
- **`offset` formula:** `(page - 1) * limit` — page 1 → offset 0, page 2 → offset 10, etc.
- **`hasNextPage`:** `page < totalPages` (not `page <= totalPages`).
- **Metadata includes `totalItems` and `totalPages`** — enables UI page-count displays.

### Pros
1. **Simplicity** — easy to implement and understand.
2. **Flexibility** — users can jump to any arbitrary page number.

### Cons
1. **Performance** — DB must scan all skipped rows; gets slower as offset grows.
2. **Inconsistency** — inserts/deletes while paginating cause duplicate or missing items.
3. **Scalability** — requires a `COUNT(*)` query for total metadata; expensive on large tables.

---

## Cursor-based Pagination

**API shape:** `GET /users?cursor=abc123&limit=10&direction=next`

### How it works
- Client sends an opaque `cursor` (encoded ID of the last seen item).
- Server decodes cursor → finds position → slices next `limit` items.
- Response includes `nextCursor`, `prevCursor`, and `hasMore` flag.
- Fetch `limit + 1` items; if `slice.length > limit` then `hasMore = true`.

### Cursor encoding
Cursors are **base64-encoded IDs** — never expose raw DB IDs directly.

```typescript
const encodeCursor = (id: string): string =>
    Buffer.from(id).toString('base64');

const decodeCursor = (cursor: string): string =>
    Buffer.from(cursor, 'base64').toString('utf-8');
```

### Implementation ([02-cursor.ts](02-cursor.ts))

```typescript
interface CursorPaginationParams {
    cursor?: string;
    limit: number;
    direction?: 'next' | 'previous';
}

interface CursorPaginatedResult {
    data: any[];
    metadata: {
        nextCursor: string;
        prevCursor: string;
        hasMore: boolean;
    }
}

function getCursorPaginatedResults(
    items: any[],
    params: CursorPaginationParams
): CursorPaginatedResult {
    const { cursor, limit, direction = 'next' } = params;
    const safeLimit = Math.min(Math.max(1, limit), 100);

    let startIndex = 0;

    if (cursor) {
        const cursorId = decodeCursor(cursor);
        startIndex = items.findIndex(item => item.id === cursorId) + 1;
        // +1 → start AFTER the cursor item
    }

    // Fetch limit+1 to detect if more pages exist
    const slice = items.slice(startIndex, startIndex + safeLimit + 1);
    const hasMore = slice.length > safeLimit;
    const paginatedData = slice.slice(0, safeLimit);   // trim the +1 probe item

    return {
        data: paginatedData,
        metadata: {
            hasMore,
            nextCursor: hasMore
                ? encodeCursor(paginatedData[paginatedData.length - 1].id)
                : '',
            prevCursor: startIndex > 0
                ? encodeCursor(items[startIndex - 1].id)
                : ''
        }
    };
}
```

### Key implementation details
- **`limit + 1` trick:** Fetch one extra item to know if more data exists without a `COUNT(*)`.
- **`startIndex + 1`:** `findIndex` returns the cursor item's index; `+1` skips past it.
- **`prevCursor`:** Points back to `items[startIndex - 1]` — the item just before current page.
- **Empty `nextCursor`/`prevCursor`:** Empty string `''` signals no further pages in that direction.
- **Opaque cursors:** Base64 encoding hides internal IDs from clients.

### Pros
1. **Performance** — uses indexed `WHERE id > last_id` queries; always O(log n).
2. **Consistency** — inserts/deletes don't shift results; cursor anchors to a stable ID.
3. **Scalability** — no `COUNT(*)` needed; works well under high traffic and large datasets.

### Cons
1. **Complexity** — harder to implement, especially for bi-directional navigation.
2. **No random page access** — cannot jump to "page 5" directly.
3. **Client state** — client must store and pass the cursor on every request.

---

## SQL Performance Comparison

```sql
-- Offset: gets slower as OFFSET grows (DB scans all skipped rows)
SELECT * FROM orders ORDER BY created_at DESC
LIMIT 20 OFFSET 10000;  -- scans 10020 rows!

-- Cursor (keyset): always O(log n) with index on id
SELECT * FROM orders
WHERE id < :lastId           -- uses B-tree index directly
ORDER BY id DESC LIMIT 20;

-- Composite cursor (sorted by created_at + id for stability)
SELECT * FROM orders
WHERE (created_at, id) < (:lastCreatedAt, :lastId)
ORDER BY created_at DESC, id DESC LIMIT 20;
```

> Cursor pagination works efficiently because it leverages indexed queries like
> `WHERE id > last_id`, avoiding full table scans.

---

## When to Use Which

| Scenario | Use |
|---|---|
| Admin dashboard with page numbers | Offset |
| Infinite scroll / social feed | Cursor |
| Static/infrequently changing data | Offset |
| Real-time data (orders, messages) | Cursor |
| Need total page count in UI | Offset |
| High-scale API (millions of rows) | Cursor |
