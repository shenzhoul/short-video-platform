---
name: demo-dataset
description: The two-phase demo content system under api/demo — fetching licensed stock media from Pexels/Pixabay with provenance and policy validation, seeding accounts, posts and interactions idempotently through the real upload pipeline, and removing exactly what was seeded. Use when changing demo:fetch-media, demo:seed, demo:clean, the media manifest, the seed ledger, or when building any other fixture/seed tooling in this repo.
---

# Demo Dataset

## When to Apply

Anything touching `api/demo/` — the themes, the fetch, the seed, the clean, the
manifest or the ledger. Also load it before writing *any* new seeding or fixture
tooling: the ledger pattern and the recompute-don't-increment rule below are the
reusable parts, and getting either wrong produces data nobody can safely remove.

Load `.agents/skills/file-service-integration/SKILL.md` alongside it — every
demo file goes through that pipeline and obeys its reference-ordering rules.

## 1. The phases are separate because the network is a dependency

`demo:fetch-media` talks to providers and writes only to disk.
`demo:seed` reads the manifest and writes only to MongoDB and the file server.

**The seed must never gain a provider dependency.** It has no API key loaded, no
provider module required, and no URL to call — `env.loadSeedConnections()`
deliberately does not read `PEXELS_API_KEY`, because reading it would be a lie
about what the script needs. A seeder that re-fetches on every run costs a
provider a request per developer per run and stops working on a train.

If a future change needs new media at seed time, that is a change to phase 1 and
a re-run of it, not a fetch inside phase 2.

## 2. The ledger is what makes cleanup safe

`demo_seed_ledger` maps a stable seed key (`post:maitran.eats:3`) to the `_id` of
the document created for it. `demo:clean` deletes ids from that ledger and
nothing else.

**Never replace it with a shape match.** Every weaker alternative was considered
and each has a case where it deletes somebody's real data:

| Alternative | Fails when |
|---|---|
| a `metadata.demo` flag | a real account is imported with the same flag, or the flag is copied |
| a username prefix | a real user picks the prefix |
| "posts belonging to a demo user" | fine for posts — but the same reasoning applied to *comments* deletes a real user's comment on a demo post |

The ledger answers "did we create this?", which is the only question whose wrong
answer is recoverable. The visible consequence is deliberate: a real user's
comment on a demo post survives `demo:clean` and is reported in the summary.

**Ledger row before the document, carrying the id the document will get.**
MongoDB here is standalone — no transactions — so the ordering is the safety
mechanism:

- interrupted after the row, before the document → clean deletes a missing `_id`, a no-op;
- interrupted after the document, before activation → the row names it, clean removes it.

The reverse order has an unrecoverable case: a document that exists and nothing
knows about. For file-server ids, which we do not choose, record the id the
moment it exists and before the bytes are sent; anything stranded in that window
carries no reference and the unused-file sweeper collects it.

## 3. Recompute counters, never increment them

A seeder is expected to run twice. The services increment because each live event
happens once; a seeder that increments either doubles every counter on the second
run or has to know exactly which rows were new — one bug away from a profile
showing 40 followers and listing 20.

`lib/reconcile.js` counts the rows that exist. Same rows, same number, so the
second run changes nothing.

Get the semantics from the listeners, not from the field name:

- `post.totalComment` **includes replies** — `comment.listener.ts` increments the
  post for a top-level comment and again for a reply, through the reply's parent.
- `comment.totalReply` counts direct replies only.
- `user.stats.totalPosts` is `$set` from a count of *active* posts
  (`user-assests.listener.ts`), not incremented.
- `user.stats.totalLikes` is likes received across the creator's content.
- `post.totalShare` counts distinct sharers; share reactions are never removed.

Scope every recompute to ids this tool created. A recompute is a write, and this
feature has no business writing to data it does not own. The one exception is
`reconcileTags` — a tag summary aggregates every post carrying the tag, so it
must read the whole collection or it produces a wrong number when demo and real
posts share a hashtag.

## 2b. Cleanup is not done until the *bytes* are gone, and that must be checked

`demo:clean` removes file records through the file server's `batch-delete`,
which deletes the stored bytes and the record together. It used to report the
count that call returned and stop there — "336 files removed from the file
server" would have been printed whether or not a single byte left the disk.

It now asks again: after deleting, `find-by-ids` is called for the same ids, and
the run only claims success when **none** of them still resolves. Any that
survive are named, and their ledger rows are **kept**, because dropping the row
would strand the bytes with nothing left pointing at them — the one state
nothing can ever collect.

