/**
 * Recommendation histories — the part that makes each demo account's feed
 * differ from every other account's.
 *
 * Without this, every seeded account has an identical (empty) affinity
 * profile, so Home and For You fall back to the guest mix for all sixteen of
 * them and "personalisation" cannot be demonstrated, let alone verified.
 *
 * ## What is written, and by whom
 *
 * Nothing here writes an aggregate directly. Every row comes out of
 * `recommendation-adapter.js`, which applies one described viewing using the
 * *compiled* policy constants the running engine scores with — so a seeded
 * completion is a completion by exactly the rule the API would apply, a quick
 * skip is derived from the watch numbers rather than asserted, and changing a
 * weight in `common/constants/recommendation.ts` changes what this produces.
 *
 * ## What a persona looks like
 *
 * `recommendation-personas.js` turns an account's own theme into a primary
 * category and two neighbours. This walks every *other* account's posts and
 * decides how that viewer behaved:
 *
 *  - **primary** — watched through, often to completion, sometimes replayed,
 *    liked more often than not, occasionally commented/shared/followed;
 *  - **secondary** — watched most of the way, liked sometimes, rarely more;
 *  - **off** — an impression and a short watch, which the server classifies as
 *    a quick skip, producing the negative signal that makes the persona a
 *    shape rather than just a list of likes.
 *
 * Like/comment/share/follow signals are only ever emitted where the *real*
 * interaction exists in `reactions`/`comments`/`follows` — this reports what
 * happened, it does not invent engagement the rest of the dataset cannot
 * back up. A `comment` event carries the real comment's id, and a
 * `follow_after_view` is only emitted after a real impression of that
 * creator's post, both because the API verifies exactly that.
 *
 * ## Cold start
 *
 * The posts named by `coldStartSeedKeys` are left with a handful of
 * impressions and nothing else — no watch, no like, no comment, no share — so
 * the exploration path has genuine candidates. `seed-interactions` skips them
 * too, so their counters really are zero and no notification implies a
 * reaction that does not exist.
 */

const logger = require('./logger');
const { createRandom } = require('./random');
const { createRecommendationAdapter } = require('./recommendation-adapter');
const { personaFor, coldStartSeedKeys, TIER } = require('./recommendation-personas');

/**
 * How much of the catalogue one viewer is exposed to, per tier.
 *
 * Deliberately high even off-persona: scrolling past something you do not
 * care about is the single most common thing anyone does in a feed, and it is
 * what produces the quick-skip signal that gives a persona its shape. What
 * differs between tiers is how the post is *watched*, not whether it is seen.
 */
const EXPOSURE_RATE = Object.freeze({
  [TIER.PRIMARY]: 1,
  [TIER.SECONDARY]: 1,
  [TIER.OFF]: 0.85
});

/**
 * How many separate sessions each viewer's exposure is spread across.
 *
 * One pass is not enough, and the reason is a property of the engine rather
 * than of realism: `EXPLORATION_STAGES.STAGE_0_MAX_IMPRESSIONS` is 20, so a
 * post with fewer than that still carries the *full* cold-start exploration
 * bonus. With a single pass every post in the dataset sat at roughly six
 * impressions, which meant all 160 looked equally undiscovered and the
 * deliberately-cold posts were indistinguishable from the rest — the
 * exploration path existed but had nothing to demonstrate.
 *
 * Two passes across sixteen viewers puts an ordinary post near thirty
 * impressions (comfortably past stage 0) while a cold-start post stays at
 * `COLD_START_MAX_IMPRESSIONS`, so the gap is real and visible. Seeing the
 * same post again in a later session is also simply what happens.
 *
 * Only the first pass watches or engages: a second viewing is an impression,
 * not a second opinion, and re-reporting the watch would double-count it.
 */
const IMPRESSION_PASSES = 2;

/** Impressions a cold-start post receives in total, across all viewers. */
const COLD_START_MAX_IMPRESSIONS = 3;

/** A viewing time strictly after publication and before now. */
function watchedAt(random, publishedAt, now) {
  const span = now.getTime() - new Date(publishedAt).getTime();
  if (span <= 120000) return new Date(new Date(publishedAt).getTime() + 60000);
  return new Date(new Date(publishedAt).getTime() + Math.floor((random.next() ** 1.5) * span));
}

/**
 * How this viewer watched this post, as raw numbers — never as a verdict.
 * The adapter (and, in production, the server) decides what they mean.
 */
