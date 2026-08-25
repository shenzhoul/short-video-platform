---
title: Comments and Reactions
description: Post comments, replies, ownership-controlled mutations, and like toggling.
audience: [guest, user, creator, developer-agent]
domain: community
status: active
updated: 2026-08-24
tags: [comment, reply, like, reaction, share, realtime, image]
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
  reader arrived from their inbox. It is the ordinary comment component with its ordinary reply
  plumbing, so its replies expand, collapse and reload in place; the expansion state is shared
  with the list below, which means replying to the target from the composer opens the thread
  where the reader can actually see it.
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

## Comment images (2026-08-24)

A comment may carry **one** image. Text alone, an image alone, or both are all
valid; a comment with neither is refused. Videos are not supported.

**Composing.** The picture button beside `@` and the emoji picker opens an
image-only file chooser. The chosen image appears as a 60px thumbnail on the
bottom-left of the composer, with the action buttons on the bottom-right, and
the text you have typed is kept. Send stays disabled until there is either text
or a settled image — an upload still in progress does not count.

An image on its own is a complete comment: leave the text box empty, attach a
picture and press Send. Text-only and text-with-image work the same as before.
Only a comment with neither is refused, and the composer says so rather than
appearing to send.

**Replacing.** Choosing a second image asks first: *Replace the current image?*
Cancel keeps what is attached and uploads nothing. Replace only swaps once the
new image has uploaded successfully, so a failed upload leaves the original in
place. Either way the text survives.

**Removing.** A small dismiss control sits in the thumbnail's top-right corner.
It appears on hover and on keyboard focus, carries the label *Remove image*, and
has a hit area larger than the circle you can see. Removing keeps the text and
does not open the picker.

**Which files are accepted.** JPEG, PNG, WebP, GIF and AVIF/HEIC, up to 10MB,
up to 12000px on each side, and up to 40 million pixels once decoded — counted
across every frame, so an animation's frames all count towards it. An animation
may carry at most 300 frames and play for at most 30 seconds. Animated GIFs keep
their animation.

**Three refusals, three messages.** A rejected picture always says which rule it
broke, because the three rules ask you for three different things:

| What went wrong | Toast | Meaning |
| --- | --- | --- |
| Not a picture | *Invalid image format* | Pick a different file. |
| Over 10MB | *Image must be 10MB or smaller* | The picture is fine; save it smaller. |
| Too much picture | *Image resolution is too large* | Use a smaller or shorter one. |

The middle one is deliberately not folded into the last. A 10MB photograph may be
600x400, and telling its author to reduce the resolution would be advice that
does not apply — while a 257KB PNG can be 81 million pixels, which is far more
memory than a comment thumbnail is worth. Size and resolution are separate
problems with separate answers.

*Image resolution is too large* covers all of: too wide, too tall, too many
pixels in total, too many frames, and too long to play. Every one of them means
the picture was fine and there was simply too much of it.

The frame and duration limits are there for the animation no other limit catches:
a GIF of three thousand 16x16 frames is a few hundred kilobytes and under 1% of
the pixel budget, while asking the encoder for three thousand frames of work.

**These numbers apply to comment images only.** Photos on a post, pictures in a
direct message, avatars and cover images keep their own, looser rules — they are
still checked for being real images, but none of the sizes above applies to them.

*Invalid image format* covers everything else — no dialog, no page-blocking
alert. That includes videos, PDFs, text files, empty files, and **SVG**, which is
a scriptable document rather than a picture even though image tools can draw one.

It also covers a damaged or half-uploaded picture. The rule there is simple: an
image is accepted only if it can be decoded all the way through, so a file that
was cut short is refused rather than stored as a picture that will not display.
A file that merely trips a harmless warning — which many perfectly good photos
from phones do — is not affected.

The check is on the file's actual bytes, not its name or the type the browser
reports, so renaming `clip.mp4` to `clip.png` does not get it through. It runs
twice: in the browser for an immediate answer, and again on the file server,
which decodes the picture and has the final say. A file the server refuses leaves
no record and no bytes behind.

The browser reads a picture's size out of its header rather than by drawing it —
including AVIF and HEIC, whose dimensions sit several boxes deep in the file. That
matters for the replace dialog below: an oversized picture is refused while you
are still looking at the picker, instead of after being asked whether to throw
away the one you already chose.

If you already have an image attached and pick an invalid one, the toast appears
and the picture you had stays exactly where it was — no upload, no replace
prompt, nothing deleted.

**If posting fails.** The composer keeps your text and your picture so you can
try again. It clears only once the comment has actually been created.

**What happens to the file.** The image uploads when it is chosen, so posting is
not held up by the transfer. Until a comment claims it the file is a draft:
removing, replacing or cancelling deletes it from both the database and the disk.
If none of those reach the server — a closed tab, a crash, a lost connection —
the unused-file job collects it within four hours. An image that has become part
of a comment is never collected, and a late cleanup request cannot remove it.

Deleting a comment removes its image, its derivatives and the physical file.

**Roles.** Any signed-in user who may comment may attach an image. No admin
configuration is involved, and nothing new needs enabling.

## Opening a comment from a notification (2026-08-21)

Clicking a notification opens the post with a **From your notification** card
above the comment list, holding the thread the notification was about. While that
card is open, the same thread is hidden from the list below, so the reader sees
it once rather than twice. Closing the card puts the thread back in its own
position, with whatever like, reply and expand state it has since gained.

The card always shows the **root** of the thread, even when the notification was
about a reply: the reply is reached inside it, through the same expandable thread
the list uses. That is what keeps one copy of a comment on screen instead of two
that can drift apart, and it is why a like arriving while the card is open is
already correct when the card is closed.

Hiding is presentation only. `All Comments (N)` still counts the hidden thread,
the list is not refetched, its order does not change, and pagination continues
from where it was.

## Live updates (2026-08-21)

While Post Detail is open, everyone reading the same post sees each other's
activity without refreshing: a new top-level comment, a comment or reply being
liked or unliked, a deletion, and a thread's reply count going up.

What a reader receives depends on what they actually have open, which is what
keeps a viral post affordable:

| They are | They receive |
|---|---|
| viewing the post | new comments, deletions, and counter updates for any comment on it |
| with a thread **collapsed** | only that the thread grew — the "Expand N replies" number moves |
| with a thread **expanded** | the reply itself, inserted in place |
| not viewing the post | nothing at all |

Counts arrive as authoritative totals rather than "+1"/"-1", roughly twice a
second at most per comment. Three consequences worth knowing:

- a like storm on one comment costs one update, not one per like;
- a reader whose connection dropped is corrected by the next total, so no refresh
  is needed to resynchronise;
- liking something yourself updates instantly and is *not* undone when the
  server's total arrives — your own filled heart is yours, separate from the
  shared number.

Reply pagination is untouched by live arrivals: a reply that appears is appended
to what is already loaded, so scroll position and the "load more" cursor stay
where they were.

Notifications remain a separate feature. A "liked your comment" notification and
the comment's own live count are delivered independently, so neither depends on
the other being open.
