/**
 * Recommendation Engine Policy Constants
 *
 * This is a heuristic, explainable recommender built from publicly documented
 * signal categories (interactions, watch time, affinity, freshness, engagement
 * quality, cold-start exploration, diversity, session stability). It is not a
 * reproduction of any platform's proprietary ranking algorithm, and nothing in
 * this module or its callers should describe it as one.
 *
 * Every weight/threshold below is intentionally centralized and validated
 * (see `assertValidRecommendationWeights`) rather than scattered across
 * services, so tuning the recommender is a one-file change and a boot-time
 * misconfiguration (weights that do not sum to 1) fails loudly instead of
 * silently skewing the feed.
 */

/** The two ranked surfaces. Following stays on its existing chronological path. */
export const RECOMMENDATION_FEED_TYPES = {
  HOME: 'home',
  FOR_YOU: 'for-you'
} as const;
export type RecommendationFeedType = typeof RECOMMENDATION_FEED_TYPES[keyof typeof RECOMMENDATION_FEED_TYPES];

/** Named candidate buckets. */
export const RECOMMENDATION_SOURCES = {
  PERSONALIZED: 'personalized',
  TRENDING: 'trending',
  FRESH: 'fresh',
  SOCIAL: 'social',
  DIVERSE: 'diverse'
} as const;
export type RecommendationSource = typeof RECOMMENDATION_SOURCES[keyof typeof RECOMMENDATION_SOURCES];

/**
 * Candidate pool quota (share of the *candidate pool*, not fixed output slots).
 * Re-ranking/diversity may reorder or drop candidates, so a quota is an input
 * target for retrieval, never a promise about final position.
 */
export const CANDIDATE_QUOTAS: Record<RecommendationFeedType, Record<RecommendationSource, number>> = {
  [RECOMMENDATION_FEED_TYPES.HOME]: {
    [RECOMMENDATION_SOURCES.PERSONALIZED]: 0.4,
    [RECOMMENDATION_SOURCES.TRENDING]: 0.2,
    [RECOMMENDATION_SOURCES.FRESH]: 0.2,
    [RECOMMENDATION_SOURCES.SOCIAL]: 0.1,
    [RECOMMENDATION_SOURCES.DIVERSE]: 0.1
  },
  [RECOMMENDATION_FEED_TYPES.FOR_YOU]: {
    [RECOMMENDATION_SOURCES.PERSONALIZED]: 0.5,
    [RECOMMENDATION_SOURCES.TRENDING]: 0.15,
    [RECOMMENDATION_SOURCES.FRESH]: 0.2,
    [RECOMMENDATION_SOURCES.SOCIAL]: 0.05,
    [RECOMMENDATION_SOURCES.DIVERSE]: 0.1
  }
};

/** Guest / no-history quota — never a fabricated preference profile. */
export const GUEST_CANDIDATE_QUOTAS = {
  recentPopular: 0.5,
  fresh: 0.3,
  categoryDiverse: 0.2
} as const;

/** Scoring weights. Must each sum to 1 — enforced by `assertValidRecommendationWeights`. */
export const SCORE_WEIGHTS: Record<RecommendationFeedType, {
  userInterest: number;
  watchQuality: number;
  engagementQuality: number;
  freshness: number;
  explorationBonus: number;
  creatorAffinity: number;
}> = {
  [RECOMMENDATION_FEED_TYPES.HOME]: {
    userInterest: 0.25,
    watchQuality: 0.20,
    engagementQuality: 0.20,
    freshness: 0.15,
    explorationBonus: 0.10,
    creatorAffinity: 0.10
  },
  [RECOMMENDATION_FEED_TYPES.FOR_YOU]: {
    userInterest: 0.35,
    watchQuality: 0.30,
    engagementQuality: 0.10,
    freshness: 0.10,
    explorationBonus: 0.10,
    creatorAffinity: 0.05
  }
};

/** Maximum absolute contribution of session jitter to `finalScore`. Tie-breaking noise, not a signal. */
export const SESSION_JITTER_MAGNITUDE = 0.03;

/** Raw per-interaction affinity weights, before time decay. Negative = signal against the target. */
export const AFFINITY_EVENT_WEIGHTS = {
  impression: 0, // Exposure alone carries no preference signal.
  view: 0.5,
  watchQuality: 1.5, // Scaled by watch ratio at apply time (0..1 * weight).
  like: 1,
  comment: 3,
  share: 5,
  followAfterView: 6,
  quickSkip: -1.5,
  photoDwell: 1 // Scaled by dwell ratio at apply time.
} as const;

/** Half-life for affinity decay — a like from 3 weeks ago should matter less than one from today. */
export const AFFINITY_DECAY_HALF_LIFE_DAYS = 14;

