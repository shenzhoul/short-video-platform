---
name: direct-messaging
description: Private one-to-one messaging for Douyin Clone — follow-based send permission, the atomic message-request claim and acceptance, unread state, realtime delivery, and the right-side workspace with container-query page reflow across api/ and user/.
---

# Direct Messaging

One-to-one private messages. Read `docs/features/messaging.md` first for the product rules; this file is the implementation-level detail that is easy to get wrong.

## When to Apply

- Changing who may send a message, or when
- Touching conversation, message or participant schemas, DTOs or indexes
- Adding a message surface, or changing the right-side workspace
- Changing anything that reads `--message-workspace-width`
- Adding realtime message events or unread counters
- Changing the feed or search grids (they are container-queried *because* of this feature)

---

## 1. Permission is decided per send, in a fixed order

`MessagePermissionService.claimSendSlot` is the only place that decides. Never
check permission at conversation creation and cache the answer.

The order is not negotiable, and every branch depends on it:

```text
blocked?  ->  restricted?  ->  accepted?  ->  mutual follow?  ->  nobody waiting?  ->  refuse
```

Two separate ideas live in there.

**Flags** (`block`, `restrict`) are what a person controls about their own inbox.
They sit above everything. A mutual follow does not lift a restriction, and the
restricter *replying* does not readmit the restricted person — only an explicit
unrestrict does. Get this wrong and the control undoes itself the first time
somebody is polite.

**Consent** is the message request. Mutual followers are free; otherwise the
initiator sends one message and waits, and the recipient **replying** accepts it.
Reading does not accept.

### Acceptance is durable — do not tie it to follows

An accepted conversation stays open after an unfollow. This was the other way
round once, and it was wrong twice over: unexplainable (an unrelated unfollow
put two people mid-conversation back under the one-message rule), and
inconsistent (a pair who never followed each other had no follow to lose, so the
rule only ever restrained people who *had* followed).

`requestAccepted` is durable, and it is **recorded whenever both sides have
spoken — including while they were mutual followers**. The mutual branch is not
a shortcut past consent: if `lastSenderId` is somebody else, this send is a
reply, and the flag is set. Skipping that left long-running conversations
dropping back to a fresh request on the first unfollow, and made the live rule
disagree with the migration backfill, which reads the same evidence.

A pair with one-way traffic only never had it set, so losing the follow
correctly leaves them at `idle`. That falls out of the ordering — no listener,
no reset, no event.

There is **no** `MessageFollowListener`. If you find yourself adding one, you
are re-introducing the bug.

### Never do these

```ts
conversation.isMutualFollow        // stale the moment someone unfollows
messages.length > 1                // breaks on deletes, pagination, media retries
conversation.totalMessages === 1   // same, plus breaks on pre-existing history
```

And never make acceptance alternate — a reply frees **both** sides.

### The three-step claim

Flags are read first: a block is a wall, not a slot. Then accept ->
already-accepted -> mutual -> send-request, each a conditional single-document
update, so concurrency is safe without a transaction. Six simultaneous first
messages: one wins. Two simultaneous replies: both allowed, one performs the
acceptance. One bounded retry handles both participants opening at once.

Note `mutual` is checked **after** `accepted`, so an already-accepted thread
keeps reporting `accepted` — that is the state that has to survive a later
unfollow.

### Claim ordering

Validate attachments and shared-post availability -> claim -> insert -> update
previews and counters.

- Validation goes **before** the claim, so a rejected file or an unshareable post
  never costs the sender their request message.
- The claim goes **before** the insert, or two concurrent sends both write.

A failed insert calls `releaseSendSlot` with the whole claim, which undoes the
specific transition it made, guarded on the state that claim produced.

### Block and restrict live in their own collection

`user_relationships`, not `reactions` beside follows. A block must never be
discoverable by the person it is set on; putting it where reaction listings are
queried makes that a matter of remembering to filter it everywhere.

One row per `(userId, targetId, type)` behind a **unique** index, and the service
catches `11000` so a concurrent double-click reads as success rather than a 500.
`clear` uses `deleteMany`, because a database that predates the index can hold
duplicates and removing one per click leaves the user blocked.

Only the viewer's own direction is ever exposed (`blockedByMe`,
`restrictedByMe`). There is no API that reports somebody else restricted you —
a restriction is only useful while unconfirmed, which is also why the refusal
text for blocked and restricted is identical. Distinct codes, same words.

## 2. Follow state is never duplicated

