---
name: following-feed
description: One-way creator follow relationships and the authenticated Douyin Clone following feed. Use when adding or changing follow buttons, followed-creator state, follower/following counters, followed creator lists, or posts from followed creators across api/ and user/.
---

# Following Feed

## Invariants

- Store a follow as a unique reaction with `objectType=creator` and the dedicated `action=follow`; never overload content `like` semantics for creator relationships.
- Treat follow as one-way from the action rail: a successful follow removes the plus button and the same control must not unfollow.
- Make the follow endpoint idempotent. Increment `stats.followers` and `stats.followings` only when the relationship is first created; treat a duplicate-key race as an already-created follow.
- Make unfollow idempotent as well. Decrement counters only when a relationship was actually deleted, and guard both counters from dropping below zero.
- Treat creator `follow` reaction rows as authoritative. Cached `stats.followers` and `stats.followings` must be rebuilt by migration when legacy or orphan data can make profile counters disagree with relationship lists; never invent users from a cached count.
- Reject self-follow and only expose active followed creators.
- Populate `user.isFollowed` in post and creator DTOs with one batch query, never one query per post.

## API workflow

1. Keep relation and counter logic in `FollowService`.
2. Protect follow/list/feed endpoints with `AuthGuard`, `PaginationGuard` where applicable, and the repository throttler.
3. Return DTO/public response shapes; do not expose reaction documents.
4. Paginate followed creators and followed posts using existing search and cursor conventions.
5. Maintain indexes for unique relations and ordered lookups through a timestamped migration.

## User workflow

1. Use `useFollowCreator` for follow state, repeat-click prevention, and synchronization across mounted action rails.
2. Render the plus only for another creator who is not followed and hide it immediately after success.
3. Use `useFollowingFeed` for post pagination and interaction patches.
4. Render both video and graphic posts through the existing shared post stage, action rail, carousel, and detail modal primitives.
5. Keep the compact/expanded creator rail present even when the feed is empty; show a useful authenticated empty state.
6. Give an inline graphic post the same four-second playback contract as the graphic detail modal: timeline, play/pause, centered paused affordance, and previous/next image controls.
7. Treat the product's `Videos` tab as a mixed creator-works playlist. Query creator posts without a media-type filter and preserve video and graphic entries when navigation changes the active media variant.
8. Forward the requested initial detail-panel tab to both modal media variants; otherwise an avatar click on a graphic post opens the modal without activating `Videos`.
9. Theme the compact and expanded creator rail with shared surface, border, and text tokens. The media stage remains an inverse/dark canvas in both themes, while the navigation rail follows light or dark mode.
10. Keep graphic carousel navigation out of the action-rail lane. The right image control must reserve enough space for the avatar and interaction stack, independently of the outer post-navigation gutter.
11. Keep creator-list search and sorting wired to the rendered list. Reuse the shared hover dropdown for sort choices, and reveal the trailing creator-row more affordance only on hover or keyboard focus so names keep a stable width.
12. Limit creator-list sorting to recent and earliest relationship order. The more affordance opens the creator action modal; copying the Douyin ID and cancelling the relationship must work without reloading the page.
13. Match popup-PiP state by `pictureInPicturePayload.videoId`, not by the page-specific player instance ID, so the originating Following stage renders the shared `Currently playing` state.

## Verification

- Test first follow, repeated follow, concurrent duplicate follow, self-follow, first unfollow, and repeated unfollow.
- Verify empty following data does not call media guards with `undefined`.
- Open `Videos` from both a video and a graphic post and verify the same mixed creator playlist remains available after navigating between media types.
- Verify graphic carousel play/pause, automatic four-second advance, previous/next, and timeline progress.
- Verify compact and expanded creator rails in both light and dark mode, including search, all sort choices, hover/focus more affordances, and the hover sort dropdown. Confirm graphic next/previous controls never overlap the action rail.
- Open PiP from a Following video, verify its original stage shows `Currently playing`, then close PiP and verify playback can resume in the originating stage.
- Run focused API tests and `yarn build` in `api/`.
- Run `yarn lint` and `yarn build` in `user/`, then request `/following` and verify a 200 response.

## Mutual follows and messaging permission

`FollowService` also answers "do these two follow each other", which is what governs direct-message send permission:

- `areMutuallyFollowing(a, b)` — one query, both `$or` branches served by the existing unique reaction index.
- `getMutualFollowerIdSet(userId, otherIds)` — the batched form; use it for anything rendering a list, a per-row call is an N+1.

Both read the reaction collection live and nothing caches or denormalises the answer, because messaging permission must change on the very next message after a follow or unfollow. `unfollow` publishes no queue event, so there would be nothing to invalidate a cache from.

See `.agents/skills/direct-messaging/SKILL.md`.
