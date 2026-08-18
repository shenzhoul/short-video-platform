---
title: Post Sharing
description: The in-app share panel, the recorded share reaction, and the totalShare statistic.
audience: [user, creator, developer-agent]
domain: community
status: active
updated: 2026-08-13
tags: [share, reaction, post, statistics, notification]
---

# Post Sharing

Sharing a post opens the application's own share panel. Completing a share copies a link, records the share server-side, and moves the post's share counter. It does not create an interaction notification; share delivery belongs to messaging.

## Share panel

`user/src/components/interactions/share-panel.tsx`, opened by `ShareButton` and by the post detail action rail.

Built on the shared `Modal` primitive rather than a bespoke popover, so it cannot be clipped by the post detail overlay it is usually opened from, and so the backdrop, escape-to-close and focus handling come from one place.

Contents:

- a search field;
- the people the viewer follows, from `useFollowList({ type: 'following' })` — the same hook the profile follow lists use, with its search, paging and `enabled` gating reused as-is;
- a **Copy link** action;
- **More**, the platform share sheet, offered only when `navigator.share` exists.

### Sending to a person is deliberately inert

There is no messaging backend. The per-person **Share** button is therefore rendered disabled with an explanatory title rather than being hidden, so the row shape is right for when direct messages arrive, and no interaction can claim a message was delivered. No message record is created, and pressing it records nothing.

## What counts as a share

Only a completed share is recorded:

| Action | Recorded? |
|---|---|
| Opening the panel | No |
| Typing in the search field | No |
| Pressing the disabled per-person Share | No |
| **Copy link succeeds** | **Yes** |
| **Native share resolves** | **Yes** |
| Native share cancelled or rejected | No |

The record request is fire-and-forget: the share already happened on the client, so a failure to report it must never surface an error or undo the copy.

## Recording and the counter

`POST /social/:contentType/:contentId/share` → `CommunicationService.recordShare` → `ReactionService.create({ action: 'share' })`.

The endpoint responds `{ recorded: true, created: boolean }`. `created` reports whether this call added a **new** distinct sharer, which is what lets the client move its counter in step with the stored statistic. `ReactionService.create` returns `{ reaction, created }` for the same reason — callers must be able to tell a first reaction from a repeat without re-deriving the idempotency rule.

Shares are stored in the existing generic `reactions` collection as `objectType: 'post'`, `action: 'share'`, which is covered by the unique `(objectType, objectId, action, createdBy)` index. `ReactionService.create` is idempotent: an existing row is returned untouched and **no event is published**. There is no un-share.

### `totalShare` semantics

`totalShare` is the **number of distinct users who have shared the post**, not the number of share actions.

| Event | Reaction | `totalShare` | Notification |
|---|---|---|---|
| B shares post A the first time | created | +1 | none |
| B shares post A again | reused, no event | unchanged | none |
| C shares post A | created | +1 | none |

The counter is driven by the reaction's `CREATED` publish, which only fires for a genuinely new row. The notification listener deliberately ignores share actions.

Storage follows the `totalLike` pattern — a persisted field on the post updated by a queue listener:

- `Post.totalShare` in `api/src/schemas/content/post.schema.ts`
- exposed by `PostDto.totalShare`
- incremented by `PostStatisticsService.handleShareStat`, called from `ReactionAssetsListener`

Because the counter is only ever incremented, `handleShareStat` is always called with `+1`; the `$max` against 0 exists solely to protect documents written before the field existed.

`ReactionAssetsListener` filters on the action as well as the target. A post now carries more than one reaction action, so treating "a post reaction" as "a like" would make shares move the like counters.

### Client-side counter

The listener updates the stored counter asynchronously, so re-reading the post immediately after sharing still returns the old number. The client therefore advances the value already on screen through the existing post-interaction patch (`usePostInteractionState.handleShared` → `PostInteractionPatch.totalShare`), the same mechanism likes and comments use.

It advances **only when the response reports `created: true`**. Because `totalShare` counts distinct users, a repeat share by the same person must leave the number alone; deciding that on the client from a remembered "already shared" flag would duplicate a rule the backend owns, so the response is treated as authoritative.

## Where the count is shown

- **Post detail action rail** — `PostVideoActionRail`, from the interaction state so it moves as soon as a share completes.
- **Creator posts** (`/creator/posts`) — a real metric in `CreatorPostRow`. It was previously a hard-coded `0` in `creator-manage-placeholders.ts`; that entry has been removed from both placeholder sets.

## Verification

```bash
cd api  && yarn test && yarn build
cd user && yarn lint && yarn build
```

Then: open the panel and confirm the counter does not move; copy the link and confirm it increases by one and the owner is notified; copy again as the same user and confirm neither changes; share as a second user and confirm both increase again.
