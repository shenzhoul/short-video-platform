---
name: recommendation-engine
description: Heuristic recommendation engine for Home/Topic and For You (candidate retrieval, scoring, diversity re-ranking, Redis feed sessions and session chains, and impression/watch event tracking) and the Post Detail recommendation sessions built on it — including picture-in-picture next/previous. Use when changing Home/For You ranking, candidate sources, scoring weights, session pagination or rollover, recommendation event ingestion, or Post Detail / PiP next/previous for non-creator-scoped sources.
---

# Recommendation Engine

Heuristic and explainable, built from publicly documented signal categories (interactions, watch
time, affinity, freshness, engagement quality, cold-start exploration, diversity, session
stability). **Never describe this as "the TikTok algorithm"** in code, comments, docs, or commit
messages — it is a from-scratch heuristic ranker, not a reproduction of any platform's proprietary
system.

## Invariants

- Keep every score feature normalized to a bounded `[0,1]`-ish range before the weighted sum
  (`RecommendationScoringService`). Never add a raw `totalLike`/`totalComment`/`totalShare` directly
  into `finalScore`.
- Keep the five candidate quotas (`personalized`/`trending`/`fresh`/`social`/`diverse`) and the seven
  score weights each summing to 1, validated by `assertValidRecommendationWeights()` in
  `api/src/common/constants/recommendation.ts`. Tune by editing that one file, not by scattering
  constants across services.
- Never use `$sample` for random/diverse candidate sampling at this collection size — it is a full
  collection scan. Use the indexed `Post.recoShuffleKey` range-scan pattern in
  `RecommendationCandidateService.sampleByShuffleKey` instead.
- Never use pinned state (`isPinned`/`pinnedAt`) as a Home/For You ranking input. Pinning is a
  creator-profile-only signal (`buildEligibilityMatch` deliberately omits it).
- Exclude blocked-either-direction creators via `UserRelationshipService.getBlockedEitherDirectionIds`.
  Never use `restrict` for feed exclusion — it is a messaging-only signal in this codebase (audited:
  every current caller of `restrictedByMe`/`restrictedMe` is inside the messaging domain). Extending
  `restrict` to hide feed content would silently change its product meaning.
- Compute heavy aggregates (category engagement priors, hashtag trends) asynchronously on a schedule
  into a small bounded collection, mirroring `TagTrendingService`/`TagTrendingJob` —
  `RecommendationCategoryPriorService`/`RecommendationCategoryPriorJob` recompute
  `recommendation_category_priors` hourly from `post_recommendation_stats`, never from the raw
  `recommendation_events` log and never on the scoring read path. A simple bounded `$inc` per event
  (impressions, watch sums) is the same class of write as the existing inline `Post.totalLike` bump
  and stays on the request path.
- Session state (the ranked order for one Home/For You session, and one Post Detail sequence) lives
  in Redis, never recomputed per page. A session's whole ranked list is generated once
  (`RecommendationSessionService.create`) and every later page is a stateless `LRANGE` keyed by an
  opaque numeric-offset cursor — this is what makes concurrent "load more" calls safe without a lock.
  Reload (no `sessionId`) always creates a new session; continuing a `sessionId` always returns the
  same order.
- **The candidate pool and the session output are separate numbers, and must stay separate.** They
  were once the same (`FEED_SESSION_POLICY.maxItems` served as both), which on a 160-post catalogue
  meant a session *was* the catalogue: ten guest reloads produced ten orderings of one fixed set, all
  led by the same post, because deterministic scoring plus a ±0.03 tie-break jitter cannot move a
  leader. `SESSION_OUTPUT_POLICY` now names `candidatePoolLimit` (retrieval — keep this generous),
  `homeSessionItemLimit`, `forYouInitialSessionLimit`, the hero window and the cooldown. Never make
  the session limit approach the pool limit "to avoid refilling"; that reintroduces the defect.
- **Session output is a seeded weighted sample, not the top-N prefix.**
  `RecommendationSelectionService.select` draws without replacement with probability proportional to
  `finalScore ** samplingExponent` (Efraimidis-Spirakis keys, `u ** (1/w)`), plus a small floor so the
  long tail stays reachable and exploration does not quietly stop. Ranking still governs *likelihood*;
  it no longer governs the outcome identically every time. The randomness is the session seed — never
  `Math.random()` — so pagination inside a session stays replayable.
- **The guest subject is issued by `user/src/proxy.ts` at the edge**, before any
  server component renders, and set on the request as well as the response. A
  render with no subject builds a throwaway session the client then abandons —
  two sessions and 78-86 cards for a 70-item policy on a first-ever visit. The
  value is bounded and shape-checked (`isValidRecommendationAnonymousId`, and
  `@Length(8,64) @Matches` on `PostRecommendationRequest.anonymousId`) because it
  becomes a Redis key segment and a session owner; it is never logged.
- **A feed session belongs to the subject that created it, so every request must
  carry that subject.** `RecommendationSessionService.getPage` returns `null`
  when `meta.subjectId` does not match, and `getFeed` then silently *creates a
  new session* rather than erroring. A client that omits `anonymousId` therefore
  gets a brand-new ranking on every page and can never reach the end of one.
  Measured in a production build before the fix: a guest scrolling Home opened
  **five sessions in seven scrolls**, was served 100 rows containing 43 distinct
  posts, and `hasMore` never went false; For You opened **41 sessions in 56
  steps**. Both feed hooks now send `getRecommendationAnonymousId()` on every
  request, and both server renders read the same id from its cookie mirror.
