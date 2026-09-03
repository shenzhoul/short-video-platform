import { ObjectId } from 'mongodb';
import { DIVERSITY_POLICY } from 'src/common/constants/recommendation';
import { RecommendationDiversityService } from './recommendation-diversity.service';
import { ScoredCandidate } from './recommendation-scoring.service';

const SOURCE_CYCLE = ['personalized', 'trending', 'fresh', 'social', 'diverse'] as const;
let sourceCycleIndex = 0;

function candidate(overrides: Partial<{
  userId: ObjectId; topicKey: string; score: number; source: any;
}> = {}): ScoredCandidate {
  const {
    userId = new ObjectId(),
    topicKey = 'food',
    score = Math.random(),
    // Cycled rather than a single fixed default: a homogeneous `source`
    // across every synthetic candidate would make the "no more than 4
    // consecutive same source" constraint universally unsatisfiable and mask
    // whatever this test is actually isolating, the same way a homogeneous
    // `topicKey` masks the creator cap by saturating the category cap first.
    source = SOURCE_CYCLE[(sourceCycleIndex += 1) % SOURCE_CYCLE.length]
  } = overrides;
  return {
    post: {
      _id: new ObjectId(), userId, topicKey, tags: [], createdAt: new Date()
    } as any,
    source,
    finalScore: score,
    breakdown: {
      userInterest: 0, watchQuality: 0, engagementQuality: 0, freshness: 0, explorationBonus: 0, creatorAffinity: 0, sessionJitter: 0
    },
    explorationStage: 2
  };
}

describe('RecommendationDiversityService', () => {
  it('never places the same creator in two consecutive positions when alternatives exist', () => {
    const svc = new RecommendationDiversityService();
    // Ten distinct creators, two posts each. A real candidate pool has dozens
    // of creators; a two-creator pool (the original version of this test) is
    // actually infeasible for "no consecutive" to hold across a full
    // window-sized list, because both creators inevitably exhaust their
    // per-window budget at the same time with nothing else to interleave —
    // that is a supply problem the fixture created, not a reranker bug.
    const creators = Array.from({ length: 10 }, () => new ObjectId());
    const scored: ScoredCandidate[] = creators.flatMap((creatorId, ci) => Array.from(
      { length: 2 },
      (_, i) => candidate({ userId: creatorId, topicKey: `cat-${(ci + i) % 8}`, score: 1 - (ci * 2 + i) * 0.01 })
    ));

    const ranked = svc.rerank(scored);

    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i].post.userId.toString()).not.toBe(ranked[i - 1].post.userId.toString());
    }
  });

  it('caps how many times one creator appears within a sliding window of batchSize', () => {
    const svc = new RecommendationDiversityService();
    const spammer = new ObjectId();
    // A creator at 6% of a 100-post pool — already generous, since candidate
    // retrieval's own creator-spam guard caps a creator's share of the fresh
    // bucket well below this — against 94 posts from distinct creators, so a
    // cap of 2-per-20-window is achievable across the *entire* list, not just
    // until one side runs out of supply (the original 33%-share fixture could
    // not mathematically satisfy its own assertion, independent of the
    // reranker's correctness).
    const scored: ScoredCandidate[] = [
      ...Array.from({ length: 6 }, (_, i) => candidate({ userId: spammer, topicKey: `cat-${i % 8}`, score: 1 - i * 0.01 })),
      ...Array.from({ length: 94 }, (_, i) => candidate({ topicKey: `cat-${i % 8}`, score: Math.random() * 0.9 }))
    ];

    const ranked = svc.rerank(scored);
    const windowSize = DIVERSITY_POLICY.batchSize;

    for (let start = 0; start + windowSize <= ranked.length; start += 1) {
      const window = ranked.slice(start, start + windowSize);
      const count = window.filter((c) => c.post.userId.toString() === spammer.toString()).length;
      expect(count).toBeLessThanOrEqual(DIVERSITY_POLICY.maxSameCreatorPerBatch);
    }
  });

  it('never drops a candidate even when constraints cannot all be satisfied (small/homogeneous pool)', () => {
    const svc = new RecommendationDiversityService();
    const sameCreator = new ObjectId();
    // Every candidate shares one creator — constraints cannot all hold, but
    // nothing should vanish.
    const scored: ScoredCandidate[] = Array.from({ length: 8 }, (_, i) => candidate({ userId: sameCreator, score: i }));
    const ranked = svc.rerank(scored);
    expect(ranked).toHaveLength(scored.length);
  });

  it('is deterministic for a fixed input list', () => {
    const svc = new RecommendationDiversityService();
    const scored: ScoredCandidate[] = Array.from({ length: 40 }, () => candidate({ score: Math.random() }));
    const a = svc.rerank(scored).map((c) => c.post._id.toString());
    const b = svc.rerank(scored).map((c) => c.post._id.toString());
    expect(a).toEqual(b);
  });
});
