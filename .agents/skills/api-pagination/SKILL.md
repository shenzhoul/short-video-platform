---
name: api-pagination
description: Pagination patterns for Douyin Clone list and search endpoints. Use when extending SearchRequest, applying PaginationGuard, returning PageableData, or implementing offset or cursor pagination in the API and frontend.
---

# API Pagination

Reuse the current pagination primitives instead of creating endpoint-specific query conventions.

## Backend

- Extend `api/src/kernel/common/search-request.ts` for list/search payloads.
- Apply `PaginationGuard` where the controller accepts paginated input.
- Return `PageableData` or the existing endpoint response contract.
- Apply filtering and sorting in MongoDB before pagination.
- Add an index for frequent filter/sort combinations.
- Use cursor pagination for growing feeds where stable continuation matters.

### Filtering after the page is read (2026-09-10)

Sometimes rows can only be filtered after paging — the liked collection pages
**reactions** and only learns which posts are still openable once it loads them.
Two rules, both from `ContentService.getLikedPosts`:

- **The cursor is the last row consumed, never the page's own cursor.** If you
  stop part-way through a source page because the output is full, handing out
  that page's `nextCursor` silently skips the rows after the stopping point.
- **Backfill, but bounded.** Dropping rows shortens the page; a page of three can
  come back with one, or a page of twenty with none (and an empty page with
  `hasMore: true` stalls a grid whose sentinel only renders under posts). Read
  further source pages up to a fixed number of rounds, then return what you have
  with `hasMore` and a cursor, so the client simply asks again.
- Keep the order key where the source sorts it. The liked order is the reaction's
  `createdAt`/`_id`; re-sorting mapped posts by their own `createdAt` is the
  classic wrong answer, so give fixtures posts whose `createdAt` runs opposite to
  the like order.
- Cover it by paging a fixture to exhaustion and asserting page sizes, distinct
  ids and full order (`content.service.spec.ts`: `20 + 20 + 20 + 7`, and the
  bounded-backfill case).

### An alternative order on the same route

A listing that needs a different order for one caller takes a **string enum**
(`creatorOrder: 'pinned' | 'latest'`), never a boolean query flag — implicit
conversion turns `'false'` into `true` before a transform runs. The sort and the
cursor must switch together: `PostSearchService.userSearchPosts` picks
`applyCreatorPinnedCursor` only when the order is pinned-first.

## Frontend

- Keep the query key stable and include every filter that changes the result set.
- Reset accumulated results when filters or identity change.
- De-duplicate records by stable ID when appending pages.
- Stop requesting when the API reports no continuation.

## Current References

- `api/src/kernel/common/search-request.ts`
- `api/src/common/guards/pagination.guard.ts`
- `api/src/controllers/content/post/post.controller.ts`
- `user/src/hooks/use-home-feed-infinite-scroll.ts`

## Verification

- Test first page, next page, empty result, invalid bounds, filter changes, and duplicate prevention.
- Run the verification scripts for every touched app.
