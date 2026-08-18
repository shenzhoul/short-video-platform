---
title: Comments and Reactions
description: Post comments, replies, ownership-controlled mutations, and like toggling.
audience: [guest, user, creator, developer-agent]
domain: community
status: active
updated: 2026-08-17
tags: [comment, reply, like, reaction, share]
---

# Comments and Reactions

Guests may read pageable comments. Authenticated users may create comments/replies, edit or delete their own comments, and toggle likes.

## API

- `GET /social/:contentType/:contentId/comments`
- `POST /social/:contentType/:contentId/comments`
- `PUT /social/comments/:commentId`
- `DELETE /social/comments/:commentId`
- `POST /social/:contentType/:contentId/reactions/toggle`
- `POST /social/:contentType/:contentId/share`
- `GET /social/post/:postId/hot-comment`

Mutation routes use authentication, validation, permission checks, and throttling. The reaction actions defined in current constants are `like`, `follow`, and `share`.

`share` records that a user shared a post so the distinct-share counter can update. Sharing itself stays on the client as a native share or link copy; the endpoint only stores the fact and is idempotent, so a user shares a given post at most once. It is a separate route rather than a toggle action because there is no meaningful un-share, and it does not create an interaction notification.

Because a post can hold more than one reaction action from the same user, code deriving a single flag such as "is liked" filters by `action` rather than assuming one reaction per object.

## Presentation surfaces above the list

The comment list has one canonical order — newest first, `createdAt DESC, _id DESC` — and
cursor pagination depends on it. Anything shown "at the top" for a particular reader is a
separate section above that list, never a reordering of it. Two exist:

- **Notification context** — the exact comment a notification pointed at, shown when the
  reader arrived from their inbox.
- **Top comment** — the post's most-liked comment, shown to the post's owner.

Both are render-time only. The comment they show is hidden from the list underneath so the
reader never meets it twice, but the fetched page, its order and the cursor are untouched;
when a section stops applying, its comment simply reappears in its own position with no
refetch. Notification context outranks the top comment: if both point at the same comment,
only the notification section is shown, because that is the reason the reader is there.

### Top comment

Available to the post's owner as an at-a-glance view of what resonated. A comment qualifies
when it is a top-level comment on the post with at least **3 likes**; the most-liked one wins,
and the newer one breaks a tie. Replies never qualify — a reply belongs to a conversation
rather than standing on its own.

Ranking lives entirely on the server, so the rule cannot drift between client and backend.
`GET /social/post/:postId/hot-comment` requires authentication and returns `{ comment: null }`
to anyone who does not own the post; it never becomes a back door to a ranking other viewers
cannot see. When nothing clears the threshold the section is simply absent, and a failed
lookup leaves the canonical list untouched.

The comment renders through the ordinary comment component, so it carries the same author
line, timestamp and **Author** badge as it would in the list.

### Author badge

A comment written by the post's owner is marked **Author**, in both the list and the sections
above it. Ownership is decided by comparing ids, never display names, so a user cannot acquire
the badge by renaming themselves after the post's creator.

## Comment counters

`Post.totalComment` is maintained by the comment queue listener as an atomic delta and is the
authoritative number; the UI reflects it rather than recomputing from a loaded page. Deleting a
top-level comment removes its replies with it, so the delta is `-(1 + totalReply)` — and
`totalReply` is **absent**, not `0`, on a comment that never had a reply, so it must be defaulted
before the arithmetic. Without that default the delta was `NaN`, and the update pipeline's
`$max: [0, NaN]` resolved to `0`, silently zeroing a post's whole comment count on one deletion.

Live counting is correct now, but values written earlier are not repaired at runtime.
`api/scripts/audit-post-comment-counts.js` recomputes every post from its stored comments and
replies and reports the drift. It is a dry run by default and only writes with `--apply`; it is
deliberately a one-off maintenance tool, not part of startup or any request path.

```bash
cd api
node scripts/audit-post-comment-counts.js          # report only
node scripts/audit-post-comment-counts.js --apply  # correct the reported posts
```

Queue listeners update post/comment aggregates, create notifications (see [Interaction Notifications](./notifications.md)), and delete related community records when their parent is removed.