`FollowService.areMutuallyFollowing` / `getMutualFollowerIdSet` read the `reactions` collection live. Follows are reactions (`action: FOLLOW`, `objectType: CREATOR`), and both `$or` branches are full-prefix matches on the existing unique reaction index — no new index is needed and none should be added.

Use the batched `getMutualFollowerIdSet` for anything rendering a list. A per-row `areMutuallyFollowing` is an N+1.

Note `FollowService.unfollow` publishes **no** queue event. Nothing can invalidate a cached follow state, which is another reason not to cache one.

## 3. Unread is server-authoritative, always

`conversation_participants` holds one row per `(conversationId, userId)`. The unique index is a correctness constraint: without it concurrent increments split one person's count across two documents.

The client must **never** compute unread from message payloads. It applies:

- `message:unread-updated` — absolute totals, replace not adjust
- `conversation:updated` — the row wholesale, including its own `unreadCount`
- `message:read` — clears the named conversations, `null` meaning all

Two totals exist and mean different things: `totalUnreadMessages` (messages waiting) and `totalUnreadConversations` (people waiting). The dot is `totalUnreadMessages > 0`. Do not collapse the backend model because the UI shows a dot.

**Opening the workspace marks nothing read. Opening a conversation does.**

## 4. Realtime: one subscriber, dedupe on server `_id`

`MessageProvider` is the only subscriber to message socket events, mounted at the shell. Threads register through `subscribeToMessages`, not their own `useSocketListener` — otherwise handler count grows with open surfaces.

Delivery is a **separate queue subscriber** from creation (`MessageDeliveryListener`), mirroring `NotificationDeliveryListener`. A retried emit must never re-run creation.

The sender receives their own message back. De-duplication is by server `_id` in a bounded seen-set, which covers the API/socket echo, a queue redelivery, and two surfaces at once with one check.

Re-derive totals on socket reconnect. A dropped connection misses deliveries outright.

## 5. Layout: one CSS variable, and container queries

Two tokens, in `globals.css`:

```css
--app-header-height: 3.5rem        /* where the panel starts */
--message-workspace-width: 360px   /* 0px when closed OR when overlaying */
```

The panel's anchor depends on `placement` on `MessageWorkspaceProvider`: below the header on an ordinary page, and at the very top beside a surface that already covers the header (post detail), which claims it via `claimFullscreenPlacement()`. Never infer this from the DOM - the surface knows what it is.

The header spans the full width and must **not** subtract the workspace width - it is anchored `right-0`, so subtracting moved its *left* edge inward and let the panel cover the header actions. Its z-index follows the same placement: above the panel on a page, so the header's own popovers (search suggestions, notifications) are not clipped - the header is a stacking context, so they cannot be lifted out of it individually - and below a fullscreen surface. Consumers:

- `layout/main-page.tsx` — both tokens
- `layout/app-header.tsx` — height only
- `message/message-workspace.tsx` — height + width
- `content/post/post-detail-modal.tsx` — width only, **both** branches (graphic and video)

### The trap

**Tailwind `sm:` / `xl:` are viewport media queries.** Narrowing the content column does not change the viewport, so a grid built on them keeps its column count and squashes the cards instead of rewrapping. Any grid that must respond to the workspace has to use container queries (`@container` + `@min-[…]:`).

`@container` must be on an **ancestor** of the queried element, not the element itself.

Current container-queried grids and their calibration:

| File | Columns |
|---|---|
| `content/post/home-feed.tsx` | 1 / 2 / 3 / 5 at `42rem` / `64rem` / `88rem` |
| `search/search-results.tsx` | 2 / 3 / 5 at `48rem` / `88rem` |

Thresholds come from the shell, not the default scale: content column = viewport − 160px nav, workspace takes a further 360px. `88rem` sits between 1920-closed (110rem) and 1920-open (87.5rem), which is what produces the 5 → 3 collapse. If you change the workspace width or the nav width, **recompute these**.

Never write `messageOpen ? 3 : 5`.

Below 1280px the panel overlays and publishes `0px` — there is no width left to take, and subtracting anyway yields a broken column.

## 5a. The notice reads `requestState`, and the composer is never replaced

Two mistakes worth not repeating.

**Do not key the restriction notice on the follow relation.** `!isMutualFollow` is true for an accepted request too, so the notice never went away. Only `idle` and `waiting` are restricted:

```ts
// blocked and restricted say the same thing; idle and waiting explain the rule;
// mutual, accepted and null say nothing at all.
```

