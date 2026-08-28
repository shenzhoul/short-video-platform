---
title: Direct Messaging
description: Private one-to-one messages with request-based consent, block and restrict, shared posts, delivered in realtime to a right-side workspace, a post-detail entry point and a dedicated page.
audience: [user, creator, developer-agent]
domain: community
status: active
updated: 2026-08-28
tags: [message, conversation, realtime, socket, follow, permission, unread, media, block, restrict, share]
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

Permission has two independent layers, and keeping them apart is the point.

**Flags** are what a person controls about their own inbox: `block` and
`restrict`. They sit above everything else.

**Consent** is whether this pair has agreed to talk at all.

```text
blocked?  ->  restricted?  ->  accepted?  ->  mutual follow?  ->  first request?  ->  refuse
```

Evaluated in that order on every send, by the server. Nothing about it is
cached, and the client's copy is advisory.

### Consent

**Mutual followers** — A follows B *and* B follows A — message each other freely.

**Everyone else** goes through a **message request**. The initiator may send one
message and then waits. The recipient **replying** accepts the request, and from
then on *both* may message freely. Reading it does not accept it — looking at a
request is not agreeing to it.

A shared post counts as a message here, so a stranger's share is their one
request.

```text
A -> B      request sent, A waits
A -> B      blocked
B -> A      allowed; request ACCEPTED
A -> B      allowed
A -> B      allowed        <- no turn-taking
```

### Acceptance is durable

An accepted conversation stays open **whether or not the two still follow each
other**. Unfollowing changes what you see in your feed; it does not withdraw an
agreement to talk.

Earlier this worked the other way, and it was wrong in both directions:

- it was impossible to explain — the same two people could talk on Monday and be
  back under the one-message rule on Tuesday because of an unrelated unfollow;
- it was inconsistent — a pair who had never followed each other kept their
  acceptance forever, since there was no follow to lose. So the only people the
  rule ever restrained were people who *had* followed each other.

Consent is recorded **whenever both people have spoken**, including while they
were mutual followers. A reply is a reply; that the follow relation happened to
allow it at the time does not make it less of one. Without this, a pair who had
been talking for months dropped back to the one-message rule the first time
either of them unfollowed — and the live rule disagreed with the migration
backfill, which reads exactly the same evidence.

A pair whose permission came only from a mutual follow, with traffic in one
direction only, is different: nothing was ever accepted there, so losing the
follow leaves an ordinary unanswered conversation and the next sender gets one
request message.

### Stopping someone

Because consent no longer evaporates on unfollow, there are two explicit
controls instead:

| | Direction | Effect |
|---|---|---|
| **Restrict** | one-way | The restricted person can no longer send to you. You can still write to them. |
| **Block** | both ways | Neither may send, whoever set it. |

Both sit **above** consent and above mutual follow. Following each other does not
lift a restriction, and answering a restricted person does not readmit them —
only an explicit Unrestrict or Unblock does. That is deliberate: a control that
undoes itself when you reply is not a control.

Restricted and blocked senders see the *same* message. Telling somebody which of
the two happened would tell them they were singled out, which is precisely what
a quiet control exists to avoid. The API sends distinct codes
(`RECIPIENT_RESTRICTED`, `USER_BLOCKED`) for the client to branch on; only the
display text is shared.

Unfollowing does **not** restrict anyone automatically. `mute` is not
implemented.

### How it is stored

Two fields on the conversation, and one row per flag:

```ts
Conversation.pendingSenderId: ObjectId | null  // who sent the unanswered request
Conversation.requestAccepted: boolean          // has it been answered?

UserRelationship { userId, targetId, type: 'block' | 'restrict' }
```

Which gives the states the API reports as `requestState`:

| State | Meaning |
|---|---|
| `blocked` | one side blocked the other; nothing may be sent |
| `restricted` | the other side restricted this user |
| `accepted` | the request was answered; both sides free, regardless of follows |
| `mutual` | derived live from the follow relation |
| `waiting` | the initiator has spent their one message |
| `idle` | unanswered, nobody waiting — one request may be sent |

One row per `(userId, targetId, type)`, enforced by a **unique** index. Without
it a double-clicked Block writes two rows and a later Unblock removes only one,
leaving somebody blocked with no control left to undo it. Setting a flag is
idempotent — a repeat call is a no-op, and two simultaneous calls resolve to one
row rather than an error. A mutual block is two rows, which is correct: they are
different people's decisions.

Flags live in their own `user_relationships` collection rather than in
`reactions` beside follows. A block must never be discoverable by the person it
is set on, and storing it where reaction listings are queried would make that a
matter of remembering to filter it out everywhere.

