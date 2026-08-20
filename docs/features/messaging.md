---
title: Direct Messaging
description: Private one-to-one messages with follow-based send permission, delivered in realtime to a right-side workspace, a post-detail entry point and a dedicated page.
audience: [user, creator, developer-agent]
domain: community
status: active
updated: 2026-08-19
tags: [message, conversation, realtime, socket, follow, permission, unread, media]
---

# Direct Messaging

Authenticated users exchange private one-to-one messages. Who may send, and how often, is decided by the **current** follow relationship between the two people — never by history and never by the client.

Three surfaces show the same conversations, the same messages and the same unread state:

| Surface | Opened from | Shape |
|---|---|---|
| Right-side workspace | Header message icon | 360px column beside the page, below the header |
| Right-side workspace | Post detail message button | The same column, beside the open post |
| Right-side workspace | A creator profile's **Message** button | The same column, opened straight into that creator's thread |
| `/messages` | Workspace header link, or directly | Two-column page |

There is one workspace instance for the whole application. Every entry point calls into the same `MessageWorkspaceProvider`, so a second click never mounts a second panel.

### Entry points

They share the workspace but not their behaviour, because they mean different things:

| Entry point | Behaviour |
|---|---|
| Header icon, ordinary page | Toggles the panel open and shut, on the conversation list |
| Header icon, on `/messages` | Does nothing — that page already *is* the full messages surface, so opening the panel beside it would show the same conversations twice and needlessly narrow the page. The unread indicator still renders, because it reflects global state |
| Creator profile **Message** | Resolves the canonical conversation with that creator, then opens the workspace directly into that thread. Never shown on your own profile |
| Post detail **Messages** | Toggles the panel. It names no conversation, so it simply shows and hides; it stays visible and usable while the panel is open |

The panel is anchored by *placement*: beside an ordinary page it starts below the application header, which keeps its full width and stays visible. Beside a surface that already covers the header - post detail - it runs from the very top, because otherwise the header would show through in the strip next to it. Post detail declares that placement while it is mounted; the panel never guesses from the DOM.

Closing the workspace returns it to the conversation list. The header icon means "show me my messages", not "resume that one conversation" — only entry points that name a conversation open a thread.

## Messaging permission

Permission has two levels.

**Mutual followers** - A follows B *and* B follows A - message each other freely.

**Everyone else** goes through a **message request**. The initiator may send one message and then waits. The recipient **replying** accepts the request, and from then on *both* may message freely. Reading it does not accept it - looking at a request is not agreeing to it.

```text
SEND MESSAGE
     |
     v
Currently mutual followers? ----YES----> SEND (request flow does not apply)
     |
     NO
     |
     v
Request already accepted? ------YES----> SEND (both sides free)
     |
     NO
     |
     v
Is anyone waiting?
     |
 +---+--------------------+
 |                        |
NOBODY              SOMEONE IS
 |                        |
 v                        v
SEND the request     Is it me?
 |                    |        |
 v                   YES       NO
sender waits          |         |
                    BLOCK    SEND -> request ACCEPTED
                                     both sides free
```

The waiting state belongs to a **sender**, not to the conversation: the person who received a request must always be able to answer it.

### After acceptance

```text
A -> B      request sent, A waits
A -> B      blocked
B -> A      allowed; request ACCEPTED
A -> B      allowed
A -> B      allowed        <- no turn-taking
B -> A      allowed
B -> A      allowed
```

There is no alternating one-message-each rule once the request is answered.

### Relationship changes

Permission is re-evaluated on every send from the live follow relation.

```text
MUTUAL                              NON-MUTUAL, ACCEPTED
  |                                     |
  | one side unfollows                  | they follow each other
  v                                     v
RESTRICTED, no request pending        MUTUAL
  |                                     |
  v                                     v
next sender gets one request       unrestricted; any pending
message; a reply accepts again     request state is cleared
```

- **Mutual to non-mutual.** History is preserved; only permission changes. Acceptance is **reset**, so freedom that came from a follow does not outlive it. The next sender gets one request message, and a reply accepts it again.
- **Non-mutual to mutual while waiting.** The waiting sender is released immediately.
- Reading never accepts a request. Only a reply does.

### How it is stored

Two fields on the conversation:

```ts
Conversation.pendingSenderId: ObjectId | null  // who sent the unanswered request
Conversation.requestAccepted: boolean          // has it been answered?
```

Which gives four states:

| State | Meaning |
|---|---|
| `mutual` | derived from the live follow relation; overrides everything below |
| `idle` | non-mutual, unanswered, nobody waiting - one request may be sent |
| `waiting` | the initiator has spent their one message |
| `accepted` | the request was answered; both sides free |

