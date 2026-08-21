---
name: feed-infinite-scroll
description: Infinite-scroll behavior for Douyin Clone home, recommended, and creator post feeds. Use when changing useHomeFeedInfiniteScroll, creator post search, ScrollList, cursor metadata, or feed append/reset behavior.
---

# Feed Infinite Scroll

Trace the API query, service response, hook state, and rendering component together.

## Current Flow

- API post routes live under `api/src/controllers/content/post/`.
- Feed query and mapping logic lives under `api/src/services/content/`.
- Home feed pagination is consumed by `user/src/hooks/use-home-feed-infinite-scroll.ts`.
- Feed rendering uses `user/src/components/content/post/home-feed.tsx` and related post components.
- Creator content search uses `user/src/hooks/use-creator-post-search.ts`.

## Invariants

- Include user identity and active filters in cache/query keys.
- Reset pages when filters or the viewed creator change.
- De-duplicate appended posts by ID.
- Do not request another page when continuation is absent.
- Preserve the current order returned by the API.
- Creator-scoped lists order `isPinned: true` first, then `pinnedAt` newest-first, then the normal
  `createdAt`/`_id` order. Their cursor must carry `isPinned` and `pinnedAt`; applying a plain
  created-at cursor to this compound order can replay or skip posts. General Home, Following, and
  recommendation feeds must not promote profile pins.
- Keep loading, empty, error, and retry states distinct.
- Keep Home featured and compact media at the shared 16:9 ratio. The featured card spans two grid rows; changing only compact cards to 4:3 makes those rows taller and creates a false blank block below the featured card.
- Handle portrait covers inside the 16:9 media frame with the shared blurred-background treatment; do not change the grid aspect ratio to match the source image.

### Presentation slots above a paginated list

- A reader-specific section above a list (notification context, owner-only top comment) is a
  *presentation surface*, never a sort. Do not reorder, mutate or refetch the paginated state to
  put something on top of it, and never adjust the cursor for it.
- Suppress the promoted item from the list at render time only — filter the array on the way to
  JSX. When the section stops applying, the item returns to its own position with no request.
- Rank on the server, not in the client, so the rule cannot drift between the two. An
  audience-scoped section (owner-only) must be enforced by the endpoint, not just hidden in the UI.
- Give the sections an explicit priority when more than one can point at the same item, so the
  reader never sees one item twice under two headings.
- Reuse the ordinary row component inside the section. One row UI, not two.

## Verification

- Verify initial load, append, end-of-feed, empty feed, retry, filter reset, and creator switch.
- Run targeted user tests, then `yarn lint` and `yarn build` in `user/`; run `yarn build` in `api/` when backend behavior changes.