/** Half-life for general freshness decay, and the longer-lived "evergreen" category class. */
export const FRESHNESS_DEFAULT_HALF_LIFE_HOURS = 36;
export const FRESHNESS_EVERGREEN_HALF_LIFE_HOURS = 168; // 7 days
/**
 * Category keys treated as evergreen (longer freshness half-life).
 *
 * Matches real keys from the seeded catalogue (`api/migrations/data/post-categories.js`):
 * knowledge, games, anime, music, film, food, lifestyle, sports, travel, parenting, animals,
 * beauty, photography. Falls back safely (no match, default half-life) if a category is renamed —
 * `CategoryService` remains the source of truth for the catalogue itself; this list only tags which
 * of those keys decay slower.
 */
export const FRESHNESS_EVERGREEN_CATEGORY_KEYS = ['travel', 'photography', 'knowledge', 'animals'];

/** Cold-start exploration staging, by lifetime impression count. */
export const EXPLORATION_STAGES = {
  STAGE_0_MAX_IMPRESSIONS: 20,
  STAGE_1_MAX_IMPRESSIONS: 100,
  STAGE_0_BONUS: 1,
  STAGE_1_BONUS: 0.5,
  STAGE_2_BONUS: 0.05, // Long-tail floor so a weak-performing post never becomes literally unreachable.
  /** A single creator's fresh posts are capped at this share of the fresh bucket per session. */
  MAX_SHARE_PER_CREATOR_IN_FRESH_BUCKET: 0.34
} as const;

/** Bayesian smoothing prior, used until a category has enough samples for its own prior (see job). */
export const GLOBAL_ENGAGEMENT_PRIOR = {
  priorMean: 0.02, // ~2% weighted-engagement-per-impression, a conservative platform-wide default.
  priorStrength: 50 // Weight of the prior in "virtual impressions" — small posts regress toward it.
} as const;
/** A category needs at least this many sampled impressions before it gets its own prior. */
export const CATEGORY_PRIOR_MIN_SAMPLE_IMPRESSIONS = 500;

/** Weighted-engagement multipliers (mirrors affinity weights but scores content quality, not user taste). */
export const ENGAGEMENT_WEIGHTS = {
  like: 1,
  comment: 3,
  share: 5,
  followAfterView: 6
} as const;

/** Watch-quality thresholds. Video and photo use different vocabularies on purpose — see rules/user.md. */
export const WATCH_QUALITY_POLICY = {
  video: {
    /** Below this watch ratio (watched / duration) *and* under the ms floor, a view counts as a quick skip. */
    quickSkipMaxRatio: 0.25,
    quickSkipMaxMs: 3000,
    completionMinRatio: 0.9
  },
  photo: {
    /** Photos have no duration; dwell time alone decides. */
    quickSkipMaxMs: 1200,
    strongDwellMs: 4000
  }
} as const;

/** Impression counting policy. */
export const IMPRESSION_POLICY = {
  minVisibleRatio: 0.5,
  minVisibleMs: 1000
} as const;

/** Re-ranking / diversity constraints, per output batch. */
export const DIVERSITY_POLICY = {
  batchSize: 20,
  maxSameCreatorPerBatch: 2,
  maxSameCategoryPerBatch: 6,
  noConsecutiveSameCreator: true
} as const;

/** Redis-backed feed session policy. */
export const FEED_SESSION_POLICY = {
  ttlSeconds: 45 * 60,
  maxItems: 160, // Matches the benchmarked-safe Home render ceiling (rules/user.md).
  defaultPageSize: 10,
  loadMoreLockTtlMs: 5000,
  /**
   * Ceiling on one chain's seen-post set (see `REDIS_KEYS.recoFeedChainSeen`).
   *
   * The natural bound is the eligible corpus — once a chain has seen every
   * post, retrieval comes back empty and the chain is recycled, which clears
   * the set. This is the guard for the case where that never happens because
   * the catalogue keeps growing: a single scroll must not be able to allocate
   * an unbounded Redis set. Reaching it recycles the chain exactly as
   * exhaustion does, and it is deliberately far above `maxItems` so an
   * ordinary session chain never trips it.
   */
  maxChainSeenIds: 5000
} as const;

/** Post Detail recommendation-session policy (Home / notification / direct-link anchors). */
export const DETAIL_SESSION_POLICY = {
  ttlSeconds: 30 * 60,
  maxItems: 60
} as const;

/**
 * How much of the candidate pool a single session is allowed to *show*.
 *
 * The candidate pool and the session output were the same number, and on this
 * catalogue that number was the whole catalogue: retrieval gathered up to 160
 * of 160 posts and the session served every one of them in score order. Two
 * things followed, both visible on screen.
 *
 * A reload could only ever reshuffle the same set — measured over ten guest
 * reloads, top-10 overlap ran 6-9 of 10 with no post ever leaving the session,
 * which is a re-sort, not a new selection. And because ranking was
 * deterministic apart from a ±0.03 jitter that is far too small to move the
 * leader, **the same post led all ten reloads**.
 *
 * So the pool stays large — recall should be generous — and the session draws a
 * bounded subset from it. The numbers below are sized for a 160-post catalogue
 * against the page sizes each surface actually uses (Home pages 20 at a time,
 * For You 10), and are policy, not magic: change them here.
 */