`requestState` is exposed on the conversation payload so both clients can tell "free because we follow each other" from "free because the request was answered" - they look the same to a composer but behave differently the moment a follow changes.

Specifically **not** stored: a persisted `isMutualFollow` (follow state is read live, so it can never go stale), and no message count - `messages.length > 1` and `totalMessages === 1` both break on deleted messages, paginated history, media retries, and history from a period when the pair was mutual.

`requestAccepted` is not an "unlocked forever" flag precisely because of the reset below.

### The unfollow reset

`FollowService.unfollow` publishes a `deleted` follow event on the reaction channel. `MessageFollowListener` picks it up and resets that pair's conversation to `idle` - `requestAccepted: false`, `pendingSenderId: null`.

Driven by an event rather than called directly: the message domain already depends on the follow domain, so the reverse call would be a cycle. The conversation is located by its canonical `hashKey`, so an unrelated unfollow cannot disturb anyone else, and no message is ever deleted.

### Concurrency

`MessagePermissionService.claimSendSlot` performs up to three conditional single-document updates, tried in order - accept, already-accepted, send-the-request. Each is atomic on its own, which is what makes concurrent sends safe without a transaction:

```js
// 1. the other participant is waiting: this send answers, and accepts
findOneAndUpdate(
  { _id, requestAccepted: { $ne: true }, pendingSenderId: { $nin: [null, sender] } },
  { $set: { requestAccepted: true, pendingSenderId: null } }
)

// 3. nobody waiting: send the one request message
findOneAndUpdate(
  { _id, requestAccepted: { $ne: true }, pendingSenderId: null },
  { $set: { pendingSenderId: sender } }
)
```

Six simultaneous first messages: only one can match step 3, because the first match writes `pendingSenderId`. Two simultaneous replies: both are allowed - after acceptance everyone is free - but only one performs the acceptance transition. After acceptance, any number of concurrent sends pass through step 2 without contention.

A single bounded retry covers one narrow race: both participants send a first message at the same instant, one wins step 3, and the loser is then treated as answering rather than refused.

**Claim ordering and compensation.** The claim is taken *before* the insert - inserting first would let two concurrent sends both write a message before either claim resolved. The cost is compensation: `releaseSendSlot` undoes whichever transition the claim made (`request-sent` or `request-accepted`), each guarded on the state that claim produced, so a slow rollback cannot overwrite a newer legitimate transition.

Attachment ownership is validated **before** the claim, so a rejected file never costs the sender their one request message.

## Conversations

One pair of users always resolves to one conversation. Identity is `hashKey` — both ids sorted and joined — so "A opens a chat with B" and "B opens a chat with A" compute the same value.

Creation is an upsert against a unique index on `hashKey`, not a find-then-create: both people can tap *message* at the same moment, both find nothing, and both insert. The unique index decides the winner and the loser's duplicate-key error is resolved by re-reading, never surfaced as a 500.

## Unread state

The backend is the only authority. The client never derives a count from message payloads it happens to receive — a replayed frame would otherwise re-raise a count the reader had already cleared, leaving the badge and the rows disagreeing with no way to reconcile them.

Per-user read state lives in `conversation_participants`, one row per `(conversationId, userId)`.

| Event | Effect |
|---|---|
| Message created | Recipient's `unreadCount` +1; sender's row set to 0 and touched |
| Conversation opened | That conversation's `unreadCount` set to 0, for that reader only |
| Read-all | Every unread row for that reader set to 0 |

Two totals are exposed and they answer different questions:

- `totalUnreadMessages` — how many messages are waiting.
- `totalUnreadConversations` — how many people are waiting.

The header indicator is `totalUnreadMessages > 0`. The backend model is deliberately **not** collapsed to a boolean just because today's UI renders only a dot.

**Opening the workspace marks nothing read.** Only opening a specific conversation does. Seeing that you have mail is not the same as having read it.

Read state is per user and shared across surfaces: reading in the sidebar clears it on `/messages` and in every other tab, because there is one authoritative counter and a `message:read` socket frame carries the outcome to the reader's other sessions.

## Realtime

Delivery uses the application's existing single socket connection. No second connection, no namespace, no conversation rooms.

```text
MessageService.send
  -> MESSAGE_CHANNELS.MESSAGE queue event
  -> MessageDeliveryListener (separate subscriber)
  -> recipient-and-sender-only Socket.IO events
  -> MessageProvider
```

