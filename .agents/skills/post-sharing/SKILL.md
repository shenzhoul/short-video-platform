---
name: post-sharing
description: Sharing a post — the hover share popover and its recipient list, sending a post into a direct message as a real message, and how totalShare is counted across api/ and user/.
---

# Post Sharing

## When to Apply

Anything touching the Share control on a post, the share popover, sharing into a
message, or `totalShare`. Load `.agents/skills/direct-messaging/SKILL.md` too:
a shared post *is* a message and obeys that skill's permission rules.

## 1. `totalShare` counts distinct sharers, not events

One post shared to five friends is **one** share. Shared again next week: none.

This is not a simplification to revisit. It is how link copies and native shares
have always been counted, so old and new numbers mean the same thing. Switching
to counting events would silently redefine the statistic halfway through the
data, with no way to reconcile the history.

Practical consequences:

- the API returns `shareCounted`, and the client advances its own number only
  when that is `true` — never optimistically, never by guessing;
- idempotency is free: shares are `reactions` rows behind
  `uniq_objectType_objectId_action_createdBy`, with no unshare.

## 2. Write the message first, count second

`PostShareService.shareToMessage` is ordered deliberately:

```text
duplicate guard -> message (permission gate inside) -> counter
```

A refused share throws before the counter is ever touched. The reverse order
would need a compensating decrement, and a decrement that fails leaves the
number wrong forever.

The counter update is *bookkeeping*: if it throws, the share is still delivered
and `shareCounted` comes back `false`. A logged failure must never turn a
message that exists into an error for the sender — but it must not be dropped
either. Three layers, in order:

1. inline attempt, whose result is what `shareCounted` reports;
2. on failure, publish `share:record-requested`; `PostShareRecordListener`
   retries it with the queue's backoff. Do **not** catch inside that listener —
   the throw is what asks for the retry;
3. `api/scripts/reconcile-post-share-counts.js` repairs whatever still falls
   through. Dry-run by default, Redis-locked, idempotent.

Every layer calls the same idempotent write, so retries cannot double count.

**The reconciler reads messages, not share rows.** Layers 1 and 2 cannot cover a
crash between saving the message and enqueueing the job — the job never existed.
Mongo is standalone here, so an outbox cannot be written in the same transaction
as the message and would have the same window. The persisted `type: 'post'`
message is the durable proof of the share, so the script goes
`messages -> distinct (postId, senderId) -> share rows -> totalShare`. A
counter-only reconciliation cannot recreate a row that was never written.

## 3. It is an orchestrator, not a method on either domain

`PostShareService` lives in `api/src/services/community/share/`. The message
domain must not learn that shares are reactions; the reaction domain must not
learn that messages exist. Putting the call on either side couples them and is
the first step toward a cycle.

## 4. Never accept post content from the client

The payload is `postId` + `recipientId`. Nothing else.

A title or cover from the browser is a *claim* about content the sender may not
be able to see, and the server has to read the post anyway to check that **both**
people may. `SharedPostService.assertShareable` checks the sender and the
recipient separately — a post the recipient cannot open is refused rather than
delivered as a dead card.

Validate the post **before** the permission claim, so an unshareable post never
costs a stranger their one request message.

## 5. Resolve the card per read, per reader

Never snapshot the post onto the message. The takedown story is the reason: a
copy would keep serving a deleted or hidden post from a place nobody looks when
handling a report.

Per *reader*, not per message: the author may have blocked one participant and
not the other.

The unavailable card is a different shape, not the available one with a flag on
it. Returning caption and cover next to `available: false` is exactly how a
withdrawn post leaks.

Batch it. `SharedPostService.resolveMany` takes a page of ids; resolving one at a
time is the classic N+1 on a screen that scrolls.

## 6. The popover must not fetch until it is opened

A feed holds many Share controls. A CSS-only `group-hover` panel renders its
contents whether or not anybody opened it, so every card would request the
viewer's followers.

`useHoverPopover` exists for this: lazy first-open callback, open/close delays so
the pointer can cross the gap to the panel, Escape and outside-click dismissal,
and a touch path — `pointerType === 'touch'` is read from the event rather than
from a media query, because a laptop with a touchscreen is both.

Do not replace it with `HoverRevealPanel`, which is the pure-CSS primitive used
where the panel is cheap and static.

## 7. One list, de-duplicated on the id

Followers plus following, merged. Somebody who is both appears once, keyed on
`_id` — not on name or username, which are neither unique nor stable. The
current user is filtered out client-side; the follow endpoints are
general-purpose lists and "can I share with myself" is this feature's question.

Search is server-side and debounced. `getFollowingUsers`/`getFollowerUsers`
already support `q` against name and username; pulling thousands of followers
into the browser to filter them is not an option.

## 8. Report the outcome on the row, not in a toast

Several shares can be in flight from one panel. A stack of toasts cannot say
which recipient each belongs to. The row shows `Sharing… / Sent / Retry` and the
refusal text.

`DUPLICATE_SHARE` (409) settles the row as **Sent** — the user's intent already
succeeded, and a failure for it would be a lie.

## 8a. Scope the duplicate guard to all three identities

`share:post:{sharerId}:{postId}:{recipientId}`, ten seconds. Dropping the
recipient from the key blocks sharing the same post onwards to a second friend,
which is the most ordinary thing anyone does in this panel. Dropping the sharer
lets one user's click block another's.

The guard is released when the send throws, so a share that genuinely failed can
be retried at once; only a *successful* share holds the key for its window.

Distinct-sharer counting de-duplicates separately, on `(postId, sharerId)` — the
two mechanisms answer different questions and must not be merged.

## 9. Placeholder actions stay inert

Download, QR and Report render, are `disabled`, and say "coming soon". They must
not share, create a message, move a counter, or fake success. Do not add API
routes for them until they do something.

## 10. Open the app's own post detail

`useOpenSharedPost` pushes the same `modal_id` param every other surface uses.
Never build a post viewer inside Messages — one modal means one set of playback
rules, one deep link and one back button.

When the current route already hosts that modal the param is added in place, so
nothing unmounts and the conversation keeps its scroll behind it. `/messages`
does not host one, so it falls back to home.

## Key files

```text
api/src/services/community/share/post-share.service.ts   orchestration + duplicate guard
api/src/services/community/message/shared-post.service.ts per-reader cards
api/src/dtos/community/message/shared-post.dto.ts        the card, and its unavailable shape
api/src/payloads/community/message/post-share.payload.ts ids only
api/src/common/exceptions/message/                       POST_DELETED, DUPLICATE_SHARE, ...
api/src/controllers/community/message/message.controller.ts

user/src/components/interactions/share-popover.tsx       the panel
user/src/components/interactions/share-recipient-row.tsx per-row state
user/src/hooks/use-hover-popover.ts                      hover intent, Escape, touch
user/src/hooks/use-share-recipients.ts                   merged, de-duplicated, searched
user/src/hooks/use-open-shared-post.ts                   opens the shared post detail
user/src/components/message/shared-post-card.tsx         the card in a bubble
user/src/lib/share-errors.ts                             codes -> copy
```

## Verification

- `api/`: `yarn test src/services/community/share src/services/community/message`
- `user/`: `yarn test src/components/interactions/share-popover.spec.tsx src/components/message/shared-post-message.spec.tsx`
- Then `yarn build` in both. **Also boot the API** — `nest build` compiles a
  provider that is not registered, and the failure only appears at startup as
  "Nest can't resolve dependencies".
