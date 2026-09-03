/**
 * Turns a described viewing into the same three writes the running API makes
 * for one recommendation event: a raw `recommendation_events` row, an `$inc`
 * against `post_recommendation_stats`, and an `$inc` against
 * `user_recommendation_affinities`.
 *
 * ## Why not just write the aggregates
 *
 * Writing the stats and affinities directly would be far less code, and would
 * be wrong in the specific way that matters: the numbers would be whatever
 * this file decided they should be, rather than what the engine would have
 * produced from the same behaviour. The first time a weight or a threshold
 * moved in `common/constants/recommendation.ts`, the demo dataset would
 * quietly stop being a picture of the current recommender — while still
 * looking entirely plausible, which is the worst kind of wrong for a fixture.
 *
 * So the policy constants are `require`d from the **compiled build**
 * (`dist/common/constants/recommendation.js`) rather than copied, and the
 * classification rules below are the same ones `RecommendationEventService`
 * applies:
 *
 *  - quick skip is *derived* from watch numbers, never asserted — a low share
 *    watched **and** a short absolute time, both required, so a 2s video
 *    watched to 1.8s is a strong signal rather than a skip;
 *  - completion is only credited when the watch time genuinely clears
 *    `WATCH_QUALITY_POLICY.video.completionMinRatio` against the video's own
 *    canonical duration;
 *  - `watchMs` is clamped to that duration, and a post with no canonical
 *    duration yields no ratio and therefore no completion/quick-skip verdict;
 *  - affinity weight for a watch is `watchQuality * ratio`, for a photo
 *    `photoDwell * min(1, dwell / strongDwellMs)`, and a quick skip is the
 *    negative `quickSkip` weight.
 *
 * ## Idempotency
 *
 * Every event carries the same `dedupeKey` shape the API uses, and the ledger
 * claims each one, so a second `demo:seed` finds them present and writes
 * nothing. That mirrors the API's own dedupe rather than inventing a second
 * mechanism.
 */

const path = require('path');
const { KINDS } = require('./ledger');

const DIST_CONSTANTS = path.join(__dirname, '..', '..', 'dist', 'common', 'constants', 'recommendation.js');

/**
 * Reads the *real* policy the engine scores with. A missing build is a hard
 * error rather than a fallback to copied numbers: seeding a fixture against
 * guessed weights is exactly the drift this indirection exists to prevent.
 */