Creation and delivery are separate queue subscribers, exactly as they are for notifications: if emitting fails and the job retries, only the emit repeats. Re-running creation would insert the message twice and re-raise an unread count the recipient may already have cleared.

| Event | Sent to | Payload |
|---|---|---|
| `message:created` | Both participants | The message |
| `conversation:updated` | Each participant separately | That reader's own row: preview, order, unread, permission |
| `message:unread-updated` | The affected reader | Authoritative totals |
| `message:read` | The reader's own sessions | `{ conversationIds }`, `null` meaning all |

**No duplicate bubbles.** The sender receives the echo of their own message so their other tabs and the full page stay in sync. Clients de-duplicate on the server `_id`, which covers three cases with one check: the sender's own echo, a queue redelivery, and the same frame reaching two surfaces.

**No duplicate listeners.** `MessageProvider` is the only subscriber to these events, mounted above every message surface. Opening and closing the workspace, navigating to `/messages`, a reconnect, or a React StrictMode double-invoke cannot register a second handler.

**Reconnect.** Totals are re-derived from the server whenever the socket comes back, because a dropped connection can miss deliveries outright.

There is deliberately **no** "is the recipient currently looking at this thread" presence tracking. Unread is cleared by an explicit read from the client, which is idempotent and survives a dropped socket; inferring it from room membership would make read state depend on connection liveness.

## Right-side workspace and page reflow

The workspace is a **layout column**, not a dropdown and not a modal overlay.

```text
closed   | Left nav | Main content                              |
open     | Left nav | Narrower, reflowed main content | Messages |
```

The panel begins **below** the application header, which keeps its full width and stays completely visible — search, every header action and the avatar remain reachable while messages are open. Two tokens express that:

```css
--app-header-height: 3.5rem     /* where the panel starts */
--message-workspace-width: 360px  /* 0px when closed, or when overlaying */
```

Who reads which:

| File | Reads | Why |
|---|---|---|
| `layout/main-page.tsx` | both | clears the header, and gives up width to the panel |
| `layout/app-header.tsx` | height only | spans the full width; the panel is below it, so there is nothing to make room for |
| `message/message-workspace.tsx` | height + width | anchors itself under the header |
| `content/post/post-detail-modal.tsx` | width only | inset from the right instead of `inset-0` |

Variables rather than props: the consumers are far apart in the tree, and this makes the reflow a CSS transition rather than a React re-render of the whole page.

The header deliberately does **not** shrink. An earlier version subtracted the panel width from it; because the header is anchored `right-0` that moved its *left* edge inward and let the panel cover the header actions outright.

### Why container queries

**This is the part that makes the reflow real.** Tailwind's `sm:` / `xl:` variants are *viewport* media queries. Narrowing the content column does not change the viewport, so a grid built on them keeps its column count and simply squashes the cards.

The feed grids therefore use **container queries**, which measure the scroller instead:

| File | Container | Columns |
|---|---|---|
| `user/src/components/content/post/home-feed.tsx` | `#home-feed-scroll` | 1 / 2 / 3 / 5 at `42rem` / `64rem` / `88rem` |
| `user/src/components/search/search-results.tsx` | wrapper around the grid | 2 / 3 / 5 at `48rem` / `88rem` |

Thresholds are calibrated against the shell rather than taken from the default scale. The content column is the viewport minus the 160px navigation; the workspace removes a further 360px:

| Viewport | Closed | Open | Columns closed → open |
|---|---|---|---|
| 1920 | 110rem | 87.5rem | 5 → 3 |
| 1600 | 90rem | 67.5rem | 5 → 3 |
| 1440 | 80rem | 57.5rem | 3 → 2 |
| 1280 | 70rem | 47.5rem | 3 → 2 |

`88rem` sits between 1920-closed and 1920-open, which is what produces the reference's 5 → 3 collapse. The column count is never hardcoded against "is the workspace open" — it falls out of the width actually available, so the same rewrap happens when the window itself is narrowed.

### Narrow viewports

Below `1280px` there is no width left to give the panel a column, so it becomes an overlay with a scrim and publishes a width of `0px`. Subtracting anyway would leave a broken or negative content column. The switch is watched, not read once, so dragging a window narrow while messages are open converts it to an overlay rather than crushing the page.

### Post detail

Opening messages from post detail keeps the post open and narrows it. The detail overlay is not closed, not replaced, and messages are not layered on top of it. It uses the same variable-inset idiom the file already used for its own detail panel width.

The **Messages** button sits at the top right of the *media* area, and its `right` offset includes the comments panel's width whenever that panel is open. Positioning it from the overlay's right edge alone put it underneath the comments panel — the panel is `z-70`, the button `z-50` — so it disappeared as soon as comments were opened.