function watchPlanFor(random, tier, post, durationMs) {

  if (post.kind === 'photo') {
    // Dwell in ms. The off-tier value is under `photo.quickSkipMaxMs`, which
    // is what makes it a quick skip — decided by the policy, not stated here.
    const dwellMs = {
      [TIER.PRIMARY]: random.int(4200, 9000),
      [TIER.SECONDARY]: random.int(2000, 4200),
      [TIER.OFF]: random.int(300, 1100)
    }[tier];
    return { kind: 'photo', dwellMs };
  }

  if (!durationMs) return { kind: 'video', watchMs: null };

  // Share of the video actually watched.
  const ratio = {
    [TIER.PRIMARY]: 0.86 + random.next() * 0.14,
    [TIER.SECONDARY]: 0.45 + random.next() * 0.35,
    [TIER.OFF]: 0.02 + random.next() * 0.06
  }[tier];

  const watchMs = Math.round(durationMs * ratio);
  return {
    kind: 'video',
    watchMs,
    // A "completion" is only *claimed* here; the adapter re-checks it against
    // the canonical duration exactly as the API does, so a claim that does
    // not clear the threshold scores nothing.
    claimsCompletion: ratio >= 0.9,
    replays: tier === TIER.PRIMARY && random.chance(0.22) ? random.int(1, 2) : 0
  };
}

