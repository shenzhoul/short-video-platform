---
title: Post Sharing
description: The share popover on every post, sending a post into a direct message, and how the share counter is calculated.
audience: [user, creator, developer-agent]
domain: community
status: active
updated: 2026-08-20
tags: [share, post, message, popover, statistics, permission]
---

# Post Sharing

Sharing a post does two things that used to be one: it can copy a link, and it
can send the post to somebody as a message.

## The share panel

Hovering the Share control on a post opens a panel beside it. On a device
without hover, tapping it does the same. Escape or a click elsewhere closes it.

It holds a search box, the people you can share with, and a row of secondary
actions.

**Opening it changes nothing.** No statistic moves, no message is created, and
nothing is fetched until the panel is actually opened for the first time — a
feed can hold twenty Share controls, and a panel that loaded eagerly would ask
for the viewer's followers twenty times over.

### Who is in the list

Everyone you follow, plus everyone who follows you, merged into one list.

- Merged rather than two tabs, because from the sharer's side it is one
  question: who am I sending this to.
- Somebody who is both appears **once**. De-duplication is on the user id and
  nothing else — names are not unique and usernames change.
- You are never in your own list.
- Search runs on the server, debounced, against display name and username. A
  creator with thousands of followers must not have all of them pulled into the
  browser so a filter can run over them.
- The list pages; loading, empty and error states each have their own copy, and
  a failure offers a retry rather than an empty panel.

### The secondary actions

`Copy the link` works. Download, QR code and Report are **placeholders**: they
render, they are disabled, and they carry a "coming soon" label. They cannot
share, cannot create a message, and cannot move a counter. A control that
silently does nothing — or worse, reports success — is the thing being avoided
here.

## Sending a post into a message

Pressing `Share` beside somebody sends the post to them as a real message.

The row reports its own outcome — `Sharing…`, `Sent`, or the reason it was
refused — rather than raising a toast. Several shares can be in flight from one
panel, and a stack of toasts would not say which recipient each belonged to. The
panel stays open so the next person can be picked, and the post detail behind it
is never closed.

A shared post is an ordinary message. It goes through exactly the same
permission gate as anything typed:

| Situation | What happens |
|---|---|
| Mutual followers | Sent |
| Conversation already accepted | Sent |
| Strangers, nothing sent yet | The share **is** the one request message |
| A request of yours is still unanswered | Refused — `MESSAGE_REQUEST_PENDING` |
| They restricted you | Refused — `RECIPIENT_RESTRICTED` |
| Either of you blocked the other | Refused — `USER_BLOCKED` |
| Post deleted or its author removed | Refused — `POST_DELETED` |
| One of you cannot see the post | Refused — `POST_NOT_ACCESSIBLE` |

See [Direct Messaging](./messaging.md) for the permission model itself.

The client sends a `postId` and a recipient id, and nothing else. The post's
title, cover and author are never accepted from the browser: they would be a
claim about content the sender may not even be able to see, and the server has
to read the post anyway to check that **both** people may. A post the recipient
cannot open is refused rather than delivered as a dead card.

The conversation is found or created on the server, so a share can start a
thread that does not exist yet, and one pair never ends up with two threads.

### Double clicks

The guard key is `(sharer, post, recipient)` with a ten-second expiry. All three
parts matter: keyed on the sharer and post alone it would block sharing the same
post onwards to a second friend, which is the most ordinary thing a person does
in this panel.

The same post, to the same person, twice within ten seconds is treated as one
click and answered `DUPLICATE_SHARE` (HTTP 409). The client shows that row as
`Sent`, because the user's intent already succeeded — surfacing a failure for it
would be wrong.

A share that genuinely *failed* can be retried immediately; the guard is
released when the send throws. It is a short-lived Redis key rather than a flag
in the browser or in one server process, because the application runs behind a
load balancer and the second click may land on a different instance.

## Reading a shared post

The recipient sees a portrait card: cover image, a play badge for video, a
multi-photo badge when the post holds more than one image, a trimmed caption and
the author. Nothing autoplays — a conversation is not a feed.

Clicking it opens the **application's own** post detail, through the same
`modal_id` link every other surface uses. There is no second post viewer inside
Messages, so playback rules, deep links and the back button all behave the way
they do everywhere else. When the current page already hosts that modal, nothing
unmounts: the conversation stays open behind it with its scroll position, and
closing the modal reveals it again.