## The composer and the restriction notice

One composer, always in the same place. The text area grows, the attachment and send controls sit in a fixed-size group beside it, and both share the one rounded surface. While the sender is waiting for their request to be answered the controls are **disabled in place**, not replaced — swapping them for a sentence produced a second, detached box at the bottom of the panel that repeated the notice already on screen.

The restriction notice sits directly above the composer, because it explains what the composer will accept:

| State | Notice |
|---|---|
| `mutual` | none |
| `accepted` | none — both may write freely |
| `idle` | explains the one-message rule before anything is sent |
| `waiting` | tells the sender they have spent their message |

The notice follows `requestState`, never the follow relation. Those are not the same thing: after a request is answered the two people may still not follow each other, and a notice keyed on "are they mutual followers" stayed on screen forever describing a rule that no longer applied. When the recipient replies, the acceptance reaches the replier in the send response and the original sender over the `conversation:updated` socket event, so the notice clears on both sides without a reload.

## Message content

`text`, `image`, `video`. Nothing else.

Media uploads through the existing file pipeline and the message is created only once the file has an id — a message row pointing at an upload that never completed would render as a permanently broken bubble. The composer shows uploading progress, then a sending state, and a failed send keeps its bubble in a `failed` state with retry and dismiss rather than silently discarding what somebody typed.

The stored type is derived from the uploaded file, not trusted from the request: the client sends what it thinks it picked, and the file server knows what actually arrived.

## API

All routes require authentication and derive the reader from the session. No route accepts a reader or owner id, so no one can read someone else's conversations by passing their id.

| Route | Purpose |
|---|---|
| `GET /conversations` | List, newest activity first. Cursor or offset, optional `q` keyword on the other participant |
| `POST /conversations` | Get-or-create the conversation with one user |
| `GET /conversations/:id` | Detail with live permission |
| `PUT /conversations/:id/read` | Mark one conversation read |
| `GET /messages/conversations/:conversationId` | History, newest first, cursor paginated |
| `POST /messages/conversations/:conversationId` | Send. Returns the message plus the sender's new permission state |
| `GET /messages/unread-count` | `{ totalUnreadMessages, totalUnreadConversations }` |
| `PUT /messages/read-all` | `{ updated }` |
| `POST /content/files/message/photo/upload` | Signed photo upload URL |
| `POST /content/files/message/video/upload` | Signed video upload URL |

A refused send returns `403`. A conversation the caller does not belong to returns `404`, not `403`, so an id cannot be probed for existence.

Message upload endpoints are separate from the post ones on purpose: the post endpoints gate on creator document verification, which is right for published content and wrong for a private message, and they generate blur placeholders, which a direct message has no use for.

The conversation list carries the participant, unread count and permission on every row, so rendering the list issues no follow-up request per conversation. Enrichment is batched — a page costs a fixed handful of queries regardless of its size.

## Data model

**`conversations`** — `recipientIds`, `hashKey`, `pendingSenderId`, `lastMessage`, `lastMessageType`, `lastSenderId`, `lastMessageCreatedAt`.

| Index | Purpose |
|---|---|
| `uniq_hashKey` (unique) | One conversation per pair; the actual race winner |
| `idx_recipientIds_lastMessageCreatedAt_id_desc` | Conversation lookup in activity order |

**`conversation_participants`** — `conversationId`, `userId`, `unreadCount`, `lastMessageAt`, `lastReadAt`.

| Index | Purpose |
|---|---|
| `uniq_conversationId_userId` (unique) | One row per person per conversation; stops concurrent increments splitting a count |
| `idx_userId_lastMessageAt_id_desc` | The conversation list, fully covered |
| `idx_userId_unreadCount` | Unread totals |

**`messages`** — `conversationId`, `type`, `text`, `fileIds`, `senderId`.

| Index | Purpose |
|---|---|
| `idx_conversationId_createdAt_id_desc` | Cursor-paginated history |
| `idx_fileIds` | Attachment lookback |

The `_id` tiebreaker in the history index is load-bearing: two messages can share a millisecond in a chat, and without a deterministic second sort key a page boundary between them would drop or repeat one.

**Follow state is not duplicated anywhere.** `FollowService.areMutuallyFollowing` reads the existing reaction collection live; both `$or` branches are full-prefix matches on the existing unique reaction index, so no new index was needed. `getMutualFollowerIdSet` is the batched form used for a conversation list.

## Migration

`api/migrations/1787000000000-message-indexes.js` creates the three collections and their indexes.