function loadPolicy() {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(DIST_CONSTANTS);
  } catch (error) {
    throw new Error(
      'demo: recommendation policy constants not found. Run `yarn build` in api/ first — '
      + 'the demo seeder reads the compiled policy so the seeded history cannot drift '
      + `from what the engine scores with. (${error.message})`
    );
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Mirrors `RecommendationEventService.clampWatch`. */
function clampWatch(policy, watchMs, canonicalDurationMs) {
  const { RECOMMENDATION_EVENT_POLICY } = policy;
  if (watchMs === undefined || watchMs === null) return { watchMs: null, durationMs: null, watchRatio: null };
  const floored = Math.max(0, watchMs);

  if (canonicalDurationMs && canonicalDurationMs > 0) {
    const ceiling = canonicalDurationMs + RECOMMENDATION_EVENT_POLICY.maxWatchMsOverDurationSlackMs;
    const clamped = Math.min(floored, ceiling);
    return {
      watchMs: clamped,
      durationMs: canonicalDurationMs,
      watchRatio: Math.min(1, clamped / canonicalDurationMs)
    };
  }

  return {
    watchMs: Math.min(floored, RECOMMENDATION_EVENT_POLICY.legacyMaxWatchMsWithoutCanonicalDuration),
    durationMs: null,
    watchRatio: null
  };
}

/** Mirrors `RecommendationEventService.isVideoQuickSkip` — both conditions required. */
function isVideoQuickSkip(policy, ratio, watchMs) {
  const { video } = policy.WATCH_QUALITY_POLICY;
  return ratio < video.quickSkipMaxRatio && watchMs < video.quickSkipMaxMs;
}

/** Mirrors `RecommendationEventService.isPhotoQuickSkip`. */
function isPhotoQuickSkip(policy, dwellMs) {
  return dwellMs < policy.WATCH_QUALITY_POLICY.photo.quickSkipMaxMs;
}

/**
 * The stat `$inc`s and affinity weight one event produces.
 *
 * Returns `null` for an event that the API would accept but score nothing
 * for (a legacy post with no duration, an unverifiable completion), so the
 * caller can still record the raw row without moving any aggregate — the same
 * split the service makes.
 */
function effectsOf(policy, event, media) {
  const {
    AFFINITY_EVENT_WEIGHTS, ENGAGEMENT_WEIGHTS, WATCH_QUALITY_POLICY
  } = policy;
  const { watchMs, durationMs, watchRatio } = clampWatch(policy, event.watchMs, media.canonicalDurationMs);
  const fields = {
    watchMs, durationMs, watchRatio, dwellMs: event.dwellMs ?? null
  };

  switch (event.eventType) {
    case 'impression':
      return { inc: { impressions: 1 }, affinityWeight: 0, fields };
    case 'view':
      return { inc: {}, affinityWeight: AFFINITY_EVENT_WEIGHTS.view, fields };
    case 'detail_open':
      return { inc: { detailOpens: 1 }, affinityWeight: AFFINITY_EVENT_WEIGHTS.view, fields };
    case 'final_watch': {
      if (watchRatio === null) return { inc: {}, affinityWeight: 0, fields };
      const quickSkip = isVideoQuickSkip(policy, watchRatio, watchMs ?? 0);
      return {
        inc: {
          watchRatioSum: watchRatio,
          watchSampleCount: 1,
          ...(quickSkip ? { quickSkips: 1 } : {})
        },
        affinityWeight: quickSkip
          ? AFFINITY_EVENT_WEIGHTS.quickSkip
          : AFFINITY_EVENT_WEIGHTS.watchQuality * watchRatio,
        fields
      };
    }
    case 'completion': {
      // Verified exactly as the service verifies it: the event's own watch
      // time must clear the threshold against the canonical duration.
      if (watchRatio === null || watchRatio < WATCH_QUALITY_POLICY.video.completionMinRatio) {
        return { inc: {}, affinityWeight: 0, fields };
      }
      return { inc: { completions: 1 }, affinityWeight: AFFINITY_EVENT_WEIGHTS.watchQuality, fields };
    }
    case 'replay':
      return { inc: { replays: 1 }, affinityWeight: AFFINITY_EVENT_WEIGHTS.watchQuality * 0.5, fields };
    case 'photo_dwell': {
      const dwellMs = Math.max(0, Math.min(event.dwellMs || 0, 5 * 60 * 1000));
      const quickSkip = isPhotoQuickSkip(policy, dwellMs);
      const ratio = Math.min(1, dwellMs / WATCH_QUALITY_POLICY.photo.strongDwellMs);
      return {
        inc: {
          dwellMsSum: dwellMs,
          dwellSampleCount: 1,
          ...(quickSkip ? { quickSkips: 1 } : {})
        },
        affinityWeight: quickSkip
          ? AFFINITY_EVENT_WEIGHTS.quickSkip
          : AFFINITY_EVENT_WEIGHTS.photoDwell * ratio,
        fields: { ...fields, dwellMs }
      };
    }
    case 'like':
      return { inc: { weightedEngagement: ENGAGEMENT_WEIGHTS.like }, affinityWeight: AFFINITY_EVENT_WEIGHTS.like, fields };
    case 'comment':
      return { inc: { weightedEngagement: ENGAGEMENT_WEIGHTS.comment }, affinityWeight: AFFINITY_EVENT_WEIGHTS.comment, fields };
    case 'share':
      return { inc: { weightedEngagement: ENGAGEMENT_WEIGHTS.share }, affinityWeight: AFFINITY_EVENT_WEIGHTS.share, fields };
    case 'follow_after_view':
      return {
        inc: { weightedEngagement: ENGAGEMENT_WEIGHTS.followAfterView },
        affinityWeight: AFFINITY_EVENT_WEIGHTS.followAfterView,
        fields
      };
    default:
      return { inc: {}, affinityWeight: 0, fields };
  }
}

/** The API's own dedupe-key shapes (`RecommendationEventService.dedupeKeyFor`). */
function dedupeKeyFor(subjectId, event, creatorId) {
  if (event.eventType === 'watch_progress') return undefined;
  if (event.eventType === 'follow_after_view') return `${subjectId}:${creatorId}:${event.eventType}`;
  if (event.eventType === 'replay') {
    if (!event.clientExposureId) return undefined;
    return `${subjectId}:${event.sessionId}:${event.postId}:${event.eventType}:${event.clientExposureId}`;
  }
  if (event.eventType === 'comment') {
    return `${subjectId}:${event.postId}:${event.eventType}:${event.commentId}`;
  }
  return `${subjectId}:${event.sessionId}:${event.postId}:${event.eventType}`;
}

/**
 * @param db          The demo `db` handle, extended with the recommendation collections.
 * @param ledger      The seed ledger, for idempotent claims.
 */
function createRecommendationAdapter({ db, ledger }) {
  const policy = loadPolicy();

  /**
   * Applies one event exactly as the API would.
   *
   * @param event  `{ postId, sessionId, eventType, source, watchMs?, dwellMs?, clientExposureId?, commentId?, createdAt }`
   * @param actor  `{ userId }` — every demo subject is a real seeded account.
   * @param media  `{ creatorId, topicKey, tags, isPhoto, isVideo, canonicalDurationMs }`
   * @returns `true` when it wrote, `false` when the ledger already had it.
   */
  async function apply(event, actor, media) {
    const subjectId = actor.userId.toString();
    const dedupeKey = dedupeKeyFor(subjectId, event, media.creatorId?.toString());
    const seedKey = dedupeKey || `${subjectId}:${event.sessionId}:${event.postId}:${event.eventType}:${event.createdAt.getTime()}`;

    const claim = await ledger.claim(KINDS.RECOMMENDATION_EVENT, seedKey, { eventType: event.eventType });
    if (await db.recommendationEvents.findOne({ _id: claim.refId })) return false;

    const { inc, affinityWeight, fields } = effectsOf(policy, event, media);
    const createdAt = event.createdAt;
    /*
     * The TTL is anchored to *now*, not to the event's own historical
     * `createdAt`.
     *
     * `recommendation_events` has a TTL index on `expiresAt`
     * (`expireAfterSeconds: 0`), and the retention policy means "keep a raw
     * event for `rawEventTtlDays` after it was ingested". A seeded viewing is
     * dated back weeks so the history reads as real, so anchoring the TTL to
     * that date puts `expiresAt` in the past for anything older than the
     * retention window — and MongoDB's TTL monitor then deletes it, quietly,
     * minutes after seeding.
     *
     * That is not hypothetical: it silently removed 584 of 2674 seeded events
     * (22%) on the first run here, leaving the `post_recommendation_stats`
     * they had already incremented with no events left to justify them —
     * exactly the kind of drift `demo:verify`'s re-derivation exists to catch.
     */
    const expiresAt = new Date(
      Date.now() + policy.RECOMMENDATION_EVENT_POLICY.rawEventTtlDays * MS_PER_DAY
    );

    await db.recommendationEvents.insertOne({
      _id: claim.refId,
      userId: actor.userId,
      anonymousId: null,
      postId: event.postId,
      sessionId: event.sessionId,
      eventType: event.eventType,
      source: event.source,
      ...fields,
      dedupeKey,
      expiresAt,
      createdAt
    });

    if (Object.keys(inc).length) {
      await db.postRecommendationStats.updateOne(
        { postId: event.postId },
        {
          $inc: inc,
          $set: {
            updatedAt: createdAt,
            creatorId: media.creatorId,
            topicKey: media.topicKey ?? null,
            ...(event.eventType === 'impression' ? { lastImpressionAt: createdAt } : {})
          },
          $setOnInsert: { postId: event.postId }
        },
        { upsert: true }
      );
    }

    if (affinityWeight) {
      const affinityInc = {};
      const affinitySet = {};
      if (media.topicKey) {
        affinityInc[`categoryScores.${media.topicKey}.score`] = affinityWeight;
        affinitySet[`categoryScores.${media.topicKey}.updatedAt`] = createdAt;
      }
      (media.tags || []).slice(0, 10).forEach((tag) => {
        affinityInc[`hashtagScores.${tag}.score`] = affinityWeight;
        affinitySet[`hashtagScores.${tag}.updatedAt`] = createdAt;
      });
      if (media.creatorId) {
        affinityInc[`creatorScores.${media.creatorId.toString()}.score`] = affinityWeight;
        affinitySet[`creatorScores.${media.creatorId.toString()}.updatedAt`] = createdAt;
      }
      if (media.isVideo) {
        affinityInc['videoFormatPreference.score'] = affinityWeight;
        affinitySet['videoFormatPreference.updatedAt'] = createdAt;
      }
      if (media.isPhoto) {
        affinityInc['photoFormatPreference.score'] = affinityWeight;
        affinitySet['photoFormatPreference.updatedAt'] = createdAt;
      }

      if (Object.keys(affinityInc).length) {
        await db.userRecommendationAffinities.updateOne(
          { subjectId },
          {
            $inc: affinityInc,
            $set: { ...affinitySet, lastEventAt: createdAt, isAuthenticatedUser: true },
            $setOnInsert: { subjectId }
          },
          { upsert: true }
        );
      }
    }

    await ledger.activate(KINDS.RECOMMENDATION_EVENT, seedKey);
    return true;
  }

  return {
    apply,
    policy,
    // Exposed for `demo:verify`, which re-derives the expected aggregates from
    // the raw events rather than trusting the seeder's own arithmetic.
    effectsOf: (event, media) => effectsOf(policy, event, media),
    clampWatch: (watchMs, durationMs) => clampWatch(policy, watchMs, durationMs),
    isVideoQuickSkip: (ratio, watchMs) => isVideoQuickSkip(policy, ratio, watchMs),
    isPhotoQuickSkip: (dwellMs) => isPhotoQuickSkip(policy, dwellMs),
    dedupeKeyFor
  };
}

module.exports = { createRecommendationAdapter, loadPolicy };
