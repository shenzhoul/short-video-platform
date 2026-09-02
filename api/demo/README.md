# Demo dataset

Two independent commands that build a complete, believable dataset — accounts
with avatars and covers, photo and video posts with working thumbnails, and a
follow/like/comment/share graph — without anyone hunting for media by hand.

Last updated: 2026-09-01

```bash
cd api
yarn demo:fetch-media   # phase 1 — network, no database
yarn demo:seed          # phase 2 — database + file server, no network
yarn demo:verify        # read-only check that the dataset is actually serviceable
yarn demo:clean         # remove exactly what the seed created
```

The phases are deliberately separate. Phase 1 is the only one that talks to a
stock provider; phase 2 has no API key, no provider module and no URL to call, so
the dataset can be rebuilt on a machine with no internet and re-seeded any number
of times without touching an external service again.

## Default dataset

This is a video platform, so the dataset is 90% video, and mostly landscape —
the shape a 16:9 feed card is built for and the one that had never been
exercised.

| | |
|---|---|
| Themes | 13 — one per active category |
| Accounts | **16** (minimum; raised automatically if the product gains categories) |
| Landscape video per account | 6 |
| Portrait video per account | 3 |
| Photo posts per account | 1 |
| Posts | **160** — 96 landscape video, 48 portrait video, 16 photo |
| Interactions | follows, likes, comment likes, comments, replies, mentions, shares |
| Notifications | every account, read and unread, in production's aggregated shape |
| Messaging | a conversation ring plus chords; every account has ≥2 threads |
| Media files | ~390 downloaded + 16 generated avatars |
| Cache size | roughly 2 GB, in `api/demo/media/` (git-ignored) |

Every number is in [`demo.config.js`](demo.config.js). Themes, personas, captions
and comment pools are in [`themes.js`](themes.js). Nothing downstream hardcodes a
count: `lib/account-plan.js` derives the requirements, and `demo:verify`
recomputes its expectations from the same place, so changing the config changes
what is built *and* what is checked.

### Account count is derived, not fixed

One theme names one category and every theme carries at least one account, so
every active category has demo content by construction. `minAccounts` is a floor,
not a target: if the product gains more categories than that, the account count
rises to cover them. `demo:seed` refuses to run, and `demo:verify` fails, if an
active category has no theme.

### Orientation

Orientation is decided from the decoded width and height that `ffprobe` reports —
never from the search filter that found the clip, the filename, or anything the
provider claimed. Nothing is rotated, cropped, stretched or letterboxed to make
it fit a bucket: a clip that is not the shape its slot needs is refused and
another is fetched. The manifest records `width`, `height`, `aspectRatio` and
`orientation`, and `demo:verify` re-probes every cached video and fails on any
disagreement.

## Requirements

| Need | Phase 1 | Phase 2 |
|---|---|---|
| `PEXELS_API_KEY` in `api/.env` | required | never read |
| `PIXABAY_API_KEY` in `api/.env` | optional fallback | never read |
| ffmpeg + ffprobe on `PATH` | required | – |
| MongoDB | – | required |
| File server running on `FILE_SERVER_BASE_URL` | – | required |

Start the file server before seeding:

```bash
cd file-server && yarn start:dev
```

## Phase 1 — `yarn demo:fetch-media`

Downloads and validates media, then writes `demo/media/manifest.json`.

- **Pexels is primary, Pixabay is the fallback.** Every Pexels query and page is
  exhausted for a slot before Pixabay is asked at all. On a normal run Pixabay is
  never called.
- **Nothing is hotlinked.** Every file is downloaded and later served from this
  project's own file server. (Pixabay's terms require this explicitly.)
- **Provenance is recorded** for every file: source, source media id, source page
  URL, creator, licence, theme, purpose, local path, sha256 and fetch time.
- **Two de-duplication keys.** `source:kind:id` is checked before downloading;
  the sha256 is checked after, which is what catches the same photograph
  appearing under two ids or on both providers.
- **Validation uses the project's own limits.** `@douyin-clone/upload-policy` —
  the same module the API and file server read — supplies the byte, dimension,
  pixel, duration, frame-rate and codec limits, so a file accepted here is one
  the upload pipeline will accept. Format comes from a magic-byte sniff, never
  from the extension or `Content-Type`.