async function seedRecommendations({
  plan, postIndex, db, ledger, now = new Date()
}) {
  const adapter = createRecommendationAdapter({ db, ledger });
  const coldStart = coldStartSeedKeys(plan);
  const postsBySeedKey = new Map(postIndex.map((post) => [post.seedKey, post]));

  /*
   * Durations come from `post_media`, not from the media manifest.
   *
   * They are not the same number. The manifest records what ffprobe measured
   * on the *source* file at fetch time; `post_media.durationMs` records what
   * the file server measured on the file it actually serves, after transcode
   * — and that second one is what `RecommendationEventService` clamps and
   * scores against. Seeding from the manifest produced watch times whose
   * ratios disagreed with the engine's by a few percent, which is exactly the
   * kind of quiet, plausible-looking wrongness a fixture must not have.
   * `demo:verify` catches it now, but reading the canonical value here is
   * what stops it happening.
   */
  const mediaRows = await db.postMedia.find(
    { postId: { $in: postIndex.map((post) => post.postId) }, ordering: 0 },
    { projection: { postId: 1, durationMs: 1 } }
  ).toArray();
  const canonicalDurationByPost = new Map(
    mediaRows.map((row) => [row.postId.toString(), row.durationMs ?? null])
  );
  const durationOf = (post) => canonicalDurationByPost.get(post.postId.toString()) ?? null;

  // Real interactions, so a reported signal always has something behind it.
  const postIds = postIndex.map((post) => post.postId);
  const [likeRows, shareRows, commentRows, followRows] = await Promise.all([
    db.reactions.find({ action: 'like', objectType: 'post', objectId: { $in: postIds } })
      .project({ objectId: 1, createdBy: 1 }).toArray(),
    db.reactions.find({ action: 'share', objectType: 'post', objectId: { $in: postIds } })
      .project({ objectId: 1, createdBy: 1 }).toArray(),
    db.comments.find({ objectType: 'post', objectId: { $in: postIds } })
      .project({ _id: 1, objectId: 1, createdBy: 1 }).toArray(),
    db.reactions.find({ action: 'follow', objectType: 'creator' })
      .project({ objectId: 1, createdBy: 1 }).toArray()
  ]);

  const pairKey = (userId, postId) => `${userId.toString()}:${postId.toString()}`;
  const likedPairs = new Set(likeRows.map((row) => pairKey(row.createdBy, row.objectId)));
  const sharedPairs = new Set(shareRows.map((row) => pairKey(row.createdBy, row.objectId)));
  const commentByPair = new Map(commentRows.map((row) => [pairKey(row.createdBy, row.objectId), row._id]));
  const followedPairs = new Set(followRows.map((row) => pairKey(row.createdBy, row.objectId)));
  // One follow may only ever be attributed once, to one post — the API's
  // `follow_after_view` dedupe key is `(subject, creator)` with no post in it.
  const creditedFollows = new Set();

  const stats = {
    events: 0,
    impressions: 0,
    finalWatches: 0,
    completions: 0,
    replays: 0,
    quickSkips: 0,
    photoDwells: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    followAfterViews: 0,
    coldStartPosts: coldStart.size,
    subjects: 0
  };
  const coldStartImpressions = new Map();

  for (const account of plan.accounts) {
    const viewerId = plan.userIds.get(account.username);
    if (!viewerId) continue;
    const persona = personaFor(account);
    const actor = { userId: viewerId };
    let sawAnything = false;

    for (const post of postIndex) {
      if (post.username === account.username) continue; // Nobody is recommended their own post.

      const random = createRandom(`reco:${account.username}->${post.seedKey}`);
      const tier = persona.tierOf(post.topicKey);
      const isCold = coldStart.has(post.seedKey);

      if (isCold) {
        // A cold post gets a couple of impressions across the whole dataset
        // and nothing else — that is the state the exploration bonus exists
        // to rescue, and inventing a watch here would destroy it.
        const seen = coldStartImpressions.get(post.seedKey) || 0;
        if (seen >= COLD_START_MAX_IMPRESSIONS || !random.chance(0.2)) continue;
        coldStartImpressions.set(post.seedKey, seen + 1);
      } else if (!random.chance(EXPOSURE_RATE[tier])) {
        continue;
      }

      // Every session id is stable for the (viewer, post) pair, so a re-seed
      // reproduces the same dedupe keys and writes nothing.
      const sessionId = `demo-${account.username}-${post.seedKey}`;
      /*
       * The later sessions this post was seen in again. Each is its own
       * exposure with its own dedupe key, which is also what makes them
       * genuinely additive rather than a duplicate of the first.
       */
      const laterSessionIds = [];
      for (let pass = 1; pass < IMPRESSION_PASSES; pass += 1) {
        laterSessionIds.push(`${sessionId}-s${pass}`);
      }
      const at = watchedAt(random, post.publishedAt, now);
      const media = {
        creatorId: post.userId,
        topicKey: post.topicKey || null,
        tags: post.tags || [],
        isPhoto: post.kind === 'photo',
        isVideo: post.kind === 'video',
        canonicalDurationMs: durationOf(post)
      };
      const source = random.chance(0.5) ? 'home' : 'for-you';

      const emit = async (event) => {
        const wrote = await adapter.apply({
          sessionId, source, postId: post.postId, createdAt: at, ...event
        }, actor, media);
        if (wrote) stats.events += 1;
        return wrote;
      };

      if (await emit({ eventType: 'impression' })) stats.impressions += 1;
      sawAnything = true;
      if (isCold) continue;

      // Seen again in later sessions — impressions only (see `IMPRESSION_PASSES`).
      for (const laterSessionId of laterSessionIds) {
        const wrote = await adapter.apply({
          sessionId: laterSessionId,
          source,
          postId: post.postId,
          createdAt: watchedAt(random, at, now),
          eventType: 'impression'
        }, actor, media);
        if (wrote) {
          stats.events += 1;
          stats.impressions += 1;
        }
      }

      const plan_ = watchPlanFor(random, tier, post, media.canonicalDurationMs);

      if (plan_.kind === 'photo') {
        if (await emit({ eventType: 'photo_dwell', dwellMs: plan_.dwellMs })) {
          stats.photoDwells += 1;
          if (adapter.isPhotoQuickSkip(plan_.dwellMs)) stats.quickSkips += 1;
        }
      } else if (plan_.watchMs !== null) {
        if (await emit({ eventType: 'final_watch', watchMs: plan_.watchMs })) {
          stats.finalWatches += 1;
          const { watchRatio, watchMs } = adapter.clampWatch(plan_.watchMs, media.canonicalDurationMs);
          if (watchRatio !== null && adapter.isVideoQuickSkip(watchRatio, watchMs)) stats.quickSkips += 1;
        }
        if (plan_.claimsCompletion
          && await emit({ eventType: 'completion', watchMs: plan_.watchMs })) stats.completions += 1;
        for (let i = 0; i < plan_.replays; i += 1) {
          // Each replay is its own occurrence, with its own stable id — the
          // same shape the client generates, so re-seeding dedupes per
          // occurrence rather than collapsing them into one.
          if (await emit({
            eventType: 'replay',
            clientExposureId: `${sessionId}-replay-${i}`
          })) stats.replays += 1;
        }
      }

      // Engagement signals, only where the real interaction exists.
      const pair = pairKey(viewerId, post.postId);
      if (likedPairs.has(pair) && await emit({ eventType: 'like' })) stats.likes += 1;
      if (sharedPairs.has(pair) && await emit({ eventType: 'share' })) stats.shares += 1;
      const commentId = commentByPair.get(pair);
      if (commentId && await emit({ eventType: 'comment', commentId })) stats.comments += 1;

      const creatorPair = pairKey(viewerId, post.userId);
      if (followedPairs.has(creatorPair) && !creditedFollows.has(creatorPair) && tier !== TIER.OFF) {
        creditedFollows.add(creatorPair);
        // Emitted after the impression above and inside the same viewing, so
        // the attribution window the API checks is genuinely satisfied.
        if (await emit({ eventType: 'follow_after_view' })) stats.followAfterViews += 1;
      }
    }

    if (sawAnything) stats.subjects += 1;
  }

  logger.detail(`${stats.events} recommendation events across ${stats.subjects} viewers`);
  return { ...stats, coldStartSeedKeys: [...coldStart], postsBySeedKey };
}

module.exports = { seedRecommendations, COLD_START_MAX_IMPRESSIONS };