- **The server render must use the same subject as the client.** The guest id
  lives in `localStorage` and is mirrored to a cookie so `next/headers`
  `cookies()` can read it; the constant naming that cookie lives in
  `user/src/constants/recommendation-anonymous-id.ts` with **no `'use client'`
  directive**. Importing it from the `'use client'` module instead compiled,
  linted and ran — and was `undefined` on the server, because Next replaces a
  client module with a client *reference* when a server component imports it. The
  cookie read asked for `undefined`, found nothing, and every server-rendered
  page built a throwaway session the browser then abandoned. Verified by asserting
  the Redis session's `subjectId` after an SSR request carrying the cookie.
- **The lead post is chosen separately and pinned after re-ranking.** It is a seeded weighted draw
  from the top-scoring window only (never the whole pool: an arbitrary post in the most valuable slot
  is a worse failure than always picking the best one), minus a per-subject Redis cooldown of recent
  leads (`REDIS_KEYS.recoRecentHeroes`, keyed by feed type *and* subject, TTL'd, trimmed — a cooldown,
  never a ban). It is passed **into** `rerank` as `{ lead }`, not spliced in afterwards: the lead comes
  from the top-scoring window, which is exactly where one creator or category concentrates, so
  inserting it after the diversity pass meant the emitted order was never the order that was checked —
  it could open with two posts by the same creator or begin a batch already over its creator cap.
  `rerank` emits the lead first and counts its creator, category and source before choosing anything
  else. Guests with no stable identity skip the cooldown entirely — an ephemeral key names nobody.
- **The sampler enforces a per-creator ceiling, because re-ranking cannot fix composition.** Weighted
  sampling by score alone is blind to authorship: on a pool where one creator held the top 30 of 160,
  the session itself was dominated by that creator and the emitted order breached the two-per-batch
  cap inside the first two batches while 130 posts from twelve other creators sat unselected. The
  ceiling is what the diversity policy implies — `ceil(limit / batchSize) * maxSameCreatorPerBatch` —
  with an overflow pass so a catalogue genuinely dominated by few creators still fills the session.
  Verified over 1,000 seeds per shape in `recommendation-lead-diversity.spec.ts`.
- All `Math.random()`/non-deterministic entropy in scoring or diversity must go through
  `seededUnitInterval`/`seededJitter` (`recommendation-hash.util.ts`), seeded by the session — jitter
  and tie-breaking must replay identically for the same session/input, never differ per page/request.
- The diversity re-ranker (`RecommendationDiversityService.rerank`) must never silently give up on a
  constraint just because a disqualified run is longer than its lookahead window — it falls back to
  scanning the *entire* remaining candidate list before conceding a violation is truly unavoidable.
  (This was a real bug: a lookahead-only fallback let a spammy creator's run exceed the window and
  flood a whole output batch. Covered by
  `recommendation-diversity.service.spec.ts`.)
- Recommendation telemetry (`RecommendationEventService.ingest`) is the *only* place
  `like`/`comment`/`share`/`follow_after_view` recommendation signal is recorded — it does **not**
  subscribe to `REACTION_CHANNELS`/`COMMENT_CHANNELS`/`SHARE_CHANNELS`. `SHARE_CHANNELS.SHARE` in
  particular only fires on a retry path (`PostShareRecordListener`), not on every share, so it cannot
  be used as a complete signal source. The client fires a recommendation event alongside the real
  reaction/comment/share/follow call; the platform's real counters (`Post.totalLike`, etc.) stay owned
  by `ReactionService`/`CommentService`/`PostShareService`, unchanged.
- Dedupe recommendation events per `(subjectId, sessionId, postId, eventType)` for exposure-once event
  types (impression, view, final_watch, completion, quick_skip, photo_dwell, detail_open, like,
  comment, share, follow_after_view). `watch_progress` is left un-deduped (a heartbeat only, never fed
  into stats). `replay` is legitimately repeatable within one exposure, so it is **not** deduped the
  same way — see the dedicated bullet below.
