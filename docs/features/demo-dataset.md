---
title: Demo Dataset
description: Two-phase tooling that fetches licensed stock media and seeds a complete, removable demo dataset of accounts, posts and interactions.
audience: [developer-agent, operator]
domain: cross
status: active
updated: 2026-09-02
tags: [demo, seed, fixtures, media, pexels, pixabay, tooling, local-development]
---

# Demo Dataset

A local-development dataset with real media in it: sixteen accounts across eight
themes, each with a drawn avatar, a stock cover, four photo posts and three video
posts, and a follow / like / comment / share graph between them.

It exists so that nobody has to find an avatar, a cover, a photo and a video for
every test account by hand — and so that the feed, the profile grid, the video
player and the counters can be looked at with something that resembles a
populated product.

**This is development tooling. It is never run against production.**

## The two commands

```bash
cd api
yarn demo:fetch-media   # phase 1 — talks to Pexels/Pixabay, writes to disk only
yarn demo:seed          # phase 2 — writes to MongoDB and the file server
yarn demo:verify        # read-only: is the seeded dataset actually serviceable?
yarn demo:clean         # removes exactly what demo:seed created
```

The split is the important part. Phase 1 is the only phase that touches an
external service; phase 2 reads a manifest from disk and has no API key, no
provider module and no URL to call. Once the media is cached, the dataset can be
rebuilt any number of times offline, and re-seeding never costs a provider a
single request.

Implementation and internals: [`api/demo/README.md`](../../api/demo/README.md).

## What gets created

| | Default |
|---|---|
| Themes | 13 — one per active category |
| Accounts | **16** — a floor, raised automatically if the product gains categories |
| Posts per account | 10: 6 landscape video, 3 portrait video, 1 photo |
| Posts | **160** — 96 landscape video, 48 portrait video, 16 photo |
| Media | ~390 stock files + 16 generated avatars, about 2 GB cached |
| Interactions | follows, likes, comment likes, comments, replies, mentions, shares |
| Notifications | 967 across every account, read and unread, in production's aggregated shape |
| Messaging | 35 conversations, 119 messages; every account has ≥4 threads |

Sizes and themes are configuration, not code: `api/demo/demo.config.js` and
`api/demo/themes.js`.

Posts are backdated across the previous 90 days with an evening bias and a
recency skew, so the feed has a real chronology rather than 112 documents created
in the same second.

## Setup

### 1. API keys

Phase 1 needs a Pexels key. Pixabay is optional and is only consulted for slots
Pexels could not fill — on a normal run it is never called.

| Key | Where to get it | Required |
|---|---|---|
| `PEXELS_API_KEY` | <https://www.pexels.com/api/> — sign in, "Your API Key" | yes |
| `PIXABAY_API_KEY` | <https://pixabay.com/api/docs/> — sign in, key shown on the docs page | no |

Both go in **`api/.env`** and nowhere else. They are server-side credentials:
never copy them into `user/` or `admin/` under a `NEXT_PUBLIC_` name, and never
set them on the Vercel projects. `api/.env` is git-ignored; `api/.env.example`
lists the names with empty values.

Neither key is ever passed on a command line — shell history and `ps` output are
readable by other processes.

### 2. ffmpeg

Phase 1 needs `ffmpeg` and `ffprobe` on `PATH`. They validate downloaded video
and extract each video's poster frame.

### 3. Services

Phase 2 needs MongoDB and the file server:

```bash
cd file-server && yarn start:dev
```

## Roles

**Developers** run these commands locally. The dataset is the fastest way to see the
home feed, a creator profile, video playback and the interaction counters with
real content.

**Operators** should know that `demo_seed_ledger` is a development-only
collection and that `metadata.demo.isDemo` marks every fabricated account. If a
demo dataset ever appears in an environment where it does not belong,
`yarn demo:clean` removes it precisely; there is no manual cleanup to work out.