- **Video is probed with ffprobe** and a frame near the end is decoded, because a
  truncated MP4 reports a full duration from its header and only fails later, on
  the transcode queue.
- **Video thumbnails are extracted from the video itself** with ffmpeg, about a
  third of the way in, so a feed card's poster is provably a frame of the clip.
- **Caching.** A re-run downloads nothing it already has. The manifest is saved
  after every accepted file, so an interrupted run resumes.

Useful flag:

```bash
yarn demo:fetch-media --themes=travel,pets   # re-fetch specific themes only
```

### Avatars are drawn, not photographed

Account avatars are generated locally ([`lib/avatar.js`](lib/avatar.js)) as
abstract gradient-and-glyph marks, seeded from the username so they are stable
across runs and unique per account.

A stock photograph of a real person presented as the owner of a fictional account
is an impersonation the licence does not cover — and a synthetic "person" is no
better, because a viewer cannot tell it is synthetic, so the same false claim is
being made. Covers *are* stock photographs, because a landscape behind a profile
claims nothing about who owns it; each account still gets its own file.

## Phase 2 — `yarn demo:seed`

Reads the manifest and builds the dataset. Idempotent: run it as many times as
you like.

- **Real upload pipeline.** Every image and video goes through
  `direct-upload-link` → `POST /files/upload` → wait for processing → attach
  reference, exactly as a browser upload does. Nothing writes to the `files`
  collection directly, so the file server's own validation, re-encoding and
  transcoding all run.
- **Reference ordering follows the project rule** — *never leave a published row
  pointing at an unreferenced file*. A post is written before its files are
  referenced (a new row); an avatar is referenced before the pointer is swapped
  (an existing row). See the comments in `lib/seed-posts.js` and
  `lib/seed-accounts.js`.
- **Counters are recomputed, not incremented.** `post.totalLike`, `totalComment`
  (which includes replies, matching `comment.listener.ts`), `totalShare`,
  `comment.totalReply` and all four `user.stats` fields are recomputed from the
  rows that exist. That is what makes a second run a no-op instead of a doubling.
- **Tag summaries** are rebuilt with a direct port of
  `TagStatisticsService.reconcileTagStatistic`.
- **Standalone MongoDB.** No transactions, no replica set assumed. Ledger rows
  are written before the documents they name, so every interruption point is
  recoverable.

Demo accounts can sign in — any seeded email with the password in
`config.seed.password` (`demodemo` by default). Emails use the `demo.invalid`
domain, which is reserved by RFC 2606 and can never receive mail.

## Notifications, conversations and messages

Both are derived from interactions that already exist — nothing is fabricated to
fill a list — and both go through a single adapter rather than scattered inserts:
[`lib/notification-adapter.js`](lib/notification-adapter.js) and
[`lib/message-adapter.js`](lib/message-adapter.js).

**Notifications follow production's shape, which is not one row per event.**
Twelve likes on a post produce *one* aggregate notification. Comments are
individual until the fifth, then aggregate. Follows are one reusable row per
actor. Mentions are one per resource. And **sharing produces nothing**, because
`post_share` is deliberately absent from `NOTIFICATION_TYPES` — a share is
delivered as a message, which already notifies. Nothing notifies its own actor.

**Conversations are a ring with chords**, not every pair: every account ends up
with at least two threads, incoming *and* outgoing messages, and at least one
unread — while the row count stays linear in the number of accounts rather than
quadratic.

Only the five states `claimSendSlot` can actually produce are seeded: pending,
accepted, mutual-follow-open, restricted and blocked. A pending thread therefore
holds exactly one message, from the initiator, because the product refuses a
second until the other side answers.

The primary account (`config.seed.social.primaryUsername`) additionally gets one
thread of every kind, so the whole messaging surface can be exercised by hand.

## `yarn demo:verify`

Read-only. Seeding without an error only proves the writes did not throw, so this
asks what a viewer would:

- does every avatar, cover, photo, video and poster URL actually serve bytes, with
  a content type matching what it claims to be?
- did every file finish processing, or is a post pointing at a video the transcode
  never produced?
- does every file carry the reference that stops the unused-file sweeper deleting
  it out from under a published row?
- do the cached counters equal a fresh count of the rows they cache?
- is any file shared between two posts or two profiles?
- does anything reference a document that is not there?
- does every account have exactly the configured post mix, with 6 landscape and
  3 portrait videos each — checked per account, not only in aggregate?