export const SESSION_OUTPUT_POLICY = {
  /** Retrieval ceiling. Recall, not what the viewer sees. */
  candidatePoolLimit: 160,
  /** Home: enough for several pages of load-more without becoming the catalogue. */
  homeSessionItemLimit: 70,
  /** For You: a shorter ranked segment; the client opens a fresh session when it ends. */
  forYouInitialSessionLimit: 40,
  /**
   * How many of the top-scoring candidates the lead post may be drawn from.
   * Narrow enough that the first post is still a strong one, wide enough that
   * it is not always the same strong one.
   */
  heroWindowSize: 12,
  /** Lead posts remembered per subject, so recent leads are skipped while the memory lasts. */
  heroCooldownSize: 8,
  heroCooldownTtlSeconds: 6 * 60 * 60,
  /**
   * Sampling sharpness. Selection probability is proportional to
   * `finalScore ** samplingExponent`, so a higher number concentrates the draw
   * on the best candidates and a lower one spreads it. At 3 a candidate scoring
   * twice another is eight times as likely to be drawn — strong preference,
   * never a guarantee, which is the whole point.
   */
  samplingExponent: 3,
  /**
   * Floor added to every weight before sampling, so a candidate scoring zero
   * still has a path into a session. Without it the long tail is unreachable
   * and exploration quietly stops.
   */
  samplingWeightFloor: 0.02
} as const;

/** Recommendation event ingestion policy. */
export const RECOMMENDATION_EVENT_POLICY = {
  rawEventTtlDays: 45,
  maxEventsPerRequest: 20,
  perUserRateLimitPerMinute: 240,
  maxWatchMsOverDurationSlackMs: 2000, // Server-side clamp slack, tolerating minor client clock drift.
  /**
   * Safe absolute ceiling for a reported `watchMs` when the post has no
   * server-authoritative duration yet (see `PostLookup.canonicalDurationMs`
   * and rules/instructions §2.3's legacy fallback). 30 minutes is far beyond
   * any real short-form video on this platform, so this only ever bounds a
   * clearly-bogus client value — it is not a plausible real duration.
   */
  legacyMaxWatchMsWithoutCanonicalDuration: 30 * 60 * 1000,
  /**
   * Ceiling on how many distinct `replay` *occurrences* (each identified by
   * its own `clientExposureId` — see `RecommendationEventService`) are ever
   * scored for the same (subject, session, post). Counted across the whole
   * persisted history, not just one request batch, so a client cannot get
   * around it by splitting seek-spam across several requests. Beyond the
   * cap the raw event is still accepted and stored for audit, it simply
   * stops moving stats/affinity (rules/instructions §1.3).
   */
  maxReplaysCountedPerExposure: 5,
  /**
   * Ceiling on how many of one subject's comments on the *same post* ever
   * move stats/affinity. Each comment is deduped by its own real
   * `commentId`, so ordinary retries never double-count — this bounds the
   * separate case of someone posting (and possibly deleting) many comments
   * on one post to inflate the signal. Deleting a counted comment never
   * decrements anything: the engagement genuinely happened, and a
   * decrementing counter here would be both racy and gameable in the other
   * direction (rules/instructions §2).
   */
  maxCommentsCountedPerPost: 3
} as const;

/**
 * `follow_after_view` attribution policy (rules/instructions §3).
 *
 * A follow is only ever attributed to *one* recommendation exposure, ever,
 * per (subject, creator) pair — not per session/post — specifically so an
 * unfollow-then-refollow cycle cannot re-earn the signal. See
 * `RecommendationEventService.validateFollowAfterView`.
 */
export const FOLLOW_AFTER_VIEW_POLICY = {
  /** How long after an impression/view a follow may still be attributed to it. */
  attributionWindowMs: 30 * 60 * 1000
} as const;

const WEIGHT_SUM_EPSILON = 1e-6;

/**
 * Fails fast at boot if a weight set does not sum to 1, rather than silently
 * producing a feed that under- or over-weights every candidate the same way.
 */
export function assertValidRecommendationWeights(): void {
  (Object.keys(SCORE_WEIGHTS) as RecommendationFeedType[]).forEach((feedType) => {
    const weights = SCORE_WEIGHTS[feedType];
    const sum = Object.values(weights).reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > WEIGHT_SUM_EPSILON) {
      throw new Error(`Recommendation score weights for "${feedType}" must sum to 1, got ${sum}`);
    }
  });

  (Object.keys(CANDIDATE_QUOTAS) as RecommendationFeedType[]).forEach((feedType) => {
    const quotas = CANDIDATE_QUOTAS[feedType];
    const sum = Object.values(quotas).reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > WEIGHT_SUM_EPSILON) {
      throw new Error(`Recommendation candidate quotas for "${feedType}" must sum to 1, got ${sum}`);
    }
  });

  const guestSum = Object.values(GUEST_CANDIDATE_QUOTAS).reduce((total, value) => total + value, 0);
  if (Math.abs(guestSum - 1) > WEIGHT_SUM_EPSILON) {
    throw new Error(`Guest candidate quotas must sum to 1, got ${guestSum}`);
  }
}