Specifically **not** stored: a persisted `isMutualFollow` (follow state is read
live, so it can never go stale), and no message count — `messages.length > 1`
and `totalMessages === 1` both break on deleted messages, paginated history,
media retries, and history from a period when the pair was mutual.

### Concurrency

`MessagePermissionService.claimSendSlot` reads the flags first — a block is a
wall, not a slot to be claimed — then performs up to three conditional
single-document updates, tried in order: accept, already-accepted, send-the-
request. Each is atomic on its own, which is what makes concurrent sends safe
without a transaction:

```js
// 1. the other participant is waiting: this send answers, and accepts
findOneAndUpdate(
  { _id, requestAccepted: { $ne: true }, pendingSenderId: { $nin: [null, sender] } },
  { $set: { requestAccepted: true, pendingSenderId: null } }
)

// 4. nobody waiting: send the one request message
findOneAndUpdate(
  { _id, requestAccepted: { $ne: true }, pendingSenderId: null },
  { $set: { pendingSenderId: sender } }
)
```

Six simultaneous first messages: only one can match the last step, because the
first match writes `pendingSenderId`. Two simultaneous replies: both are allowed
— after acceptance everyone is free — but only one performs the acceptance.

A single bounded retry covers one narrow race: both participants send a first
message at the same instant, one wins, and the loser is then treated as
answering rather than refused.

**Claim ordering and compensation.** The claim is taken *before* the insert —
inserting first would let two concurrent sends both write a message before
either claim resolved. The cost is compensation: `releaseSendSlot` undoes
whichever transition the claim made, each guarded on the state that claim
produced, so a slow rollback cannot overwrite a newer legitimate transition.

Attachment ownership, and a shared post's availability, are validated **before**
the claim, so a rejected file or an unshareable post never costs the sender
their one request message.

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

## System notices

A conversation can hold a notice nobody sent. Today there is exactly one: when
two people start following each other, the thread says

> You follow each other. You can now start chatting.

It appears the moment the relation becomes mutual — not when the first person
follows — arrives over the socket for both sides without a reload, and persists
like any other row in the thread. If the pair have no conversation yet, one is
created for it.

Rendered as a centred grey notice with the other person's avatar, not as a
bubble: it has no side, no sender name and none of a message's actions.

### It is not a message, and consent never counts it

Stored as `type: 'system'` with `systemEvent: 'mutual_follow'` and
**`senderId: null`**. It does not borrow either participant's identity, which
matters more than it looks: `lastSenderId` is what the consent rules read to
decide whether a send is a reply, so a notice attributed to somebody could
accept a message request nobody answered.

Concretely, the notice does **not**:

- spend either person's single message request;
- set `requestAccepted`;
- count as a reply, or as evidence the two have spoken both ways;
- write `lastSenderId` — it stays pointing at the last real message;
- raise an unread badge for either side;
- bypass a block. A blocked pair get no notice at all.

Only user-authored messages ever decide consent.

### Exactly one per conversation (2026-08-21)

A conversation gets **at most one** mutual-follow notice, for its entire
lifetime. Once it has been said, it is not said again:

- unfollowing and following again does not earn a second one;
- neither does a restrict/unrestrict or block/unblock cycle;
- neither do reloads, socket reconnects, retries or a double-clicked button.

The earlier notice stays as history. Blocking or restricting later does not
remove or hide it.

This replaces the original per-follow rule, which keyed the notice on the two
follow records. Deleting a follow and re-creating it produced new ids and
therefore a new key, so a pair who fell out and made up — or the far more common
"restricted, re-followed, unrestricted" — ended up being told twice in the same
thread. The key is now `mutual_follow:<conversationId>`, which follow churn
cannot move, and the service also checks the thread for an existing notice so
rows written under the old key are recognised.

If a pair become mutual **while** a block or restriction is in force, no notice is
written and nothing is spent; when the flag is lifted, and only if the
conversation has never been told, exactly one notice appears.

The index behind it is unique and **partial**, restricted to string keys — see
*Why ordinary messages carry no key* below for why that is a correctness
requirement rather than a preference.

**Operators:** a database that ran the older rule can hold duplicates.
`api/scripts/dedupe-mutual-follow-notices.js` reports what it would change and
only writes with `--apply`. It keeps the oldest notice per conversation, removes
the later ones, rewrites the survivor's key, and repoints any conversation
preview that referenced a removed row — at that message's own timestamp, so no
conversation jumps to the top of anybody's list. It never touches text messages,
shared posts, consent, or follow/block/restrict records.