The composer keys on `canSend` **alone**. An unanswered request, a block and a
restriction all arrive as `canSend: false` with different `awaitingReplyFrom`
values, and keying the disabled state on who was waiting left the input live for
exactly the two flag cases.

`requestState` has to be plumbed the whole way for this to clear live: the send response carries it (that is how the replier learns their reply accepted the request), the `conversation:updated` socket payload carries it (that is how the other side learns), and `useMessageThread` prefers the local send result until a socket update supersedes it — so the state it reports has to include `requestState` in *both* branches and in the effect that drops the local snapshot.

**Do not swap the composer out for a message.** A blocked state that returns different JSX gave the panel two notices — one above the history, one where the composer used to be — and moved the bottom edge of the panel. Keep the one surface and disable the controls inside it; the notice above it explains why.

The composer surface is `flex` with `min-w-0 flex-1` on the text area and one `shrink-0` action group. A textarea's automatic minimum size is 0 (its UA `overflow` is not `visible`), so it does shrink — but the explicit `min-w-0` is cheap and states the intent.

## 5b. Entry points are not interchangeable

All three drive the one `MessageWorkspaceProvider`, but they mean different things:

| Entry point | Call | Why |
|---|---|---|
| Header icon | `toggleWorkspace()` | names no conversation |
| Header icon on `/messages` | nothing | the page already is the full surface; guard with `isMessagesRoute(usePathname())` |
| Creator profile | `openConversationWith(id)` then `openWorkspace(conversationId)` | knows *who*, so it opens that thread directly |
| Post detail | `toggleWorkspace()` | names no conversation; the button stays visible and toggles |

Never give an entry point its own `messageOpen` state.

`MESSAGES_ROUTE` and `isMessagesRoute` live in the workspace provider — use them rather than comparing pathname strings, so `/messages-archive` is not mistaken for the messages page.

**Post detail button placement.** Its `right` must include the comments panel width when that panel is open (`VIDEO_DETAIL_PANEL_WIDTH`), exactly as the action rail does. Positioned from the overlay's right edge alone it lands underneath the panel — panel `z-70`, button `z-50` — and vanishes whenever comments are open.

## 6. Route placement

`/messages` lives in `app/(private)/(app)/`, which uses the Home shell. `app/(private)/(creator)/` is creator management and uses the creator sidebar. Route groups are not URL segments, so this split changed no URLs. An authenticated page that is not creator management goes in `(app)`.

## 6a. Shared posts

`MESSAGE_TYPES.POST` carries a `postId` and nothing else. The card is resolved by
`SharedPostService` on **every read**, per reader — never snapshotted onto the
message.

That is not an optimisation trade-off, it is the takedown story: a copy on the
message would keep serving a deleted or hidden post from a place nobody looks
when handling a report. Availability differs per reader too, since the author
may have blocked one participant and not the other.

The unavailable card is a *different shape*, not the full one with a flag —
carrying the caption and cover alongside `available: false` is how a withdrawn
post leaks. The conversation preview shows `[Post]` for the same reason: the
caption must not survive in the list.

Sharing is orchestrated by `PostShareService`, deliberately outside both domains
— the message domain should not know shares are stored as reactions, and the
reaction domain should not know messages exist. See
`.agents/skills/post-sharing/SKILL.md`.

## 6b. System notices are not messages

`MESSAGE_TYPES.SYSTEM` with `systemEvent` and **`senderId: null`**. Never borrow
a participant as the sender — `lastSenderId` feeds the reply detection in
`claimSendSlot`, so a fake sender there accepts a request nobody answered.

`MessageSystemNoticeService` writes the row directly and deliberately skips
`MessageService.send`: going through the normal path would spend a message
request, look like a reply, and set `lastSenderId`. It calls
`applySystemNotice` (preview and ordering, no `lastSenderId`) and
`touchActivity` (activity time, no unread) instead of the usual pair.

### One notice per conversation, for its whole lifetime

De-duplication is a `systemEventKey` scoped to the **conversation**:
`mutual_follow:<conversationId>`, behind `uniq_systemEventKey`.

It was previously built from the two follow rows, and that identity was wrong.
Unfollowing deletes a row, so following again produced new ids, a new key, and a
second notice — most visibly in "restricted → re-followed → unrestricted", which
left two identical notices in one thread. A conversation is already the unordered
identity of a pair (A/B and B/A resolve to the same row), so it survives follow
churn and needs no sorting.