Verify a clean from outside the tool as well:

```bash
find file-server/public -type f | wc -l     # 0 after a full clean
du -sh file-server/public                   # 0 bytes
```

Measured on 2026-09-02: a clean took the store from 959 files / 1140 MB to 0.

Files uploaded by *tests* rather than by the seeder sit outside the ledger, so
`demo:clean` correctly refuses to touch them — and a comment image whose comment
was later deleted keeps a reference to a row that no longer exists, so the
unused-file sweeper skips it too. Remove those explicitly, by id, through the
file server's API.

## 3b. Every counter the product maintains needs a line in `reconcile.js`

"Recompute, never increment" only helps for the counters that are actually in
the file. `comment.totalLike` was not, and nothing else wrote it — so the
dataset carried comment-like reactions, `comment_like` notifications naming
them, and comments reading zero likes. Four rows, a counter at nought, no error.

Nothing downstream could have caught it: the DTO exposed the field correctly,
the client read the right field, and `demo:verify` checked `totalReply` on the
very same document without looking at `totalLike`.

Before finishing a seeder change, list the counters the product maintains and
check each one has both a line in `reconcile.js` and an assertion in
`demo:verify`:

| Counter | Production writer |
|---|---|
| `post.totalLike` / `totalComment` / `totalShare` | `reaction.listener.ts`, `comment.listener.ts`, `post-share.service.ts` |
| `comment.totalReply` | `comment.listener.ts` |
| `comment.totalLike` | `comment-reaction.listener.ts` |
| `user.stats.*` | `user-assests.listener.ts`, `follow-stats.listener.ts` |
| conversation preview / unread | `message` services |

`demo/lib/comment-like-counter.spec.ts` fails against the version that omitted
the like count.

## 4. Media decisions come from bytes and from the shared policy

`lib/validate.js` reads limits from `@douyin-clone/upload-policy`, the same module
the API and file server read. Do not hardcode a number here — a policy tightened
in the registry must tighten the fetch too, or phase 1 starts caching files phase
2 cannot upload.

- Format from a magic-byte sniff. Never the extension, the URL, or `Content-Type`.
- Bytes, each side, total pixels, duration, frame rate and codec bounded separately.
- Images fully decoded — a header describes an image a truncated file may not contain.
- Video probed with ffprobe, ignoring `attached_pic` streams, **and** a frame near
  the end decoded. A truncated faststart MP4 reports a full duration from its
  header and only fails on the transcode queue, minutes later.
- Never validate video with the image validator, or vice versa.

Dataset-shape preferences (portrait for posts, landscape for covers, 30s/30MB for
video) live in `demo.config.js` and are kept **separate** from the policy in the
code, because they answer different questions: the policy says what the product
accepts, the config says what this dataset is worth.

## 5. Provider rules

- **Pexels primary, Pixabay fallback.** Enforced structurally in `fetcher.js` as
  two sequential passes, not as a per-candidate preference a later edit could
  weaken into "whichever answers first".
- **Pexels takes its key in a header. Pixabay only accepts `?key=`**, which makes
  a Pixabay request URL a secret. No Pixabay URL is ever logged; the manifest
  stores the public `pageURL`.
- **Never hotlink.** Download, then serve from our own file server. Pixabay's
  terms require this; Pexels' CDN is not ours to use as a backend.
- **Never scrape** Google Images, Pinterest, TikTok, Instagram or YouTube.
- Pace requests. The quotas are generous and are not the reason — a script that
  opens every socket it can is rude to a service giving its API away.

## 6. Avatars are drawn, never photographed

`lib/avatar.js` renders abstract marks with a hand-written PNG encoder
(`lib/png.js`) — no image dependency added to `api/package.json`, which is a
production dependency tree.

A stock photograph of a real person as a fictional account's avatar presents an
identifiable human as the owner of an account they never heard of. The licence
covers the image, not that claim. A synthetic face is not better: a viewer cannot
tell it is synthetic, so the same false claim is made. Covers may be stock — a
landscape behind a header claims nothing about who owns the profile.

## 7. Determinism, everywhere — and the stream must not depend on the database

`Math.random()` must not appear anywhere in this feature. Every choice — avatar
pattern, caption assignment, follow edges, popularity, timestamps — comes from
`lib/random.js` seeded on a stable key.

**Draw before you check.** A seeded generator only stays reproducible if the
sequence of draws is fixed. Putting a draw inside `if (row does not exist)` makes
the stream depend on the database: the branch is skipped on the second run, every
later draw shifts, and decisions that were "no" become "yes".