- **`replay` dedupes per *occurrence*, not per exposure.** Its key includes
  `RecommendationEventItemPayload.clientExposureId` — a client-generated id naming one detected replay
  crossing, reused automatically if the client-side event queue retries that exact enqueued event (see
  `recommendation-event-queue.ts`'s requeue-on-failed-flush) — so a network retry of replay #2 dedupes
  while a genuine replay #3 (a different id) is counted. An item with no `clientExposureId` (an older
  client) gets no dedupe key at all rather than a guessed one. Independently,
  `RECOMMENDATION_EVENT_POLICY.maxReplaysCountedPerExposure` bounds how many *distinct* occurrences per
  `(subject, session, post)` ever move stats/affinity — seeded from an aggregate over **persisted**
  history (`RecommendationEventService.ingest`'s `replayCounts` pre-query), not just the current batch,
  so splitting seek-spam across several requests cannot get around it. Beyond the cap the raw event is
  still stored (audit trail), it simply stops scoring — same treatment as an unverified `completion`
  below, and for the same reason: a rejection here would need the client to handle an error for
  something that is not actually invalid, just no longer interesting.
- **`completion` is never trusted as an event *type* alone.** It is only credited when this event's own
  `watchMs`, run through the same canonical-duration-derived `watchRatio` `final_watch` uses, actually
  clears `WATCH_QUALITY_POLICY.video.completionMinRatio`. A legacy post with no canonical duration
  (`watchRatio === null`) can never satisfy this, so it can never be counted "complete" no matter what
  the client sends. An unverified claim is still stored as a raw audit row (honest record of what was
  claimed) but produces no stat/affinity effect.
- **Quick-skip is never a value the client sends or the server trusts as a flag** — it is a
  classification the server derives from `final_watch`'s own clamped `watchMs`/`watchRatio`
  (`isVideoQuickSkip`: low ratio *and* low absolute ms, both required — a short video watched mostly
  through has a high ratio despite a low absolute ms, and must not be flagged) or `photo_dwell`'s
  `dwellMs` (`isPhotoQuickSkip`). "Never started" (autoplay blocked, or the viewer scrolled past before
  any progress) produces no `final_watch` at all — see `hasStartedRef` in
  `useRecommendationWatchTracking` — which is a real, distinct, unpunished case, not a quick skip.
- **A repeat `final_watch` for the same exposure must actually reach the server for the pause-then-
  resume case to matter.** `useRecommendationWatchTracking.flushFinalWatch` tracks a *watermark*
  (`lastFlushedWatchedSecondsRef`), not a one-shot "already sent" latch — a pause at 2s flushes, resuming
  and watching to 8s before the next pause/unmount must flush again with the larger number, or the
  server's delta-merge logic (`finalWatchEffects`) never has anything to correct. This was a real bug:
  the original one-shot latch (`finalWatchSentRef`) silently blocked every flush after the first one for
  an exposure, making the server-side "upgrade an earlier low watch" path dead code in practice. Covered
  by `use-recommendation-watch-tracking.spec.tsx`'s "sends a second, larger final_watch after pause ->
  resume -> pause again" test.
- **Out-of-order/late delivery must never regress a stored counter.** A `final_watch`/`photo_dwell`
  flush reporting *less* than what is already on record for that exposure (a stale retry, a late
  `keepalive` arriving after a newer flush already landed) is a pure no-op — `finalWatchEffects`/
  `photoDwellEffects`' `if (ratio <= oldRatio) return skip`. Two genuinely distinct exposures of the
  same post (different `sessionId`) are never merged with each other; each gets its own full sample.
- **A `comment` signal is verified against the real comment, never taken on the event type.**
  `RecommendationEventItemPayload.commentId` is required for it, and
  `RecommendationEventService.validateComment` re-reads that comment to check it exists, that
  `createdBy` is the authenticated actor, and that it belongs to this post — directly
  (`objectType: 'post'`) or, for a reply, through its parent (`objectType: 'comment'` -> that parent's
  own `objectId`). A reply therefore produces exactly **one** comment signal against the post, never a
  root-comment signal *and* a reply signal. The dedupe key is `(subject, post, commentId)` with **no**
  session component, so a retry — or the same comment id resent from a later session — cannot re-earn
  it, while a genuinely second comment (its own real id) counts.
  `RECOMMENDATION_EVENT_POLICY.maxCommentsCountedPerPost` bounds the comment/delete/repeat case.
  Deleting a counted comment never decrements anything: the engagement happened, and a decrement here
  would be both racy and gameable in the other direction.
- **Fire `comment` only from `CommentWrapper`'s `onCommentCreate`** (`comment-wrapper.tsx`'s
  `handleCreateComment` success branch — the single funnel for both a root comment and a reply, in
  both detail layouts). Never from `onTotalChange`/a `totalComment` change: that is also exactly what
  somebody else's comment arriving over the socket looks like, and firing there would credit other
  viewers' comments to the local viewer's affinity. The chain is
  `CommentForm.onSubmit` -> `handleCreateComment` -> `useComments.createComment` ->
  `createCommentApi` -> `onCommentCreate(newComment)` ->
  `useRecommendationDetailTracking.trackCommentCreate` (both `PostDetailModal` layouts) or
  `ForYouFeed.handleCommentCreateWithTracking`.
- **A shared-post message open is a real message context, not Home.** The chain is
  `MessageThreadView` -> `MessageBubble.onOpenPost` -> `SharedPostCard.onOpen(postId)` ->
  `useOpenSharedPost`, which pushes `?modal_id=<postId>&modal_src=message` (falling back to `/` from
  `/messages`, which hosts no modal). `useHomeFeedPlayback` reads `modal_src` and labels the open
  `'message-shared-post'` instead of the generic `'direct-link'`; both are feed-scoped and both get the
  same anchor-based recommendation detail session, so the label changes attribution only. `modal_src`
  is cleared alongside `modal_id` when the modal closes, so it never outlives the open it describes.
- **"Media is ready" is a publish-time invariant, not a feed filter.**
  `assertPostMediaReady` (`api/src/services/content/post/post-media-readiness.util.ts`) is called from
  `PostCrudService.create` *and* the media-replacement branch of `.update`, and refuses a post whose
  referenced media is missing, `pending`/`processing`, `failed`, or in an unknown state — read from the
  file-server records the API fetches itself, never from what the publishing client claims about its
  own upload. Do **not** add a readiness clause to `buildEligibilityMatch` or to any candidate source:
  a post that reached `status: 'active'` has already been proven to have complete media, which is what
  keeps eligibility a single source of truth. (`Post.status` is only ever `'active'`/`'deleted'` —
  there is no draft/pending post in this domain, so there is no pending-to-ready transition for a read
  path to observe.) Covered by `post-media-readiness.spec.ts`.
