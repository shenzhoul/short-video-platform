import {
  AFFINITY_EVENT_WEIGHTS,
  ENGAGEMENT_WEIGHTS,
  WATCH_QUALITY_POLICY
} from 'src/common/constants/recommendation';

const { createRecommendationAdapter, loadPolicy } = require('./recommendation-adapter');
const { personaFor, coldStartSeedKeys, TIER } = require('./recommendation-personas');

/** The adapter only needs `effectsOf`/`clampWatch` here, which touch neither. */
const adapter = createRecommendationAdapter({ db: null, ledger: null });

const video = (durationMs: number | null, topicKey = 'food') => ({
  creatorId: 'creator-1', topicKey, tags: ['pho'], isPhoto: false, isVideo: true, canonicalDurationMs: durationMs
});
const photo = (topicKey = 'food') => ({
  creatorId: 'creator-1', topicKey, tags: ['pho'], isPhoto: true, isVideo: false, canonicalDurationMs: null
});

describe('demo recommendation adapter', () => {
  it('reads the policy the running engine actually scores with, not a copy', () => {
    // The whole point of loading the compiled build: if these ever diverge,
    // the seeded dataset stops describing the current recommender.
    const policy = loadPolicy();
    expect(policy.AFFINITY_EVENT_WEIGHTS).toEqual(AFFINITY_EVENT_WEIGHTS);
    expect(policy.ENGAGEMENT_WEIGHTS).toEqual(ENGAGEMENT_WEIGHTS);
    expect(policy.WATCH_QUALITY_POLICY).toEqual(WATCH_QUALITY_POLICY);
  });

  describe('watch classification matches RecommendationEventService', () => {
    it('scores a mostly-watched video as a positive watch signal, proportional to the ratio', () => {
      const { inc, affinityWeight } = adapter.effectsOf(
        { eventType: 'final_watch', watchMs: 9000 }, video(10_000)
      );
      expect(inc.watchRatioSum).toBeCloseTo(0.9, 5);
      expect(inc.watchSampleCount).toBe(1);
      expect(inc.quickSkips).toBeUndefined();
      expect(affinityWeight).toBeCloseTo(AFFINITY_EVENT_WEIGHTS.watchQuality * 0.9, 5);
    });

    it('derives a quick skip from the numbers — low ratio AND low absolute time', () => {
      const { inc, affinityWeight } = adapter.effectsOf(
        { eventType: 'final_watch', watchMs: 1500 }, video(60_000)
      );
      expect(inc.quickSkips).toBe(1);
      expect(affinityWeight).toBe(AFFINITY_EVENT_WEIGHTS.quickSkip);
      expect(affinityWeight).toBeLessThan(0);
    });

    it('does not call a short video watched nearly through a quick skip', () => {
      // 1.8s of a 2s video: under the absolute-ms floor, but a 0.9 ratio.
      const { inc, affinityWeight } = adapter.effectsOf(
        { eventType: 'final_watch', watchMs: 1800 }, video(2000)
      );
      expect(inc.quickSkips).toBeUndefined();
      expect(affinityWeight).toBeGreaterThan(0);
    });

    it('clamps a watch to the canonical duration, so no ratio can exceed 1', () => {
      const { inc } = adapter.effectsOf({ eventType: 'final_watch', watchMs: 999_999 }, video(10_000));
      expect(inc.watchRatioSum).toBeLessThanOrEqual(1);
    });

    it('scores nothing at all for a video with no canonical duration', () => {
      const { inc, affinityWeight } = adapter.effectsOf(
        { eventType: 'final_watch', watchMs: 9000 }, video(null)
      );
      expect(inc).toEqual({});
      expect(affinityWeight).toBe(0);
    });
  });

  describe('completion is verified, not asserted', () => {
    it('credits a completion whose own watch time clears the threshold', () => {
      const { inc } = adapter.effectsOf({ eventType: 'completion', watchMs: 9500 }, video(10_000));
      expect(inc.completions).toBe(1);
    });

    it('refuses a claimed completion that the watch time does not support', () => {
      const { inc, affinityWeight } = adapter.effectsOf(
        { eventType: 'completion', watchMs: 3000 }, video(10_000)
      );
      expect(inc).toEqual({});
      expect(affinityWeight).toBe(0);
    });

    it('never credits a completion on a video with no canonical duration', () => {
      const { inc } = adapter.effectsOf({ eventType: 'completion', watchMs: 999_999 }, video(null));
      expect(inc).toEqual({});
    });
  });

  describe('photo dwell', () => {
    it('treats a long dwell as a strong positive signal', () => {
      const { inc, affinityWeight } = adapter.effectsOf({ eventType: 'photo_dwell', dwellMs: 6000 }, photo());
      expect(inc.dwellMsSum).toBe(6000);
      expect(inc.quickSkips).toBeUndefined();
      expect(affinityWeight).toBeCloseTo(AFFINITY_EVENT_WEIGHTS.photoDwell, 5);
    });

    it('derives a quick skip from a dwell under the floor', () => {
      const { inc, affinityWeight } = adapter.effectsOf({ eventType: 'photo_dwell', dwellMs: 400 }, photo());
      expect(inc.quickSkips).toBe(1);
      expect(affinityWeight).toBe(AFFINITY_EVENT_WEIGHTS.quickSkip);
    });
  });

  it('separates content-quality weight from viewer-taste weight for an engagement', () => {
    const { inc, affinityWeight } = adapter.effectsOf({ eventType: 'share' }, video(10_000));
    expect(inc.weightedEngagement).toBe(ENGAGEMENT_WEIGHTS.share);
    expect(affinityWeight).toBe(AFFINITY_EVENT_WEIGHTS.share);
  });

  it('records an impression with no taste signal at all', () => {
    const { inc, affinityWeight } = adapter.effectsOf({ eventType: 'impression' }, video(10_000));
    expect(inc).toEqual({ impressions: 1 });
    expect(affinityWeight).toBe(0);
  });

  describe('dedupe keys match the API shapes exactly', () => {
    const base = { sessionId: 's1', postId: 'p1' };

    it('keys an ordinary event per (subject, session, post, type)', () => {
      expect(adapter.dedupeKeyFor('u1', { ...base, eventType: 'impression' }))
        .toBe('u1:s1:p1:impression');
    });

    it('keys a replay per occurrence, so retries dedupe but new replays do not', () => {
      const first = adapter.dedupeKeyFor('u1', { ...base, eventType: 'replay', clientExposureId: 'occ-1' });
      const retry = adapter.dedupeKeyFor('u1', { ...base, eventType: 'replay', clientExposureId: 'occ-1' });
      const second = adapter.dedupeKeyFor('u1', { ...base, eventType: 'replay', clientExposureId: 'occ-2' });
      expect(retry).toBe(first);
      expect(second).not.toBe(first);
    });

    it('keys a comment on the real comment id, with no session component', () => {
      expect(adapter.dedupeKeyFor('u1', { ...base, eventType: 'comment', commentId: 'c9' }))
        .toBe('u1:p1:comment:c9');
    });

    it('keys a follow on (subject, creator) alone, so refollowing cannot re-earn it', () => {
      expect(adapter.dedupeKeyFor('u1', { ...base, eventType: 'follow_after_view' }, 'creator-7'))
        .toBe('u1:creator-7:follow_after_view');
    });
  });
});