**Admins** see demo accounts in the admin user list like any other account. They
are ordinary active users apart from the `metadata.demo` marker, and can be
suspended or deleted through the normal admin flows — though `yarn demo:clean` is
the correct way to remove them, because it also reclaims their uploaded files.

**Guests and end users** never encounter this. Nothing in the product references
demo data or the ledger.

## Sourcing and licensing

- **Only Pexels and Pixabay.** No scraping of Google Images, Pinterest, TikTok,
  Instagram or YouTube — those are neither licensed for this nor permitted by
  their terms.
- **Nothing is hotlinked.** Every file is downloaded and then served from this
  project's own file server. Pixabay's API terms require this explicitly, and
  Pexels' CDN is not ours to use as a backend.
- **Provenance is recorded** for every file in `demo/media/manifest.json`:
  source, source media id, source page URL, creator name and profile, licence
  name and URL, theme, purpose, local path, sha256 and download time. Neither
  licence requires attribution; it is recorded anyway so the dataset can be
  audited later.
- **API results are cached**, which is both a Pixabay requirement and the reason
  `demo:seed` never calls a provider.

| Source | Licence | Attribution required |
|---|---|---|
| Pexels | [Pexels License](https://www.pexels.com/license/) | no |
| Pixabay | [Pixabay Content License](https://pixabay.com/service/license-summary/) | no |

## Avatars are drawn, not photographed

Account avatars are generated locally — abstract gradient-and-glyph marks, seeded
from the username so each account has its own and every run redraws it
identically.

Using a stock photograph of a real person as a fictional account's avatar
presents an identifiable human being as the owner of an account they have never
heard of, writing posts they did not write. The stock licence covers the image,
not that claim. A synthetic "AI person" is not an improvement: a viewer cannot
tell it is synthetic, so the same false claim is being made either way.

Covers *are* stock photographs, because a landscape behind a profile header
claims nothing about who owns the profile. Each account still gets its own file —
no image is used twice anywhere in the dataset, enforced on the file's sha256.

## Validation

Downloaded media is held to the project's own limits before it is ever uploaded,
using `@douyin-clone/upload-policy` — the same module the API and file server
read. A file that would be refused on upload is found in phase 1, where the
answer is "fetch another one".

- What a file **is** comes from a magic-byte sniff, never the extension, the URL
  or the `Content-Type`.
- Bytes, each dimension, total pixels, duration, frame rate and codec are bounded
  separately.
- Images are fully decoded, because a header can describe an image a truncated
  file does not contain.
- Video is probed with ffprobe, ignoring `attached_pic` streams (an audio file
  renamed `.mp4` is a valid MP4), and a frame near the **end** is decoded — a
  truncated faststart MP4 reports a full duration from its header and only fails
  later, on the transcode queue.
- The dataset applies its own stricter ceilings on top: portrait aspect for
  posts, landscape for covers, and 30 seconds / 30 MB for video, well inside the
  10-minute / 500 MB the product permits.

## Uploads go through the real pipeline

Every avatar, cover, photo, video and thumbnail is uploaded exactly as a browser
uploads: `direct-upload-link` → `POST /files/upload` → wait for processing →
attach the reference. Nothing writes to the `files` collection directly, so the
file server's validation, re-encoding and video transcoding all run — and a break
in that pipeline surfaces as a failed seed instead of hiding behind a dataset
that looks fine.

Video thumbnails come from a frame of the video itself, extracted with ffmpeg in
phase 1 and uploaded as a `post-thumbnail`, so a feed card's poster is provably a
frame of the clip behind it.

File reference ordering follows the project rule — *never leave a published row
pointing at an unreferenced file*. A post is created before its files are
referenced; a profile image is referenced before the pointer is swapped. See
[`file-uploads-and-processing.md`](./file-uploads-and-processing.md).

## Counters are recomputed, including comment likes

Every counter the dataset writes is **counted from the rows that exist**, never
incremented: `post.totalLike`, `totalComment` (which includes replies),
`totalShare`, `comment.totalReply`, `comment.totalLike` and the four
`user.stats` fields.

`comment.totalLike` was missing from that list until 2026-09-02, and nothing
else set it. The seeder wrote comment-like reactions and the `comment_like`
notifications that go with them, but every seeded comment kept the `totalLike: 0`
it was inserted with. Opening such a notification showed a comment with four
real likes behind it and a like count of zero. The definition is production's,
from `CommentReactionListener`: distinct accounts holding a `reactions` row with
`objectType: 'comment'`, `action: 'like'`. Replies are counted the same way and
are never folded into their parent.

`demo:verify` now checks every comment and reply against its reaction rows, and
checks that each `comment_like` notification names a comment that really is
liked, by the actor the notification names, belonging to the recipient.

## Re-running is safe

`demo:seed` is idempotent. A `demo_seed_ledger` collection maps a stable seed key
to the `_id` of the document created for it, so a second run finds everything
present and creates nothing.

Counters are **recomputed** rather than incremented — `post.totalLike`,
`totalComment` (which includes replies), `totalShare`, `comment.totalReply` and
all four `user.stats` fields are counted from the rows that exist. A count of the
same rows is the same number, so running twice cannot double anything.

MongoDB here is standalone, so there are no transactions. Ledger rows are written
before the documents they name, which makes every interruption point recoverable:
a ledger row without its document is a no-op for clean, while a document without
its ledger row — the reverse ordering — would be unremovable.

### How to check that it really is idempotent (2026-09-02)

Run `demo:seed` twice and **diff the two summary blocks line by line**. Every
count must match exactly:

```
auth 16   comment 527   conversation 35   conversation_participant 70
file 336  message 119   notification 967  post 160   post_media 160
reaction 1864   relationship 2   user 16
```

This is not a formality. A defect that survived every other check was caught
only here: the primary account's showcase threads chose their partners by asking
the database which conversations already existed, so a second run treated its own
threads as taken, picked different partners, and added three conversations, six
participant rows, four messages and two block/restrict rows. `demo:verify`
passed both times and every adapter honestly reported "0 created" for the rows it
*did* own — the growth was invisible except in the totals.

The partner choice is now derived from the account plan
(`ringAndChordPartnersOf`), and `demo/lib/showcase-partners.spec.ts` keeps it
that way.

## Cleanup is exact

`yarn demo:clean` deletes only ids the ledger records. It never matches on a
username prefix, a metadata flag, or "posts belonging to a demo user" — every one
of those can be true of data this tool did not create.

```bash
yarn demo:clean --dry-run   # print the plan, change nothing
yarn demo:clean
yarn demo:clean --purge     # also drop the ledger collection
```

One deliberate exception: **a comment or reaction left by a real user on a demo
post is not deleted.** It is not in the ledger and it is not ours. The run
reports how many were left so a human can decide.

Files are removed through the file server's API after the rows that referenced
them, so a failure there leaves unreferenced files — which the unused-file
sweeper collects — rather than rows pointing at deleted bytes.

The media cache in `api/demo/media/` survives a clean, so re-seeding does not
re-download.

### Physical files, not just rows (2026-09-02)

`demo:clean` deletes each file through the file server, which removes the stored
bytes and the database record together, and then **checks**: the same ids are
looked up again and the run only reports success when none of them resolves. If
any survive, they are named and their ledger rows are kept so a later run can
finish the job.

You can confirm it independently:

```bash
find file-server/public -type f | wc -l   # 0 after a full clean
```

A clean of the full dataset takes that store from 959 files (1.1 GB) to 0.

## Checking a seeded dataset

`yarn demo:verify` is read-only and answers the questions a viewer would: does
every avatar, cover, photo, video and poster actually serve; did every file finish
processing; does every file carry the reference that keeps the unused-file sweeper
away from it; do the cached counters equal a fresh count; is any file shared
between two posts. It exits non-zero on failure.

Two regression tests run with `yarn test`:

- `api/demo/lib/seed-interactions.spec.ts` — the second run must create nothing.
- `api/demo/lib/password-format.spec.ts` — a seeded credential must verify against
  the real `PasswordHasherService`.

## Pinned posts

Every demo account pins at least one of its own posts, and about a third pin two
so that ordering *between* pinned posts is exercised rather than assumed. The
primary account (`maitran.eats`) always has one pinned photo and one pinned
video, because it is the account a person signs in as to look at the dataset by
hand.

Pinned state uses the product's own fields — `isPinned` and `pinnedAt`, the two
`PostCrudService.setPinned` writes. Nothing invents a field the API does not
understand. There is no pin/unpin screen in the product yet, so the dataset
writes the state directly through the same shape the service would; that is the
one limitation worth knowing.

Which posts are pinned is decided in the plan, from the account's own seeded
generator, and never by reading what is already pinned in the database. A second
`demo:seed` therefore pins exactly the same posts.

`GET /posts/home-posts?userId=…` sorts `{ isPinned: -1, pinnedAt: -1,
createdAt: -1, _id: -1 }`, so pinned posts lead a creator's list. The creator
grid in the post-detail panel, the highlighted tile and the next/previous
sequence all read that one order — see `user/src/components/content/post/creator-post-order.ts`.

`demo:verify` fails if any account has no pinned post, if a pinned post sits
behind an unpinned one in the API's own sort, if two pins share a timestamp, if
the dataset has no pinned photo or no pinned video, or if the primary account is
missing either kind.

## Orientation

The platform is a video platform and a feed card is a 16:9 box, so the dataset is
90% video and mostly landscape — the shape the card is built for, and the one the
product had never been exercised with.

Orientation comes from the decoded width and height `ffprobe` reports, never from
the search filter that found a clip or anything a provider claimed. Nothing is
rotated, cropped, stretched or padded to fit a bucket: a clip of the wrong shape
is refused and another is fetched. The manifest records `width`, `height`,
`aspectRatio` and `orientation`, and `demo:verify` re-probes every cached video
and fails on any disagreement.

Each account gets exactly 6 landscape and 3 portrait videos — checked per
account, not only in aggregate, because a dataset that is 60% landscape overall
but leaves one profile entirely portrait tests neither case properly.

## Notifications and messaging

Both are derived from interactions that already exist; nothing is fabricated to
fill a list.

**Notifications follow production's aggregation**, which is not one row per
event: twelve likes on a post produce *one* notification, comments are individual
until the fifth and then aggregate, follows are one reusable row per actor, and
**sharing produces nothing** — `post_share` is deliberately absent from
`NOTIFICATION_TYPES` because a share is delivered as a message, which already
notifies. Nothing notifies its own actor.

**Conversations are a ring with chords**, so every account has at least four
threads, messages in both directions, and at least one unread — while the row
count stays linear in the number of accounts rather than quadratic.

Only states the product can actually reach are seeded: pending, accepted,
mutual-follow-open, restricted and blocked. A pending thread holds exactly one
message, from the initiator, because the product refuses a second until the other
side answers.

The primary account carries one thread of every kind, so the whole messaging
surface can be exercised by hand.

## Signing in

Demo accounts are real accounts. Any seeded email signs in with the password in
`demo.config.js` (`demodemo` by default). Emails use the `demo.invalid` domain,
reserved by RFC 2606, so no address can ever receive mail.

## Related

- [`api/demo/README.md`](../../api/demo/README.md) — implementation detail
- [`file-uploads-and-processing.md`](./file-uploads-and-processing.md)
- [`post-publishing.md`](./post-publishing.md)
- [`following.md`](./following.md), [`comments-and-reactions.md`](./comments-and-reactions.md)