- **`markSeen` must be told whether the subject is a real account.** It used to hardcode
  `isAuthenticatedUser: true` on insert. An impression is both the event that reaches `markSeen` *and*
  the one event carrying no affinity weight, so for a guest who browsed without interacting the
  mislabelled row was the only row ever written for them — every anonymous session in the database
  claimed to be an account. The schema now defaults the field to `false` for the same reason: the two
  possible errors are not symmetric, and overstating an anonymous session as an account is the one
  that misleads retention/export/deletion. Covered by `recommendation-affinity.service.spec.ts`.
- **Every post needs a `recoShuffleKey`, and a missing one fails silently.** Two of the five
  candidate sources — fresh discovery and diverse discovery — find candidates with an indexed range
  scan over that field, and a missing field never satisfies `$gte`. When the demo seeder omitted it
  (it writes posts through the raw driver, so the Mongoose `default` never fired), **both buckets
  returned nothing at all**: every feed was quietly built from the 14-day trending window alone, a
  guest session held 36 of 160 posts, all labelled `trending`, and nothing errored. The
  `1788000100000-backfill-post-reco-shuffle-key` migration repairs old rows; anything that creates a
  post outside `PostCrudService` must set the field itself. `demo:verify` now fails on a missing one.
- **A guest with no `anonymousId` still gets a feed.** `getFeed` used to throw, which the global
  filter turned into an unhandled 500 on `GET /posts/home-posts` — hitting the most ordinary caller
  there is, a first-time visitor whose client has not yet stored an id. It now falls back to a
  per-request `ephemeral:<uuid>` subject: no history is read, nothing is written back, and the mix is
  the documented guest one. `createSession` takes the *resolved* subject rather than recomputing it,
  so the session is registered under the key `getFeed` then pages back with.
- **Seen-suppression is a preference, never a guarantee.** Excluding `recentlySeenPostIds` keeps a
  session from repeating itself, but the buffer holds 200 posts and the catalogue may be smaller than
  that: a viewer with 140 of 160 posts seen was served **nothing**, and Home rendered its empty state.
  When the suppressed pool falls below `RELAXED_SUPPRESSION_MIN_POOL` and suppression is what caused
  it, retrieval is repeated without it. Showing somebody a post twice is a far smaller failure than
  showing them nothing. Every other eligibility rule still applies, and the relaxation logs itself.
- **Subject identity is always server-derived, never client-claimed.** `RecommendationEventItemPayload`
  has no `userId` field at all — `ContentService.recordRecommendationEvents` builds the actor solely
  from `@CurrentUser()` (`user?._id`), and an authenticated request's `payload.anonymousId` is ignored
  outright (`user?._id ? undefined : payload.anonymousId`) so a signed-in client cannot merge guest
  history into the account by also sending an anonymous id. A guest's `anonymousId` is still an opaque,
  client-chosen token (like a session id) — nothing here fingerprints a device, and the endpoint returns
  no data that would let one guest read another's identity, only accept writes attributed to whatever
  token is presented.
- Clamp `watchMs` server-side against `PostMedia.durationMs` — the ffprobe-derived, file-server-sourced
  canonical duration `PostMediaService.createMultiplePostMedia` populates at post-creation time —
  never against the client-reported `durationMs`, which `RecommendationEventService.clampWatch` does
  not even read for this purpose. A post whose primary video predates this field (`durationMs` absent
  — see `scripts/backfill-post-media-duration.js`) falls back to a safe absolute watch-time ceiling
  with no ratio/completion scoring, never the client's claimed duration.
- `final_watch`/`photo_dwell` are "upsert with delta" on a repeat flush for the same exposure (pause,
  then resume and watch more), not a second full sample and not a dropped duplicate — see
  `UPDATABLE_EVENT_TYPES`/`finalWatchEffects`/`photoDwellEffects` in `RecommendationEventService`. This
  was a real bug: the original "dedupe = first-flush-wins" design permanently under-reported anyone
  who paused early then kept watching.
- `follow_after_view` is verified against the real relationship (`FollowService.getFollowedAt`) and a
  real prior impression/view/detail_open within `FOLLOW_AFTER_VIEW_POLICY.attributionWindowMs` before
  any effect is applied (`RecommendationEventService.validateFollowAfterView`) — never trusted at face
  value. Its dedupe key is `(subject, creator)` with **no** session/post/time component, specifically
  so an unfollow-then-refollow cycle cannot re-earn the signal.
- A stat/priors/candidate query must always be batched (`$in`), never issued per-post in a loop.

## Browsing chains

A session is a bounded ranked **sample** of the candidate pool — 70 items of 160
(`SESSION_OUTPUT_POLICY.homeSessionItemLimit`). That bound stops a reload being
a re-sort of one fixed set. A **chain** is what strings sessions together so a
continuous scroll keeps finding posts it has not shown.

### Three identities, deliberately distinct

| Concept | Lives for | Owned by |
|---|---|---|
| subject (`viewerId` / `anonymousId`) | the account or guest cookie | personalisation |
| browsing chain (`chainId`) | one page load of one surface | `RecommendationChainService` |
| feed session (`sessionId`) | one ranked batch | `RecommendationSessionService` |