describe('demo recommendation personas', () => {
  const account = (username: string, topicKey: string) => ({ username, topicKey, posts: [] });

  it('gives the food account food as primary, with travel and photography secondary', () => {
    // The worked example from the task spec.
    const persona = personaFor(account('maitran.eats', 'food'));
    expect(persona.primary).toBe('food');
    expect(persona.secondary).toEqual(['travel', 'photography']);
    expect(persona.tierOf('food')).toBe(TIER.PRIMARY);
    expect(persona.tierOf('travel')).toBe(TIER.SECONDARY);
    expect(persona.tierOf('games')).toBe(TIER.OFF);
  });

  it('gives gaming, music/film, sports and knowledge accounts genuinely different shapes', () => {
    const shapes = ['games', 'music', 'sports', 'knowledge', 'anime', 'film'].map((topicKey) => {
      const persona = personaFor(account(`u-${topicKey}`, topicKey));
      return [persona.primary, ...persona.secondary].join('>');
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('degrades to no secondary interests for a category it does not know', () => {
    const persona = personaFor(account('u1', 'a-renamed-category'));
    expect(persona.secondary).toEqual([]);
    expect(persona.tierOf('a-renamed-category')).toBe(TIER.PRIMARY);
  });

  it('handles an account with no category at all without throwing', () => {
    const persona = personaFor({ username: 'u1', topicKey: null, posts: [] });
    expect(persona.primary).toBeNull();
    expect(persona.tierOf(null)).toBe(TIER.OFF);
    expect(persona.tierOf('food')).toBe(TIER.OFF);
  });
});

describe('cold-start selection', () => {
  const plan = {
    accounts: [
      {
        username: 'a',
        posts: [
          { seedKey: 'post:a:0', isPinned: true },
          { seedKey: 'post:a:1', isPinned: false },
          { seedKey: 'post:a:2', isPinned: false }
        ]
      },
      {
        username: 'b',
        posts: [
          { seedKey: 'post:b:0', isPinned: false },
          { seedKey: 'post:b:1', isPinned: true }
        ]
      }
    ]
  };

  it('picks each account\'s newest unpinned post, so no creator is disproportionately cold', () => {
    expect([...coldStartSeedKeys(plan)]).toEqual(['post:a:2', 'post:b:0']);
  });

  it('never picks a pinned post — pinning something with no engagement reads as a mistake', () => {
    const keys = coldStartSeedKeys(plan);
    expect(keys.has('post:a:0')).toBe(false);
    expect(keys.has('post:b:1')).toBe(false);
  });

  it('is deterministic across runs, so demo:verify can assert on the same posts', () => {
    expect([...coldStartSeedKeys(plan)]).toEqual([...coldStartSeedKeys(plan)]);
  });

  it('skips an account with no posts rather than throwing', () => {
    expect([...coldStartSeedKeys({ accounts: [{ username: 'c', posts: [] }] })]).toEqual([]);
  });
});