```bash
cd api
node scripts/dedupe-mutual-follow-notices.js           # report only
node scripts/dedupe-mutual-follow-notices.js --apply   # repair
```

### Why ordinary messages carry no key (2026-08-21)

An ordinary message — text, image, or a shared post — stores **no**
`systemEventKey` and no `systemEvent`. The fields are not set to `null`; they are
absent from the document entirely, and the difference is not cosmetic.

`systemEventKey` was originally declared with `default: null`, so Mongoose wrote
the field on every message. The uniqueness index was `unique + sparse`, and a
sparse index skips documents where a field is *missing* but still indexes one
holding an explicit `null`. The first ordinary message in the database therefore
claimed `{ systemEventKey: null }`, and every message written after it collided
with that single entry:

```text
E11000 duplicate key error collection: douyin-clone.messages
index: uniq_systemEventKey dup key: { systemEventKey: null }
```

The visible symptom was that a conversation worked exactly once. The first
message in a thread sent; the second failed — including replying to a shared post
someone had just sent you, and sending in a thread that had just shown the
mutual-follow notice.

Two independent guards now prevent it. The schema gives the field no default and
strips it from any non-system message before saving, so an ordinary message
cannot carry it. The index is partial —
`partialFilterExpression: { systemEventKey: { $type: 'string' } }` — so even a
field that somehow held `null` would not participate in the constraint.

**Operators:** an existing database still holds the stray fields and the old
index. `api/scripts/repair-message-system-event-keys.js` reports what it would
change and only writes with `--apply`. It removes the two fields from non-system
messages and replaces the index; it deletes nothing — no user message, no shared
post, no valid notice, and no conversation state.

```bash
cd api
node scripts/repair-message-system-event-keys.js           # report only
node scripts/repair-message-system-event-keys.js --apply   # repair
```

A fresh database needs none of this: `yarn dev` creates the partial index
directly from the schema.

Following again after an unfollow creates new follow records, but the stable
conversation-scoped key and history check prevent a second notice.

Reading follow state never writes one: the notice is driven by the `created`
event `FollowService` publishes only for a genuinely new relation.

### The wording

Stored nowhere. The row carries the event; the sentence is resolved from
`messages.mutual_follow_notice` per reader, so it follows their language rather
than whichever language the background job ran in. The conversation list derives
its own label — "You can now message each other" — the same way it derives
`[Photo]` and `[Post]`, so an enum name can never reach the list.

## Message content

`text`, `image`, `video`, `post`. Nothing else.

A `post` message is a **shared post** — see [Post sharing](./post-sharing.md).
It carries a `postId` and nothing more. The card the recipient sees is resolved
from the post on every read, so a post that is later deleted, hidden or whose
author is suspended stops rendering everywhere at once, including in history
somebody scrolls back to. The message itself stays: it is real history, and the
card simply becomes "Post unavailable".

The conversation list shows `[Post]` for such a row, never the post's caption —
the caption belongs to somebody else's content and can be withdrawn, and the
preview must not become the one place it survives.

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
- **Users and creators** are treated identically. There is no subscription, payment or verification gate on messaging — only the follow relationship, the request/accept flow, and each person's own block and restrict flags.
- Anyone can **Restrict** or **Block** the other person from the conversation's `⋯` menu. Restrict is one-way and quiet: the restricted person is simply refused, and is never told which of the two happened. Block stops both directions. Only the matching Unrestrict or Unblock in the same menu gives the permission back — replying, following, or being followed does not.
- **Admins** have no message moderation surface, and no way to see who has blocked or restricted whom. Direct messages are private and no admin UI reads them.
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
| `audio` and `sticker` message types | Not required | No producer in this product |
| `chat-provider.tsx` (1071 lines) | Duplicate | Violated this project's file-size and composition rules and carried stream chat. Rewritten as a focused provider plus a hook |

### Possible future enhancements

Present in `xfans-v2` and plausible here, none implemented: pin/archive/mute, message deletion, typing indicator, per-message read receipts, active-viewing presence, Redis unread coalescing, and multi-attachment messages.

## Verification

| Check | Command |
|---|---|
| Permission, concurrency, compensation | `cd api && yarn test src/services/community/message` |
| Mutual-follow helpers | `cd api && yarn test src/services/community/follow` |
| API build | `cd api && yarn build` |
| Provider, workspace layout, thread | `cd user && yarn test src/providers/message src/hooks/use-message-thread` |
| Frontend lint and build | `cd user && yarn lint && yarn build` |