### When the post is gone

Availability is re-checked on **every read**, for **each reader** separately —
the author may have blocked one participant and not the other.

When a post is deleted, hidden, its author suspended, or the reader blocked, the
card becomes `Post unavailable`. The message stays in history; the content it
pointed at does not come back through this door, and the card keeps no caption or
cover from when it was still visible.

## How the share counter works

`totalShare` counts **distinct sharers**, not share events. Sharing one post to
five friends is one share. Sharing it again next week is none.

This is unchanged from how link copies and native shares have always been
counted, and it is why the numbers before and after this feature mean the same
thing. Counting events instead would have made the statistic mean one thing for
old data and another for new, with no way to reconcile them.

The counter moves **only after a message actually exists**:

- opening the panel, searching, or pressing a placeholder action: no change;
- a refused share: no change;
- a duplicate click: no change;
- a successful share by somebody who has already shared this post: no change,
  and the response says so, so the client does not advance its own number.

The API returns `shareCounted` for exactly that reason — the client never
guesses whether the number moved.

### When the counter update fails

The message is written first, so a delivered share is never lost. The
bookkeeping behind the number can still fail, and it is not left to a log line.

**Three layers, in order:**

1. the inline attempt, whose result is what `shareCounted` reports;
2. on failure, `share:record-requested` is published. That is a **BullMQ job
   persisted in Redis**, not an in-process emitter and not pub/sub, so it
   survives an API restart once enqueued. Three attempts, exponential backoff;
   failed jobs stay visible for an hour;
3. `api/scripts/reconcile-post-share-counts.js` repairs anything that still
   falls through.

**The window layers 1 and 2 cannot cover:** the process dies *after* the message
is saved and *before* the job is enqueued. The job never existed, so no worker
will retry it. MongoDB is deployed standalone here, so the message and an outbox
row cannot be written in a single transaction — an outbox would have the same
window, just moved.

What survives that crash is the message. A persisted `type: 'post'` message *is*
the durable record that this person shared this post, so the script reconciles
from messages rather than from the share rows it is trying to repair:

```text
messages  ->  distinct (postId, senderId)  ->  share rows  ->  totalShare
```

A script that only recomputed the counter from existing share rows could not
repair a row that was never written at all — which is exactly this case.

### Running the reconciler

Dry run by default; nothing is written without `--apply`.

```bash
node api/scripts/reconcile-post-share-counts.js              # report only
node api/scripts/reconcile-post-share-counts.js --apply      # repair
node api/scripts/reconcile-post-share-counts.js --post <id>  # one post
```

The dry run reports `missingShareRecords`, `postsWithCounterDrift`,
`shareRecordsToCreate`, `postCountersToFix` and `sharesSkippedPostDeleted`
separately, so the two kinds of drift can be told apart.

- **Schedule:** daily, off-peak, with `--apply`. What it repairs needs an inline
  failure *and* three failed retries, or a crash inside a millisecond-wide
  window, so daily is ample. The dry run is cheap enough to alert on if it ever
  reports a non-zero count.
- **Concurrency:** it takes a Redis lock (`reconcile:post-share-counts`, 15
  minute expiry). A second instance prints "Another reconciliation is already
  running" and exits rather than racing. A repair refuses to proceed at all if
  the lock cannot be taken.
- **Idempotent:** share rows are upserted behind their unique index and the
  counter is recomputed rather than adjusted, so a second pass changes nothing.
- It never creates a message, never deletes anything, and skips posts whose
  document is gone — there is nothing left to count for those.

## Roles

- **Guests** cannot share into messages; the panel needs a session. Copying a
  link needs nothing.
- **Users and creators** are treated identically.
- **Admins** have no share moderation surface.
- **Operators** need no configuration. Sharing depends on no third-party
  service, no API key and no setting.

## API

```text
POST /api/messages/share/post/{postId}
     body: { recipientId }
     -> { message, conversationId, shareCounted }
```

Rate limited to 30 per minute per user. Refusals carry a machine-readable
`error` code alongside the display message, so the client branches on the code
rather than on text that is meant to be translated.

## Not implemented

Download, QR code and Report in the panel. Sharing to several recipients in one
request — each recipient is a separate call, so a refusal for one names that
person and leaves the others alone. Sharing anywhere other than a direct
message.
