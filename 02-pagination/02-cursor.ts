
// CURSOR-BASED PAGINATION
// ═══════════════════════
//
// CONCEPT:
//   Instead of a page number, the client sends a cursor — a pointer to the last
//   seen item. The server finds that item and returns the next N items after it.
//   Each response includes a new cursor for the next/previous page.
//
//   cursor = opaque token encoding the ID of the last item on the current page
//   startIndex = indexOf(cursorId) + 1   ← start AFTER the cursor item
//   data = items.slice(startIndex, startIndex + limit)
//
// EXAMPLE — 6 items [A, B, C, D, E, F], limit=2:
//
//   Request 1 (no cursor):
//     startIndex = 0, slice [A, B, C]  (limit+1 to detect hasMore)
//     hasMore = true (got 3 > limit 2)
//     data = [A, B],  nextCursor = encode(B.id),  prevCursor = ''
//
//   Request 2 (cursor = encode(B.id)):
//     decode → B.id, findIndex(B)+1 = 2
//     startIndex = 2, slice [C, D, E]
//     hasMore = true
//     data = [C, D],  nextCursor = encode(D.id),  prevCursor = encode(B.id)
//
//   Request 3 (cursor = encode(D.id)):
//     startIndex = 4, slice [E, F]
//     hasMore = false (got 2, not > limit 2)
//     data = [E, F],  nextCursor = '',  prevCursor = encode(D.id)
//
// TRICK — FETCH limit+1 TO DETECT hasMore:
//   Fetching one extra item avoids a separate COUNT query.
//   If we get back (limit+1) items → there IS a next page → hasMore = true.
//   We then discard the extra item before returning data to the client.
//
// OPAQUE CURSORS (Base64 encoding):
//   Raw DB IDs in the URL expose internal schema (auto-increment = row count leak,
//   UUIDs = guessable traversal). Base64 encoding makes cursors opaque — clients
//   treat them as black-box tokens, not page numbers they can manipulate.
//   encode: utf-8 id  → base64 string  (sent to client)
//   decode: base64    → utf-8 id       (used internally to locate the row)
//
// prevCursor:
//   Points to the item just BEFORE startIndex (items[startIndex - 1]).
//   If startIndex === 0 we're on the first page → prevCursor = ''.
//
// OFFSET vs CURSOR:
//   │ Aspect            │ Offset                        │ Cursor                        │
//   │ Navigation        │ Random (jump to any page)     │ Sequential (next/prev only)   │
//   │ Stable on inserts │ No (items shift, gaps/dupes)  │ Yes (anchored to a record ID) │
//   │ DB performance    │ O(offset) — scans skipped rows│ O(1) — index seek on cursor   │
//   │ Total count       │ Easy (COUNT query)            │ Hard (omitted here)           │
//   │ Best for          │ Static data, admin UIs        │ Feeds, real-time, large tables│
//
// USE WHEN:
//   Data changes frequently (feeds, notifications, activity logs),
//   large offsets would be slow (millions of rows),
//   or stable pagination is required (no duplicates/gaps on concurrent writes).

// Example - GET /users?cursor=abc123&limit=10&direction=next

// Interfaces
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


// Never expose raw DB IDs directly. Always encode them to create opaque cursors.
const encodeCursor = (id: string): string => 
    Buffer.from(id).toString('base64');

const decodeCursor = (cursor: string): string =>
    Buffer.from(cursor, 'base64').toString('utf-8');

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
    }

    // Take slice of items based on the calculated start index and limit with additional item to check for more data
    const slice = items.slice(startIndex, startIndex + safeLimit + 1);
    const hasMore = slice.length > safeLimit;
    const paginatedData = slice.slice(0, safeLimit);

    return {
        data: paginatedData,
        metadata: {
            hasMore: hasMore,
            nextCursor: hasMore ? encodeCursor(paginatedData[paginatedData.length - 1].id) : '',
            prevCursor: startIndex > 0 ? encodeCursor(items[startIndex - 1].id) : ''
        }
    }


}