Mongoose declares the same indexes, so a development database with `autoIndex` enabled would get them anyway. The migration exists so a deployment does not *depend* on that: `autoIndex` is commonly disabled in production, and the two unique indexes are correctness constraints rather than optimisations. Building them at migration time also surfaces a failure during deploy rather than at first write.

`requestAccepted` needs no migration of its own: it is a boolean defaulted by the schema, and every query that must treat an existing conversation as unaccepted uses `{ $ne: true }`, which matches a missing field as well as an explicit `false`.

It is purely additive and idempotent — `createIndex` is a no-op for an identical existing index, `createCollection` is guarded, and no data is read, written or removed. Safe on a populated database and safe to re-run. A new database needs nothing beyond it. `down` drops only the indexes and never the collections or the messages in them.

## Roles

- **Guests** see nothing. Every route is authenticated and the workspace renders nothing without a session.
- **Users and creators** are treated identically. There is no subscription, payment or verification gate on messaging — only the follow relationship.
- **Admins** have no message moderation surface. Direct messages are private and no admin UI reads them.
- **Operators** need no configuration. Messaging depends on no third-party service, no API key and no setting; it uses the existing MongoDB, Redis, socket and file-server infrastructure.

## Security

- Every route derives the reader from the session; no request field names a user.
- Conversation membership is part of the database query, not a check afterwards, so a conversation belonging to two other people is indistinguishable from one that does not exist.
- Send permission is decided server-side on every send. The client's `canSend` is advisory and is never trusted.
- Attachment ownership is validated before a message can reference a file.
- Socket payloads are addressed to specific users and never broadcast.
- Malformed ObjectIds are treated as not-found rather than raising a cast error.

## Current limitations

- No group conversations.
- No message deletion or editing, and no typing indicator, read receipts, or reactions.
- No block system, so nothing beyond the follow rule limits who may open a conversation.
- Attachments are one file per message, and a failed media send has to be re-picked rather than retried, because the browser `File` is gone once the composer clears.
- Orphaned uploads from an abandoned send are not garbage collected yet — tracked in `.agents/bug-tracker/rec-api-message-file-gc.md`.
- Unread totals are read straight from MongoDB with no cache layer — tracked, with the trigger for revisiting, in `.agents/bug-tracker/rec-api-message-unread-cache.md`.

## Features not migrated from xfans-v2

The message system in `xfans-v2` was the implementation reference for data flow. Its product rules were not carried over.

| Feature | Category | Why |
|---|---|---|
| Subscription-gated messaging (`canCreateConversation`) | Old business model | Permission here is follow-based. The entire permission layer was rewritten, not adapted |
| Permission checked only at conversation creation | Unsafe | Permission that outlives the relationship it was based on. Now enforced on every send |
| Tips, paid messages, locked media, `private-chat-charging` | Old business model | No monetisation in this product |
| Stream chat, public stream conversations, `clearPublicStreamChat` | Not required | No streaming in this product |
| AI auto-response (`isAI`, `/creator/ai/auto-response/*`) | Not required | Out of scope |
| `ConversationGateway` join/leave room presence | Replaced by current infra | Needed four `SocketUserService` methods this project does not have. Explicit mark-read achieves the same result without tying read state to connection liveness |
| Redis write-behind unread + `sync-conversation-stats.job.ts` | Deferred | Adds a cache/DB divergence window to a counter that must be exact. Indexed writes first |
| Pin, archive, mute conversation | Future scope | Not requested |
| Message deletion + `delete-noref-message-file.job.ts` | Future scope | File GC is real and is tracked as a recommendation |
| Blocking (`CreatorBlockService`) | Replaced by current infra | No block system in this project |
| `audio` and `sticker` message types | Not required | No producer in this product |
| `chat-provider.tsx` (1071 lines) | Duplicate | Violated this project's file-size and composition rules and carried stream chat. Rewritten as a focused provider plus a hook |
| System messages (`isSystem`) | Not required | Nothing produces them |

### Possible future enhancements

Present in `xfans-v2` and plausible here, none implemented: pin/archive/mute, message deletion, typing indicator, per-message read receipts, active-viewing presence, Redis unread coalescing, multi-attachment messages, sharing a post into a conversation.

## Verification

| Check | Command |
|---|---|
| Permission, concurrency, compensation | `cd api && yarn test src/services/community/message` |
| Mutual-follow helpers | `cd api && yarn test src/services/community/follow` |
| API build | `cd api && yarn build` |
| Provider, workspace layout, thread | `cd user && yarn test src/providers/message src/hooks/use-message-thread` |
| Frontend lint and build | `cd user && yarn lint && yarn build` |