This shipped once. The reply block drew four values inside such a branch, and a
re-run added 26 replies while reporting every other row as already present — and
the counters were *still correct afterwards*, because `reconcile.js` recomputes.
Nothing looked wrong; only counting the rows caught it.

```js
// WRONG — the stream depends on what is already stored
if (!await db.comments.findOne({ _id })) {
  const authorReplies = random.chance(0.7);   // skipped on the second run
  ...
}

// RIGHT — draw unconditionally, then decide whether to write
const authorReplies = random.chance(0.7);
if (!await db.comments.findOne({ _id })) { ... }
```

`demo/lib/seed-interactions.spec.ts` fails on exactly this.

**And neither may the *inputs* to a decision.** The same rule reaches past the
random stream: anything the seeder chooses must be derived from the plan, not
read back from what is already stored.

`seedPrimaryShowcase` picks three partners for the primary account's example
threads and must avoid the partners the ring and the chords already use. It
asked the database which pairs were taken. That is correct exactly once — on a
second seed its own three threads counted as taken, so it chose three *different*
partners and created three more conversations, six participant rows, four
messages and two more block/restrict rows.

```js
// WRONG — "taken" grows every time the seeder runs
const taken = new Set((await conversations.find({ recipientIds: primaryId })...));

// RIGHT — the same pairs the ring and chords use, computed from the plan
const structural = ringAndChordPartnersOf(plan.accounts, primary.username);
```

Nothing failed. `demo:verify` passed both times, every adapter reported honest
no-ops, and the only thing that caught it was **comparing the two summary
blocks line by line**: `conversation: 35 → 38`, `relationship: 2 → 4`. Run
`demo:seed` twice and diff the summaries; that is the idempotency test, and it
is not optional. `demo/lib/showcase-partners.spec.ts` fixes the property in
place.

## 7b. Derive every denormalised field the way the service derives it

A seeder writes rows a service normally writes, and every field it fills in by
hand is a chance to diverge from the product. The expensive one here was the
post cover.

`PostCrudService.create` resolves covers as:

```js
cover4x3Url = uploadedThumbnail ?? generatedThumbnail ?? mainFile.url
cover3x4Url = generatedThumbnail ?? cover4x3Url
```

The seeder wrote `mainFile.url` for both. For a photo post that is the processed
original — 4160x6240, 3.2MB, 26 megapixels — downloaded and decoded to fill a
feed card about 265 CSS pixels wide. The generated thumbnail the file server had
already produced for the same image is 7KB.

Nothing looked broken. The feed rendered, the images were right, `demo:verify`
passed. It surfaced only as a **performance** symptom: scrolling the feed spent
seconds in long tasks, and an A/B that suppressed image painting reduced the
same gesture to 0ms — which is what identified paint, and then the covers, as
the cause. Correcting the seeder moved the worst frame from 800-1500ms to
83-183ms before any rendering work was touched at all.

When seeding a denormalised field, read the service that owns it and reproduce
its expression, including its fallbacks. `demo/lib/seed-posts.js` carries the
resolution and `normalizeThumbnailUrls`, mirroring `FileServerInfoDto`.

## 8. Write credentials in the current format, not the one a script used to use

`seed-accounts.js` writes **scrypt**, matching
`api/src/services/identity/auth/password-hasher.service.ts`. The legacy salted
SHA-256 scheme is verify-only — "nothing in the codebase writes this format any
more" — and the first version of this seeder reintroduced it by copying
`api/scripts/reset-admin-pw.js`, which predates the migration.

Logins still worked, because the lazy upgrade path caught them. That is what
makes it easy to miss: a seeder writing a deprecated format leaves every
developer's database exercising a migration path that should be seeing no new
traffic at all.

Two layers, because that is what a real login sends: the browser SHA-256s the
plaintext, the server scrypt-hashes what arrives. The parameters are duplicated
into plain Node, so `demo/lib/password-format.spec.ts` verifies a seeder-produced
credential against the real `PasswordHasherService` — drift fails a test rather
than sixteen accounts.

**Before copying an existing `api/scripts/*.js`, check whether the thing it does
has since moved.** `.agents/bug-tracker/README.md`'s resolved section is the
fastest way to find out.

## 9. A seeder replays history; production delivers events once

This is the difference that produced the two hardest bugs in this feature, and
it generalises to any fixture tool that mirrors an event-driven system.

`NotificationService.applyAggregate` folds **one** event into a group, using
`lastEventId` to make a redelivery a no-op. Mirroring that literally and calling
it once per like looked right and failed twice on the second run:

- for the newest event the filter `lastEventId: { $ne: eventId }` matched
  nothing, so the upsert tried to *insert* — straight into the unique
  `(recipientId, groupKey)` index;
- every older event still matched, so the group was re-folded and `read` was
  reset, destroying the read state the previous run had set.

The fix is not a retry. It is to stop replaying: group the events, compute what
the aggregate should look like (**newest actor, newest event id, how many events
it stands for**) and write that once. Idempotency then comes from comparing
`lastEventId` — same newest event means nothing happened, so leave the row
completely alone.

**Corollary: seed only states the product can reach.** The showcase threads
originally reused conversations the ring had already built, producing a
"pending" conversation holding five messages from both sides — a state
`claimSendSlot` cannot produce. And a block dated *before* the messages it was
supposed to prevent is equally impossible. `demo:verify` refuses both, which is
how they were found.

## 10. Report what this run did, not what the dataset contains

`sendMessage` returned the existing id when a row was already there, so a
second run reported "32 conversations, 112 messages" while creating nothing. The
counts a seeder prints are the evidence for its idempotency claim; a helper that
cannot distinguish "wrote it" from "it was already there" makes that evidence
worthless. Return `null` for a no-op and count only truthy results.

## 11. Credentials

Keys come from `api/.env` only. Never a CLI flag (shell history, `ps` output),
never a config file (git).

`lib/logger.js` redacts in the **sink**, not at call sites, and every print path
goes through it. A key reaches a log through an exception nobody expected to
print, so "remember not to log it" is not a mechanism. It also strips
`?key=`/`&api_key=` patterns independently of the registered list.

## Current References

- `api/demo/README.md` — full internals
- `docs/features/demo-dataset.md` — product/operator documentation
- `api/demo/demo.config.js`, `api/demo/themes.js` — everything tunable
- `api/demo/lib/ledger.js`, `api/demo/lib/reconcile.js` — the two reusable patterns
- `api/demo/lib/file-pipeline.js` — the real upload client
- `api/demo/lib/validate.js` — policy-driven validation

## Verification

There is no substitute for looking at it:

1. `yarn demo:fetch-media` — all slots satisfied, no shortfall.
2. `yarn demo:seed` — with the file server running.
3. `yarn demo:seed` **again** — must create nothing and must not move a counter.
4. Open a profile and the home feed: avatar, cover, photos, video playback,
   video posters.
5. `yarn demo:clean --dry-run`, then `yarn demo:clean`, then confirm the
   pre-existing accounts and posts are untouched.

## Seeding derived data (recommendation histories)

Some of what the dataset needs is not a row a person authored but a row the
*product* would have derived from behaviour — `post_recommendation_stats` and
`user_recommendation_affinities` are the current example. Three rules, each
learned by getting it wrong first:

1. **Never write the aggregate. Replay the behaviour through production
   logic.** `demo/lib/recommendation-adapter.js` `require`s the *compiled*
   policy (`dist/common/constants/recommendation.js`) and applies the same
   classification `RecommendationEventService` does, so the fixture cannot
   drift from the engine when a weight moves. Writing the totals directly is
   less code and produces numbers that are whatever the seeder decided —
   plausible, and wrong the moment the real rule changes. A missing build is a
   hard error, not a fallback to copied constants.

2. **Read derived inputs from where the product reads them.** Watch times were
   first generated against the media manifest's ffprobe measurement; the engine
   scores against `post_media.durationMs`, which is the *transcoded* file's
   duration. They differ by a few percent, so every seeded ratio silently
   disagreed with what the engine computed for the same event.

3. **A TTL index does not care that your data is a fixture.**
   `recommendation_events` expires on `expiresAt`. Seeded events are dated back
   weeks so the history reads as real — anchoring the TTL to that historical
   date puts it in the past, and MongoDB deleted 584 of 2,674 rows (22%)
   minutes after seeding, leaving aggregates with nothing left to justify them.
   Anchor retention to ingestion time.

`demo:verify` re-derives the aggregates from the raw events through that same
adapter rather than asserting hand-written numbers. A hand-written expectation
encodes the seeder's mistake twice and passes.

Also worth knowing: thresholds in the product can make a fixture unable to
demonstrate the thing it exists to demonstrate. The cold-start exploration
bonus is staged by lifetime impressions with a threshold of 20; at ~6
impressions per post *every* post carried the full bonus and the deliberately
cold posts were indistinguishable. The fix was more seeded exposure, not a
different bonus.
