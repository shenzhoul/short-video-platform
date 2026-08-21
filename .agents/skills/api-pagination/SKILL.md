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
