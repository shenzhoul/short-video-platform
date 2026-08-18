---
title: Interaction Notifications
description: Aggregated interaction notifications delivered in realtime to the header panel.
audience: [user, creator, developer-agent]
domain: community
status: active
updated: 2026-08-17
tags: [notification, realtime, socket, reaction, comment, follow, mention]
---

# Interaction Notifications

Authenticated users receive backend-created interaction notifications in the existing header panel. The bell shows one red unread indicator; opening the panel marks the whole inbox read.

## Active notification types

| Type | Trigger | Recipient | Grouping | Opens |
|---|---|---|---|---|
| `post_like` | A post is liked | Post owner | One aggregate per post | Post detail |
| `comment_like` | A comment is liked | Comment author | One aggregate per comment | Containing post |
| `post_comment` | A post receives a comment | Post owner | Individual, then adaptive aggregate | Post detail |
| `comment_reply` | A thread participant receives a reply | Person being answered | Individual, then adaptive aggregate | Containing post |
| `follow` | A creator is followed | Followed creator | One reusable row per follower with cooldown | Actor profile |

Self-interactions are suppressed inside `NotificationService`. Shares update statistics only and do not create interaction notifications because share delivery belongs to messaging.

`post_mention` and `comment_mention` are produced whenever a user is deliberately named with `@`. Both are **unique per recipient and resource** and never aggregate: being named is a direct, high-value interaction, unlike the ambient volume of likes and replies.

**Source of truth.** Mentioned ids are read off the stored post or comment, never re-parsed from text in a listener. `PostCrudService.resolveMentionedUserIds` and `CommentService.resolveMentionedUserIds` reduce client-supplied ids to accounts that exist, dropping unknown ones rather than throwing, so what is notified always matches what was stored. Malformed ids are rejected at the payload with a `400`.

**Rules.** Naming someone several times in one post or comment notifies them once; mentioning yourself notifies nobody; and only a successfully created post or comment can notify, because both listeners fire on `EVENT.CREATED`.

**Post mentions fire on publish only.** A post becomes visible the moment it is created — drafts live in the browser, never as documents — so `NotificationPostMentionListener` handles `EVENT.CREATED` and ignores `EVENT.UPDATED`. Editing a post therefore notifies nobody, which is deliberate: `createOnce` means an edit can never resurface a mention the recipient has already read.

**Comment mentions** carry both `postId` and `commentId`, and open the containing post like every other comment-scoped notification.

## Creation and delivery

```text
Committed domain event
  -> isolated notification queue listener
  -> NotificationService policy method
  -> notifications collection
  -> notification delivery topic
  -> recipient-only Socket.IO event
  -> NotificationProvider
```

Listeners adapt queue payloads only. Business rules live in `NotificationService`:

- `aggregate` folds post/comment likes into one row and uses the reaction id for retry idempotency.
- `recordAdaptive` keeps early comments/replies individual and starts an aggregate at `NOTIFICATION_POLICY.COMMENT_AGGREGATION_THRESHOLD`.
- `resurface` reuses follow rows after `FOLLOW_COOLDOWN_MS`.
- `createOnce` is used for one-off types: both mention types, and individual comment/reply rows.
- `replaceAggregateActor` replaces or removes the displayed like actor after an unlike without resurfacing the row.

Creation and socket delivery use separate queue subscribers. Retrying delivery never repeats creation or resets read state.

## Stored and response data

The schema stores references and aggregation state, not rendered text:

- ownership and identity: `recipientId`, `actorId`, `type`, `groupKey`;
- targets: `postId`, `commentId`, `aggregateResourceId`;
- aggregation: `isAggregate`, `activityCount`, `lastEventId`;
- inbox state: `read`, `readAt`, `lastActivityAt`, timestamps.

`NotificationDto` is the API/socket privacy boundary. `resolveMany` attaches a trimmed actor, post thumbnail, follow state, and computed `actorCount` with batched lookups. The DTO must expose `isAggregate`, `activityCount`, and `actorCount`; otherwise the resolver and DTO contract are inconsistent.

Important indexes:

- `{ recipientId, lastActivityAt: -1, _id: -1 }` for panel pagination;
- `{ recipientId, type, lastActivityAt: -1, _id: -1 }` for category pagination;
- `{ recipientId, read }` for the bell count;
- `{ recipientId, groupKey }` unique for policy-specific identity;
- `{ recipientId, type, aggregateResourceId, isAggregate }` for adaptive thresholds.