The **client** mints the chain id (`user/src/lib/browsing-chain.ts`), one per
page load per surface per Home category, and the SSR wrapper mints the one its
own render uses. A reload starts a fresh browse; two tabs never collide.

### Shared infrastructure, separate rankers

`RecommendationChainService` knows nothing about scoring, candidate sources,
quotas or diversity. Home and For You both use it and both keep their own
ranker, their own session size and their own personalization. Do not "unify"
the two feeds because they share a chain.

### Staged exclusion, and why there is no threshold any more

`deploy-2026-09-06g` excluded `chainSeen ∪ recentlySeenPostIds` and dropped the
whole suppression below ten surviving candidates. Measured in production:
Home stopped at **89** of 160, and a reload then stopped at **11** — because
`recentlySeenPostIds` held ~149 distinct ids and 11 is not below 10.

`createSession` now stages it:

1. `chain ∪ recentlySeen`, while it can fill a session;
2. `chain` only (chained callers), which also returns a short final batch rather
   than declaring the feed finished;
3. `chainExhausted: true` when the chain has served everything eligible.

`RELAXED_SUPPRESSION_MIN_POOL` remains, for unchained callers only.

### A chain ends; it does not recycle

`deploy-2026-09-06h` fixed the above by recycling an exhausted chain — reset the
seen-set, bump a cycle, serve the catalogue again. The client keyed each repeat
per cycle so React accepted it, and appended it as new: **Home reached 410 cards
on a 160-post corpus** and never stopped.

So an exhausted chain reports itself and stops, leaving its seen-set intact.
Starting over is the viewer's decision — "Refresh recommendations" or a reload —
and both mint a new chain id. There is no `cycle`, no recycle and no recent-tail
window any more; do not reintroduce them.

### Invariants

- **Write the seen-set when the order is fixed**, inside `createSession`, never
  from impression telemetry — telemetry lands late, and a rollover racing it
  re-ranks the page on screen.
- **A rollover skips `getPage`.** Reading the exhausted session answers with its
  last page again.
- **`resolve` checks the subject**, so a guessed chain id reveals nothing.
- **Bound the set** (`CHAIN_POLICY.maxSeenIds`) and TTL every chain key
  (`CHAIN_POLICY.ttlSeconds`), refreshed on read and write.
- **Report `chainExhausted`**; never infer the end of a feed on the client, and
  never invent more feed than exists.
- Cover: `api/src/services/content/recommendation/recommendation-chain.spec.ts`,
  driven against a 160-post corpus. The assertion that matters is **total served
  == distinct served**: a chain that repeats itself still reaches 160.

## Picture-in-picture navigates a detail session, never the DOM
## Picture-in-picture navigates a detail session, never the DOM
## Picture-in-picture navigates a detail session, never the DOM

`PopupPipState` used to carry a `playlist`: the Home grid's video posts **in rendered order**. "Next"
was therefore whichever card happened to sit below the one playing, and scrolling or closing the grid
changed what "next" meant.

It now walks the same anchor-based Post Detail session the detail viewer uses. There is no second
random algorithm, and there must not be one.

- `openPopupPip(video, options)` takes **no playlist**. Handing the window the surrounding grid would
  only give it a second, contradictory idea of "next".
- `PopupPipVideo.postId` exists so the PiP document can call the API. Do not go back to parsing an id
  out of `videoId` at call sites — `getPostIdFromPopupVideoId` survives only for reading state written
  before the field existed.
- `detailNext(..., videoOnly)` adds `{ $or: [{ type: 'video' }, { mediaTypes: 'video' }] }` to the
  eligibility match. **Append it to `$and`, never assign** — `buildEligibilityMatch` already owns that
  key, and overwriting it drops the already-seen and blocked-creator exclusions. Both fields are
  checked because stored data disagrees: `type` is the declared kind, `mediaTypes` is what the
  attachments are.
- "Previous" is PiP history only. It replays exactly what was shown and never calls the server, so the
  server cursor stays at the head and `stepForwardIfExists` correctly always computes a new candidate.
- Recycling is deterministic: when the server has nothing unseen left, "next" wraps to
  `history[0]`. Never a random pick from posts the viewer has just been through.
- One detail session per PiP browse. Opening a second resets the exclusions and starts recommending
  posts already in the history; `appendPopupPipVideo` carries the session id in the same write as the
  video for exactly that reason.
- The feed→PiP direction (`usePipFeedSync`) uses `pushPopupPipVideo`, which **drops** the session: the
  anchor it was built around is no longer what is playing.

Cover: `user/src/components/ui/popup-pip-navigation.spec.tsx`,
`api/src/services/content/recommendation/detail-next-video-only.spec.ts`.

## API workflow

1. `RecommendationFeedService.getFeed` is the single orchestrator for both Home and For You
   (`RECOMMENDATION_FEED_TYPES.HOME` / `.FOR_YOU`), called from `ContentService.getHomeRecommendedPosts`
   / `.recommendPosts`. Do not call `RecommendationCandidateService`/`RecommendationScoringService`
   directly from a controller — go through the feed service so eligibility, session creation and
   population stay consistent.
2. Extend `PostRecommendationRequest` (`api/src/payloads/content/post/post-recommendation.request.ts`)
   for new query parameters, not `PostSearchRequest` — Home/For You are no longer
   `PostSearchService`-backed. `PostSearchService`/`PostSearchRequest` remain owned by
   `Following`/`Friends`/creator profile searches; do not repoint those at the recommendation engine.