- does the manifest's `orientation` survive a fresh `ffprobe` of every file?
- does every active category have demo content?
- can every account actually sign in, with a current-format credential?
- does every account have notifications, at least one unread, and more than one
  type — with every target existing and no self-notification?
- does every account have at least two conversations, traffic both ways, correct
  unread counts, and no message that violates a block or restriction?
- is any demo account an administrator? (none may be)

Exits non-zero on the first category of failure, so it works in a script.

## `yarn demo:clean`

Deletes **only** what the seed created, driven entirely by the ledger
(`demo_seed_ledger`). It never matches on a username prefix, a metadata flag or
"posts belonging to a demo user" — all of which can be true of data this tool did
not create.

```bash
yarn demo:clean --dry-run   # print the plan, change nothing
yarn demo:clean
yarn demo:clean --purge     # also drop the ledger collection
```

One deliberate exception: **a comment or reaction a real user left on a demo post
is not deleted.** It is not in the ledger, it is not ours, and the summary
reports how many were left behind so a human can decide.

The media cache survives a clean, so re-seeding does not re-download.

## How idempotency works

`demo_seed_ledger` maps a stable seed key (`post:maitran.eats:3`) to the `_id` of
the document created for it. Before creating anything, the seeder claims the key
and gets back the `_id` it will use — so a second run finds the document already
there and skips it.

The ledger row is written **before** the document, with the id the document will
be given. On a standalone MongoDB there is no transaction to make the pair
atomic, so the ordering is what makes every interruption recoverable:

| Interrupted | Result |
|---|---|
| after the ledger row, before the document | clean deletes an `_id` that is not there — a no-op |
| after the document, before it is marked active | the row names it, so clean removes it |

The reverse order has a case neither can recover: a document that exists and
nothing knows about.

## Layout

```
demo/
  demo.config.js        sizes, limits, pacing — everything tunable
  themes.js             themes, personas, captions, comment pools
  fetch-media.js        phase 1 entry point
  seed.js               phase 2 entry point
  verify.js             read-only health check of a seeded dataset
  clean.js              removal
  media/                downloaded media + manifest.json (git-ignored)
  lib/
    logger.js           output with unforgettable credential redaction
    env.js              key loading; registers secrets as unprintable
    random.js           seeded PRNG — no Math.random anywhere in this feature
    http.js             retries, timeouts, per-provider pacing, downloads
    providers/pexels.js primary source (key travels in a header)
    providers/pixabay.js fallback (key must go in the query string; see notes)
    validate.js         policy + shape validation from real bytes
    ffmpeg.js           ffprobe/ffmpeg wrappers, bounded and timed out
    png.js              minimal PNG encoder (no new runtime dependency)
    avatar.js           procedural avatar generation
    manifest.js         the phase-1/phase-2 contract and provenance record
    fetcher.js          slot filling, provider order, de-duplication
    plan.js             deterministic dataset plan, built before any write
    db.js               Mongo access and collection names
    ledger.js           what this tool created — the basis for clean
    file-pipeline.js    the real file-server upload client
    seed-accounts.js    accounts, avatars, covers, auth
    seed-posts.js       posts, media, thumbnails
    seed-interactions.js follows, likes, comments, replies, shares
    reconcile.js        counter and tag-summary recomputation
    *.spec.ts           idempotency and password-format regression tests
```

## Credential handling

- Keys are read from `api/.env` only — never a CLI flag (shell history, `ps`) and
  never a config file (git).
- `lib/logger.js` redacts every registered secret from everything printed,
  including error messages and stacks. It is done in the sink, not at call sites,
  because the way a key reaches a log is an exception nobody expected to print.
- It also strips `?key=`/`&api_key=` patterns independently of the registered
  list. Pixabay accepts its key only as a query parameter, which makes the
  request URL itself a secret — so no Pixabay URL is ever logged, and the
  manifest stores the public page URL instead.

## Licences

| Source | Licence | Attribution |
|---|---|---|
| Pexels | [Pexels License](https://www.pexels.com/license/) | not required |
| Pixabay | [Pixabay Content License](https://pixabay.com/service/license-summary/) | not required |
| Avatars | generated by this repository | n/a |

Attribution is recorded in the manifest for every file regardless, because "not
required" is not "not owed", and a dataset that cannot say where a file came from
cannot be audited later.