The schema is the source of truth for collection/index creation; no data migration is required for this behavior.

## API

All routes require authentication and derive the recipient from the session.

### `GET /notifications`

Supports `limit`, `offset`, `cursor`, `lastCreatedAt`, optional raw `type`, and optional panel `category`.

Panel categories are server-backed so pagination remains correct:

| Category | Persisted types |
|---|---|
| `followers` | `follow` |
| `mentions` | `post_mention`, `comment_mention` |
| `comments` | `post_comment`, `comment_reply` |
| `likes` | `post_like`, `comment_like` |

When both are present, `category` takes precedence over raw `type`.

### `GET /notifications/unread-count`

Returns `{ total: number }` for the header indicator.

### `PUT /notifications/read-all`

Marks every unread row for the caller read and returns `{ updated: number }`.

There is deliberately no single-notification read endpoint. Row activation only navigates; read state is an inbox-level side effect of opening the panel.

### `DELETE /notifications/:id`

Removes one row from the caller's own inbox and returns `{ deleted: true }`.

Deletion is scoped by `recipientId` **inside the delete filter**, so a request for a
notification belonging to somebody else matches nothing and answers `404` — the same
answer as an id that never existed, which is what keeps it from confirming that another
user's notification exists. Repeating a delete is therefore also a `404`, and the client
treats that as success rather than an error.

Deleting is local to the reader's inbox: it removes their copy of the row and does not
touch the interaction it described, the actor, or any other recipient's notification.

## Frontend behavior

- `NotificationProvider` owns the single `notification:created` subscription above the panel so the bell remains live while closed.
- Opening the panel starts read-all and the first list request together. A racing page response waits for read-all before it is committed, preventing stale unread state without a network waterfall.
- React Strict Mode effect replays share one in-flight read-all request.
- Filter changes reset cursor state, discard superseded responses, and fetch the category from the API.
- Realtime rows are inserted only when they belong to the active category.
- Rows navigate to actor profiles or `/?modal_id=<postId>` and never issue a read mutation.
- Each row carries a `…` menu with **Delete notification**. The row disappears immediately, its unread count is released, and the id is remembered briefly so a realtime update still in flight cannot resurrect it. A failed delete leaves the row exactly as it was.

### UI contract

`NotificationBell`, the panel shell, list, and row retain their established CSS. Behavior changes must not restyle those surfaces. The filter alone follows the Douyin compact pattern: the current category is shown at the right side of the existing header and opens a narrow floating vertical menu with All messages, Followers, Mentions, Comments, and Likes. It uses the shared `Dropdown` primitive, including the same centralized open motion as the header avatar menu; the panel does not implement its own dropdown behavior or animation. Shared motion animates `transform: translateY(...)` so Tailwind 4 can retain the horizontal `translate` used to center the panel.

## Security and reliability

- Every list/count/read-all query is scoped by `recipientId` inside the database filter.
- Realtime payloads go only to the recipient's socket ids.
- Deleting a notification is authorized by the query itself: `recipientId` is part of the delete filter, so guessing an id cannot remove another user's row.
- Reply recipients are validated against stored thread participation before a client-supplied `replyToUserId` is honored.
- Queue handlers swallow and log notification failures after the originating interaction commits.
- Batched resolution avoids per-row user, post, comment, or follow queries.
- De-duplicated queue events converge through `groupKey` and `lastEventId`.

## Current limitations

- The comment composer has no `@` autocomplete dropdown yet. Mentions in comments are resolved from the submitted text with the shared `resolveMentionedUserIds` helper — the same rule the post edit flow uses, where the final text is the source of truth — so typing `@handle` works and deleting it before posting removes the mention. Adding the dropdown means swapping the comment textarea for `ComposerTextarea`; the payload, schema, validation and listener are already in place and need no change.
- Editing a post does not notify newly added mentions.
- Comment/reply rows open the containing post because there is no per-comment route.
- There is no standalone notification page, mute setting, or notification preference surface.

## Verification

```bash
cd api  && yarn test && yarn build
cd user && yarn lint && yarn build
```

With two accounts, verify post likes, comment likes, comments, replies, and follows; confirm the bell updates live, opening the panel read-alls once, each category remains type-pure during realtime delivery, share creates no interaction notification, and row navigation sends no read request.