3. New event types go in `RECOMMENDATION_EVENT_TYPES`
   (`api/src/schemas/content/recommendation/recommendation-event.schema.ts`), the ingestion switch in
   `RecommendationEventService.ingest`, and the client payload enum
   (`RecommendationEventItemPayload`) together — the three must stay in lock-step.
4. New/changed weights, quotas or thresholds go in `api/src/common/constants/recommendation.ts`,
   never inline in a service.
5. Register any new schema in `api/src/schemas/content/recommendation/index.ts`,
   `api/src/schemas/mongoose-features.ts`, and add its indexes to a new migration mirroring
   `1788000000000-recommendation-engine-indexes.js` — do not rely on `autoIndex` alone for a query
   pattern against the large `posts` collection.
6. Post Detail sessions for non-creator-scoped sources go through
   `PostDetailRecommendationSessionService` (anchor + grow-on-demand list) via
   `RecommendationFeedService.openDetailSession`/`detailNext`/`detailPrevious`, exposed at
   `POST /posts/:id/detail-session`, `GET /posts/detail-session/:sessionId/next|previous`. This is
   separate from the Home/For You feed session (`RecommendationSessionService`) and from the
   creator-scoped sequence (`useCreatorVideos`) — never mix the three.

## User workflow

1. `useHomeFeedInfiniteScroll` and `useRecommendedVideos` both follow the same session-pagination
   contract: pass `sessionId` + `cursor` to continue paging (stable, never duplicates), omit both to
   start a new session (reload / category change / explicit `refresh()`). Do not reintroduce a
   `createdAt`/offset-based pagination scheme for either.
2. A Home category tab change must start a brand-new session scoped to that category — it is not a
   client-side filter over the existing session's posts.
3. `refresh()` on either hook is what "Refresh recommendations" calls, and it
   mints a **new chain** — a new browse of the whole catalogue, which is the
   only thing that makes already-served posts available again.
   `FEED_SESSION_POLICY.maxItems` remains the benchmarked-safe *rendering*
   ceiling (rules/user.md; do not reopen virtualization to raise it) and is not
   what a session holds: `SESSION_OUTPUT_POLICY` decides that.
   **Both** hooks treat a session as a segment: when it is spent they roll over
   with the same `chainId`, append, de-duplicate by **real post id**, and stop
   when the server reports `chainExhausted`. `hasMore` is
   `(hasMore || !catalogueSpent) && under the render ceiling`. Do not gate For
   You's prefetch on `hasMore` — that stops the feed dead at the end of the
   first segment.
3b. **Attribution follows the post id.** Both hooks keep a `sessionByPostId` map
   and expose `sessionForPost(postId)`. A chain crosses several sessions while
   earlier cards are still on screen; reporting their impressions under
   whichever session is newest files that evidence against a ranking that never
   chose them.
4. **Which media the For You stage draws is decided by the post, not by the surface.** `PostVideoStage`
   mounts the player only when `getPostVideo(post)` is non-empty and draws `PostGraphicStageMedia`
   otherwise. Rendering a `<video>` for a photo post was a real defect — React refuses `src=""`, so the
   viewer got a black rectangle with transport controls and the images were never drawn — and
   `src={url || ''}` is not a fix for it. `ForYouFeed` also filters its posts through
   `supportsPostDetail` (a post the stage cannot draw is skipped with a logged reason, never rendered
   as a dead slide the arrows still step onto), and routes watch tracking to video and
   `useRecommendationPhotoDwell` to photos.
5. `PostDetailSource` (`use-post-detail-sequence.ts`) includes `'for-you'` as a feed-scoped source —
   its sequence is the loaded For You session array, already in ranked order, so it never calls the
   Post Detail recommendation session. `'home-feed'` and `'direct-link'` (the label
   `useHomeFeedPlayback` gives every `modal_id`-driven open — a notification, a shared-post link, a
   bookmark, a PiP reopen all land here) instead use `useRecommendationDetailFeed`, which grows a
   `feedPosts` array against the anchor-based backend session
   (`PostDetailRecommendationSessionService`) and hands it to
   `usePostDetailSequence`/`usePostDetailNavigation` via their `feedPosts`/`posts` props.
6. **`useRecommendationDetailFeed` keys everything on the open post's *id*, never on the post object,
   and cancels only on a session change.** The object is replaced on every interaction patch, and
   opening a post fires a view count almost immediately — so with `currentPost` in the effect's
   dependency list, an ordinary `POST /posts/:id/view` response ran the cleanup and discarded a post
   that had *already been fetched successfully*, while the re-run that followed hit the in-flight
   guard and returned early. Nothing rescheduled it. Measured in a production build: the server handed
   out a third post (`/detail-session/:id/next -> 200`, `GET /posts/<id> 200`) while the Next control
   stayed disabled for good, ending the sequence at post two of a 160-post catalogue. It now refills
   `PREFETCH_AHEAD` (3) past the open post rather than only on reaching the tail, treats a repeated id
   from the server as exhaustion rather than an append, and exposes `hasMoreAhead` so the control does
   not report the end of the feed while a refill is in flight. Regression cover:
   `use-recommendation-detail-feed.spec.tsx` (4 of 10 fail against the old hook).
