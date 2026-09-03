import { ObjectId } from 'mongodb';
import { GLOBAL_ENGAGEMENT_PRIOR } from 'src/common/constants/recommendation';
import { RecommendationScoringService, ScoringCandidatePost, ScoringContext } from './recommendation-scoring.service';
import { GLOBAL_ENGAGEMENT_PRIOR_KEY } from 'src/schemas/content/recommendation';

function post(overrides: Partial<ScoringCandidatePost> = {}): ScoringCandidatePost {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    topicKey: 'food',
    tags: ['pho'],
    type: 'video',
    mediaTypes: ['video'],
    totalLike: 0,
    totalComment: 0,
    totalShare: 0,
    createdAt: new Date(),
    ...overrides
  };
}

function context(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    feedType: 'for-you',
    sessionSeed: 'seed-1',
    now: new Date('2026-09-02T00:00:00.000Z'),
    topCategoryAffinities: [],
    topHashtagAffinities: [],
    topCreatorAffinities: [],
    formatPreferenceScore: 0,
    ...overrides
  };
}

function service() {
  return new RecommendationScoringService({} as any, {} as any);
}

describe('RecommendationScoringService', () => {
  it('never lets a raw totalLike/totalComment count leak unnormalized into finalScore', () => {
    const svc = service();
    const viral = post({ totalLike: 500_000, totalComment: 200_000 });
    const stats = new Map();
    const priors = new Map([[GLOBAL_ENGAGEMENT_PRIOR_KEY, {
      key: GLOBAL_ENGAGEMENT_PRIOR_KEY, priorMean: GLOBAL_ENGAGEMENT_PRIOR.priorMean, priorStrength: GLOBAL_ENGAGEMENT_PRIOR.priorStrength
    } as any]]);
    const scored = svc.score(viral, 'trending', context(), stats, priors);
    // Every weighted component is bounded ~[0,1] (plus small jitter), so no
    // single raw counter can push finalScore past a small bounded ceiling.
    expect(scored.finalScore).toBeLessThan(1.2);
  });

  it('regresses a tiny sample toward the prior instead of letting it win outright (Bayesian smoothing)', () => {
    const svc = service();
    const oneImpressionOneLike = post();
    const wellSampledAverage = post();

    const stats = new Map<string, any>([
      [oneImpressionOneLike._id.toString(), { impressions: 1, weightedEngagement: 1 }],
      [wellSampledAverage._id.toString(), { impressions: 5000, weightedEngagement: 5000 * GLOBAL_ENGAGEMENT_PRIOR.priorMean }]
    ]);
    const priors = new Map([[GLOBAL_ENGAGEMENT_PRIOR_KEY, {
      key: GLOBAL_ENGAGEMENT_PRIOR_KEY, priorMean: GLOBAL_ENGAGEMENT_PRIOR.priorMean, priorStrength: GLOBAL_ENGAGEMENT_PRIOR.priorStrength
    } as any]]);

    const a = svc.score(oneImpressionOneLike, 'trending', context(), stats, priors);
    const b = svc.score(wellSampledAverage, 'trending', context(), stats, priors);

    // 1 like / 1 impression is a 100% raw rate, but with priorStrength=50 it is
    // smoothed to (1 + priorMean*50)/(1+50) ~= priorMean-ish, not anywhere near 1.
    expect(a.breakdown.engagementQuality).toBeLessThan(0.3);
    // The well-sampled, average-performing post should score similarly to its
    // own true rate, not be dragged down by the other post's small sample.
    expect(b.breakdown.engagementQuality).toBeGreaterThan(0);
    expect(b.breakdown.engagementQuality).toBeLessThan(0.3);
  });

  it('decays freshness with post age, and evergreen categories decay slower than general ones', () => {
    const svc = service();
    const now = new Date('2026-09-02T00:00:00.000Z');
    const threeDaysOld = post({ topicKey: 'food', createdAt: new Date(now.getTime() - 72 * 60 * 60 * 1000) });
    const threeDaysOldEvergreen = post({ topicKey: 'travel', createdAt: new Date(now.getTime() - 72 * 60 * 60 * 1000) });
    const stats = new Map();
    const priors = new Map();

    const general = svc.score(threeDaysOld, 'fresh', context({ now }), stats, priors);
    const evergreen = svc.score(threeDaysOldEvergreen, 'fresh', context({ now }), stats, priors);

    expect(general.breakdown.freshness).toBeGreaterThan(0);
    expect(general.breakdown.freshness).toBeLessThan(1);
    expect(evergreen.breakdown.freshness).toBeGreaterThan(general.breakdown.freshness);
  });

  it('stages exploration bonus by lifetime impressions, highest for brand-new posts', () => {
    const svc = service();
    const brandNew = post();
    const midSample = post();
    const wellSampled = post();
    const stats = new Map<string, any>([
      [brandNew._id.toString(), { impressions: 0 }],
      [midSample._id.toString(), { impressions: 50 }],
      [wellSampled._id.toString(), { impressions: 500 }]
    ]);
    const priors = new Map();

    const a = svc.score(brandNew, 'fresh', context(), stats, priors);
    const b = svc.score(midSample, 'fresh', context(), stats, priors);
    const c = svc.score(wellSampled, 'fresh', context(), stats, priors);

    expect(a.explorationStage).toBe(0);
    expect(b.explorationStage).toBe(1);
    expect(c.explorationStage).toBe(2);
    expect(a.breakdown.explorationBonus).toBeGreaterThan(b.breakdown.explorationBonus);
    expect(b.breakdown.explorationBonus).toBeGreaterThan(c.breakdown.explorationBonus);
    // Long-tail floor: a well-performing-sample post never gets literally zero exploration chance.
    expect(c.breakdown.explorationBonus).toBeGreaterThan(0);
  });

  it('gives a cold post (no watch samples yet) a neutral, not punitive or free-win, watch-quality default', () => {
    const svc = service();
    const coldPost = post();
    const stats = new Map();
    const priors = new Map();
    const scored = svc.score(coldPost, 'fresh', context(), stats, priors);
    expect(scored.breakdown.watchQuality).toBeCloseTo(0.3, 5);
  });

  it('produces a deterministic sessionJitter for a fixed session seed and post id', () => {
    const svc = service();
    const fixedPost = post();
    const stats = new Map();
    const priors = new Map();
    const a = svc.score(fixedPost, 'fresh', context({ sessionSeed: 'same-seed' }), stats, priors);
    const b = svc.score(fixedPost, 'fresh', context({ sessionSeed: 'same-seed' }), stats, priors);
    const c = svc.score(fixedPost, 'fresh', context({ sessionSeed: 'different-seed' }), stats, priors);
    expect(a.breakdown.sessionJitter).toBe(b.breakdown.sessionJitter);
    expect(a.breakdown.sessionJitter).not.toBe(c.breakdown.sessionJitter);
  });

  it('rewards user interest for a category/hashtag the viewer has affinity for', () => {
    const svc = service();
    const matchingPost = post({ topicKey: 'food', tags: ['pho'] });
    const nonMatchingPost = post({ topicKey: 'gaming', tags: ['fps'] });
    const stats = new Map();
    const priors = new Map();
    const ctx = context({
      topCategoryAffinities: [{ key: 'food', decayedScore: 10 }],
      topHashtagAffinities: [{ key: 'pho', decayedScore: 10 }]
    });

    const matching = svc.score(matchingPost, 'personalized', ctx, stats, priors);
    const nonMatching = svc.score(nonMatchingPost, 'personalized', ctx, stats, priors);
    expect(matching.breakdown.userInterest).toBeGreaterThan(nonMatching.breakdown.userInterest);
  });
});
