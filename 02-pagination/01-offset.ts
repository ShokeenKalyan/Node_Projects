

// OFFSET-BASED PAGINATION
// ═══════════════════════
//
// CONCEPT:
//   Client sends a page number and a page size (limit).
//   Server calculates how many records to skip (offset) and returns the slice.
//
//   offset = (page - 1) * limit
//   data   = items.slice(offset, offset + limit)
//
// EXAMPLE — 25 items, limit=10:
//   page 1 → offset=0,  slice [0..9]   → items 1–10
//   page 2 → offset=10, slice [10..19] → items 11–20
//   page 3 → offset=20, slice [20..24] → items 21–25  (partial last page)
//
//   totalPages = ceil(25 / 10) = 3
//   hasNextPage     on page 2 → safePage(2) < totalPages(3) → true
//   hasPreviousPage on page 2 → safePage(2) > 1             → true
//
// INPUT SANITIZATION:
//   safePage  = Math.max(1, page)         → clamp negative/zero pages to 1
//   safeLimit = Math.min(Math.max(1, limit), 100) → clamp to [1, 100], prevents
//               limit=0 (division by zero for totalPages) and limit=9999 (DoS)
//
// PROS:
//   Simple to implement and understand.
//   Supports random access — jump directly to any page.
//   Works with SQL: SELECT * FROM users LIMIT 10 OFFSET 20
//
// CONS:
//   Skipping rows is expensive at large offsets in databases (DB still scans rows 0..offset-1).
//   Page drift — if a row is inserted/deleted between requests, items can shift,
//   causing duplicates or gaps across pages (not stable).
//   Not suitable for real-time feeds or high-churn datasets.
//
// USE WHEN:
//   Dataset is relatively static, random-access navigation ("go to page 5") is needed,
//   or total count display is required (e.g. "Showing 21–30 of 243 results").

// Example: GET /users?page=2&limit=10

// Interfaces
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

function getPaginatedResults(
    items: any[],
    params: PaginationParams
): PaginatedResult {
    const { page, limit } = params;

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / safeLimit);
    const offset = (safePage - 1) * safeLimit;
    const paginatedData = items.slice(offset, offset + safeLimit);

    return {
        data: paginatedData,
        metadata: {
            page: safePage,
            limit: safeLimit,
            totalItems: totalItems,
            totalPages: totalPages,
            hasNextPage: safePage < totalPages,
            hasPreviousPage: safePage > 1
        }
    }
}