7. **For You attributes an event to the session that ranked the post, not the newest one open.**
   A session is a bounded segment, so a long scroll opens a second and third while posts from the
   first are still on screen. `useRecommendedVideos` returns `sessionForPost(postId)` and `ForYouFeed`
   keys every impression, watch, dwell, like, comment, share and follow on it. The first session to
   serve a post owns its attribution — a rollover that re-offers one must not relabel an exposure that
   was already logged.
8. Recommendation event tracking is wired at every surface: `HomeFeedCard`
   (`useRecommendationImpression`/`useRecommendationWatchTracking`/`useRecommendationCardDwell`),
   `ForYouFeed` (impression/watch, plus like/follow composed at its own action rail), and
   `PostDetailModal`'s two layouts via the shared `useRecommendationDetailTracking` hook
   (`detail_open` + like/share/follow composed with the real interaction handlers) and
   `useRecommendationWatchTracking`/`useRecommendationPhotoDwell` for video/photo. All of it funnels
   through one client-side batching queue (`recommendation-event-queue.ts`): batched up to 20 events
   or every 4s, retried once on failure, and flushed via `fetch(..., { keepalive: true })` — **not**
   `navigator.sendBeacon`, which cannot carry this app's bearer-token `Authorization` header at all —
   on `pagehide`/tab-hidden.
9. `PostVideoStage` forwards `onPause`/`onEnded` straight to the underlying `<video>`, purely
   additive — compose recommendation watch tracking into these alongside whatever the caller already
   does with `onTimeUpdate`, never replace the existing handler.
10. `RecommendationEventItemPayload.eventType` never includes a standalone `quick_skip` from the video
   or photo watch-tracking hooks — the server already derives quick-skip vs. not from
   `final_watch`/`photo_dwell`'s own `watchMs`/`dwellMs` (see `finalWatchEffects`/`photoDwellEffects`).
   A hook that also sent `quick_skip` would just be a redundant, unauthoritative echo.
11. A `replay` event from `useRecommendationWatchTracking` always carries a freshly-generated
   `clientExposureId` (`crypto.randomUUID()`, one per detected end-then-jump-back-to-start crossing) —
   this is what the server keys its occurrence-based replay dedupe/cap on (see the invariants above).
   Any new call site that enqueues a `replay` event must do the same; omitting it does not break
   anything but silently opts that call site out of retry-safe dedup.

## Demo dataset and verification tooling

- **The demo seeder reads the *compiled* policy, never a copy.**
  `demo/lib/recommendation-adapter.js` `require`s `dist/common/constants/recommendation.js` and mirrors
  `RecommendationEventService`'s own classification, so a seeded completion/quick-skip is one by
  exactly the rule the API applies, and changing a weight changes what the fixture produces. A missing
  build is a hard error rather than a fallback. Never write `post_recommendation_stats` or
  `user_recommendation_affinities` directly from seed code — go through the adapter.
- **Personas are data, never a branch in the engine.** `demo/lib/recommendation-personas.js` turns an
  account's own theme into a primary category plus two neighbours; the only output is
  `recommendation_events`. Delete the events and every account is identical again — that property is
  what proves the differentiation is learned rather than configured. The recommender must never know a
  username.
- **Seeded events anchor their TTL to *now*, not to the event's historical `createdAt`.**
  `recommendation_events` has a TTL index; a viewing dated back beyond the retention window has an
  `expiresAt` in the past and MongoDB deletes it minutes after seeding. This silently removed 584 of
  2,674 events (22%) on the first run, leaving stats with no events to justify them.
- **Watch times are generated against `post_media.durationMs`, not the media manifest.** They are
  different measurements (source file vs. the transcoded file the server actually serves), and the
  engine scores against the latter. Seeding from the manifest produced ratios that disagreed with the
  engine's by a few percent — plausible-looking and wrong.
- **Cold start needs the dataset to clear stage 0.** `EXPLORATION_STAGES.STAGE_0_MAX_IMPRESSIONS` is
  20, so with only ~6 impressions per post *every* post carries the full exploration bonus and the
  deliberately-cold posts are indistinguishable. `IMPRESSION_PASSES` spreads each viewer's exposure
  across two sessions, putting an ordinary post near 30 impressions while a cold-start post stays at 3.
- **`demo:verify` re-derives the aggregates from the raw events** through that same adapter rather than
  comparing against hand-written expectations, so seeder/policy disagreement fails the check instead of
  being encoded twice.
- `scripts/verify-recommendation-personalization.js` and
  `scripts/verify-recommendation-feedback-loop.js` exercise the engine over real HTTP against a real
  database and Redis. Measure personalisation as **lift over that viewer's own reachable base rate**,
  never as the share of one named category: ten of the thirteen seeded categories have a single
  creator and nobody is served their own posts, so the account whose persona is built on `games` is
  exactly the account that can never be shown a `games` post.

## Browser verification

`user/browser-verify/` drives a real Chromium against the **production build** and captures every
recommendation request with its parsed body and the server's own accepted/deduped/rejected reply, so
a scenario can assert the whole chain: gesture -> network batch -> server verdict -> persisted rows.
Run with `PLAYWRIGHT_PATH` pointing at a Playwright install outside the repo (it is verification
tooling, not an app dependency).

Things learned the hard way there, worth knowing before writing another pass:

- **Assert on observable UI state before asserting on the event.** A like was measured as "no signal
  sent" three separate times: once because the click was intercepted by the video overlay, once
  because the fixed wait ended before the queue flushed, and once because the post was *already
  liked* so the click was an un-like (which correctly sends nothing). Read the control's own state
  and the transition direction, then poll for the event.
- **Re-read the action rail before each interaction.** It changes as you use it — following a creator
  removes the Follow control — so a cached index silently starts pointing at the wrong button.
- **Wait for `video.duration` to be finite.** It is `NaN` until metadata lands, and a target computed
  from it silently skips every playback wait.
- **Close a modal from inside the app, not by navigating away.** `useRecommendationPhotoDwell` flushes
  on unmount; a full page load tears the document down without React unmounting, so the dwell is never
  enqueued and the unload flush has nothing to send.
- **Pace anything that loops over feed requests.** The endpoints are throttled, and an unpaced audit
  trips its own limiter and then reports the resulting empty sessions as product failures.

## Known limitations / deferred work

Filed as `.agents/bug-tracker/` — read those before extending this area further:

- **Creator diversity degrades in the tail batches** once the candidate pool is close to exhausted
  (`rec-recommendation-diversity-tail-starvation`). Batches 1-4 are clean in every session measured
  and category caps hold throughout; breaches appear from batch 5 onward, after the greedy per-batch
  allocation has consumed the creators that make diversity cheap. Stated as a limitation of that
  allocation strategy — **not** as "invisible in production", which has not been measured against a
  realistic creator distribution. `api/scripts/audit-feed-diversity.js` is the harness: it separates
  in-batch adjacency from batch-boundary adjacency and reports which batch each breach is in.

## One Exposure, One Event — And The Index Is Not Where You Find Out

A paired production-build review API logged 19 duplicate-key rejections over 74
minutes of ordinary use: 9 `photo_dwell`, 7 `final_watch`, 3 `detail_open`. The
unique index was working; what was wrong is that the events were emitted and
submitted at all.

### Three emitters, one mistake

| type | what produced the second copy |
|---|---|
| `photo_dwell` | the visibility handler emitted its slice **and** the unmount cleanup emitted another — one exposure, two records |
| `final_watch` | `pause` flushed, playback resumed, unmount flushed again — a *correction*, sent as a second insert |
| `detail_open` | the popup's layout swap (photo ↔ video) remounts the hook, and returning to a post via Back re-announced an exposure that had never ended |

The shared rule: **an exposure's identity is `(session, post, type)`, and a
mount is not an exposure.** Guard on the exposure key, not on the component
lifecycle — `reportedExposureRef`, `sentRef`, an accumulator — so a remount, a
hide/return cycle or a second handler is a no-op rather than a second record.
Dwell in particular *accumulates* across hide/return and reports once, which
also makes the number that reaches the server the whole dwell rather than its
last fragment.

### A pre-check that reads the database cannot see the batch it is in

`recordEvents` looked up `dedupeKey` against stored rows, which answers "is this
already persisted" and says nothing about two copies arriving in the *same
request*. Both passed, both became inserts, and Mongo rejected the second. Every
collision in that log was this.

The batch is now collapsed before anything is prepared: first-wins for a
non-updatable type (a retry keeps its identity), **last**-wins for `final_watch`
and `photo_dwell` (a monotonic correction supersedes), and the collapsed copies
are still counted in `deduped` so `accepted + deduped + rejected` still accounts
for everything the caller sent. This is not suppression — the identity, the
index and the semantics are unchanged; one identity now produces one write.

### `writeErrors[].index` is the only reliable way back to what was rejected

Every one of those collisions logged as `#unknown`, because the hash was
recovered from the Mongo error's `keyValue` — which some driver paths populate
and some do not. The event type was known the whole time; the key was not.

Build a metadata array **in lockstep with `insertDocs`** (`PreparedInsertMeta`:
operation index, event type, dedupe-key hash, session hash, post id, exposure
hash, batch id, request id, path) and resolve `writeErrors[].index` into it.
Never parse the error message, and never fall back to `keyPattern` for identity.
When an index maps to nothing, say `unmapped-operation` — "unknown" reads as a
missing event type when the real problem is a missing mapping.

Log hashes, never the values: the dedupe key contains the subject id and the
session id is a Redis key segment. A post id is already public and is logged
plainly so a trace can be followed.

### A retry is not free just because it is safe

The client queue requeued on **any** rejected `fetch`. A lost response is not a
failed write: the server may well have committed the batch, so the retry is a
resend, and the dedupe key makes it *safe* rather than *absent*. Retry only
transport-level failures — where no `status` came back — and never requeue a
`keepalive` unload flush, which the browser keeps alive precisely so it can be
delivered. `flushOnUnload` also sets the `flushing` flag now, so an interval
flush cannot start a second overlapping batch behind it.

### Cover

- `api/src/services/content/recommendation/recommendation-event-collision-diagnostics.spec.ts`
  — hashing, collision classification, operation-index mapping (including the
  driver shape with no `keyValue`), and the collapse as a pure function.
- `user/src/hooks/recommendation-exposure-identity.spec.tsx` — one dwell per
  exposure across hide/return cycles, and a genuinely new exposure still
  reporting.
- `user/browser-verify/42-event-duplicate-soak.js` — ten minutes of ordinary
  review traffic with every batch correlated to the server's verdict, grouped by
  event type, exposure and flush trigger.