The service also queries the thread directly for an existing
`{ type: 'system', systemEvent: 'mutual_follow' }` before inserting. That is not
redundant with the index: rows written under the old per-follow key would not
collide with the new one, so without the query an old conversation would be
announced a second time. The index remains what makes concurrent writers safe.

A no-op because the thread was already told is **complete**: no preview, no
activity bump, no unread, no socket event. Lifting a restriction must not
resurface a conversation.

Repair for existing data: `api/scripts/dedupe-mutual-follow-notices.js` (dry-run
by default) keeps the oldest notice per conversation, deletes the rest, rewrites
the survivor's key to the stable form, and repoints any conversation preview that
referenced a deleted row — using that message's own timestamp, so repairing data
never reorders anybody's inbox.

Wording is never stored — the row carries the event and `resolveSystemNoticeText`
resolves it per reader. The realtime payload has to carry the resolved text
explicitly, or the notice arrives blank and renders as nothing until a refetch.

### The message shape contract

A message is either authored or a system notice, and the two shapes must not
blur. `MessageSchema.pre('validate')` enforces it at the single point every write
goes through:

| | `senderId` | `systemEvent` / `systemEventKey` |
|---|---|---|
| authored (text, image, shared post) | **required** | **field absent entirely** |
| system notice | forced to `null` | required, key non-empty |

Ordinary messages have the system fields *removed* rather than rejected — a stray
one is an internal slip, and refusing the write would turn it into "you cannot
send messages". The notice branch does throw, because a notice without a key
cannot be de-duplicated and a notice with a sender accepts a request nobody
answered.

**Absent is not the same as `null`, and that distinction caused an outage.**
`systemEventKey` was declared `default: null`, so Mongoose persisted the field on
every message; `uniq_systemEventKey` was `unique + sparse`, and a sparse index
skips *missing* fields but still indexes an explicit `null`. The first ordinary
message claimed `{ systemEventKey: null }` and every later one failed with
`E11000 … dup key: { systemEventKey: null }` — every conversation broke on its
second message.

Two independent guards now, deliberately: the field carries **no default**, and
the index is **partial** (`partialFilterExpression: { systemEventKey: { $type:
'string' } }`), not sparse. Never combine `sparse` with a partial filter, and
never give an indexed optional field a `null` default.

Only a collision on `systemEventKey` may be swallowed as an idempotent no-op, and
only in `MessageSystemNoticeService` — check `error.keyPattern.systemEventKey`,
never a bare `error.code === 11000`. Treating any duplicate key as success
reports a notice that was never written.

Repair script for an existing database: `api/scripts/repair-message-system-event-keys.js`
(dry-run by default; `$unset`s the stray fields and swaps the index).

## 7. Media

Upload first, create the message second. A message row pointing at an incomplete upload renders as a permanently broken bubble.

Message upload endpoints are separate from post ones on purpose: post endpoints gate on creator document verification (wrong for a private message) and generate blur placeholders (useless here).

Derive the stored `type` from the uploaded file, not from the request body — the client sends what it thinks it picked.

## Key files

```text
api/src/schemas/community/message/                       conversation, participant, message
api/src/schemas/community/relationship/                  block / restrict rows
api/src/services/community/message/
  message-permission.service.ts                          THE permission gate
  conversation.service.ts                                hashKey dedupe, list
  conversation-participant.service.ts                    unread
  message.service.ts                                     send, history, read orchestration
  shared-post.service.ts                                 per-reader shared post cards
api/src/services/community/relationship/                 block / restrict store
api/src/services/community/share/post-share.service.ts   share orchestration
api/src/common/exceptions/message/                       typed refusal codes
api/src/listeners/community/message/                     socket delivery
api/src/controllers/community/message/
api/src/controllers/community/relationship/
api/migrations/1787000000000-message-indexes.js
api/migrations/1787600000000-message-consent-and-relationships.js

user/src/providers/message.provider.tsx                  domain state, single socket subscriber
user/src/providers/message-workspace.provider.tsx        open/closed + layout variable
user/src/hooks/use-message-thread.ts                     one conversation
user/src/components/message/
  shared-post-card.tsx                                   the card in a bubble
  message-thread-actions.tsx                             block / restrict menu
user/src/hooks/use-open-shared-post.ts                   opens the app's own post detail
```

## Verification

```bash
cd api  && yarn test src/services/community/message && yarn test src/services/community/follow && yarn build
cd user && yarn test src/providers/message src/hooks/use-message-thread && yarn lint && yarn build
```

For layout work, a build is not enough — check 1280/1440/1600/1920 with the workspace open and closed, on the feed, on search, and over post detail.
