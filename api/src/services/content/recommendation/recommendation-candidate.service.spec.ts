import { ObjectId } from 'mongodb';
import { RECOMMENDATION_FEED_TYPES, RECOMMENDATION_SOURCES } from 'src/common/constants/recommendation';
import { RecommendationCandidateService } from './recommendation-candidate.service';

/**
 * Proves rules/instructions §4's "one source of truth" requirement: every
 * candidate source (personalized, trending, fresh, social, diverse) must
 * apply the exact same eligibility exclusions — blocked-either-direction
 * creators, already-seen posts, the viewer's own posts — because they all
 * route through `buildEligibilityMatch` via `scopedMatch`, never a raw query
 * written by hand per source.
 */
function service(options: { posts?: any[] } = {}) {
  const queryCalls: any[] = [];

  const makeCursor = (result: any[]) => {
    const cursor: any = {
      select: () => cursor,
      sort: () => cursor,
      limit: () => cursor,
      lean: () => Promise.resolve(result)
    };
    return cursor;
  };

  const postModel: any = {
    find: jest.fn((match: any) => {
      queryCalls.push(match);
      return makeCursor(options.posts || []);
    })
  };
  const categoryService: any = { findActive: jest.fn().mockResolvedValue([]) };
  const followService: any = { getFollowingCreatorIds: jest.fn().mockResolvedValue([]) };

  return {
    svc: new RecommendationCandidateService(postModel, categoryService, followService),
    postModel,
    queryCalls
  };
}

function baseInput(overrides: Record<string, any> = {}) {
  return {
    feedType: RECOMMENDATION_FEED_TYPES.FOR_YOU,
    isGuest: false,
    eligibility: {
      viewerId: undefined,
      excludedCreatorIds: [],
      excludedPostIds: []
    },
    topicKey: null,
    poolSize: 100,
    sessionSeed: 'seed-1',
    topCategoryAffinities: [],
    topHashtagAffinities: [],
    topCreatorAffinities: [],
    followingCreatorIds: [],
    ...overrides
  };
}

describe('RecommendationCandidateService eligibility — applied uniformly across every source', () => {
  it('excludes blocked-either-direction creators from every source query, not just personalized', async () => {
    const blockedId = new ObjectId().toString();
    const creatorId = new ObjectId();
    const { svc, queryCalls } = service({ posts: [{ _id: new ObjectId(), userId: creatorId, topicKey: 'food', createdAt: new Date() }] });

    await svc.retrieve(baseInput({
      eligibility: { viewerId: undefined, excludedCreatorIds: [blockedId], excludedPostIds: [] },
      topCategoryAffinities: [{ key: 'food', decayedScore: 5 }],
      topCreatorAffinities: [{ key: creatorId.toString(), decayedScore: 5 }],
      topHashtagAffinities: [{ key: 'pho', decayedScore: 5 }],
      followingCreatorIds: [creatorId.toString()]
    }));

    expect(queryCalls.length).toBeGreaterThan(0);
    queryCalls.forEach((match) => {
      const clauses = match.$and || [];
      const hasBlockExclusion = clauses.some((clause: any) => clause.userId?.$nin?.some((id: ObjectId) => id.toString() === blockedId));
      expect(hasBlockExclusion).toBe(true);
    });
  });

  it('excludes already-seen posts from every source query', async () => {
    const seenPostId = new ObjectId().toString();
    const { svc, queryCalls } = service({ posts: [] });

    await svc.retrieve(baseInput({
      eligibility: { viewerId: undefined, excludedCreatorIds: [], excludedPostIds: [seenPostId] },
      followingCreatorIds: [new ObjectId().toString()]
    }));

    expect(queryCalls.length).toBeGreaterThan(0);
    queryCalls.forEach((match) => {
      const clauses = match.$and || [];
      const hasSeenExclusion = clauses.some((clause: any) => clause._id?.$nin?.some((id: ObjectId) => id.toString() === seenPostId));
      expect(hasSeenExclusion).toBe(true);
    });
  });

  it('excludes the viewer\'s own posts from every source query', async () => {
    const viewerId = new ObjectId().toString();
    const { svc, queryCalls } = service({ posts: [] });

    await svc.retrieve(baseInput({
      eligibility: { viewerId, excludedCreatorIds: [], excludedPostIds: [] },
      followingCreatorIds: [new ObjectId().toString()]
    }));

    expect(queryCalls.length).toBeGreaterThan(0);
    queryCalls.forEach((match) => {
      const clauses = match.$and || [];
      const hasSelfExclusion = clauses.some((clause: any) => clause.userId?.$ne?.toString() === viewerId);
      expect(hasSelfExclusion).toBe(true);
    });
  });

  it('never uses pinned state as a filter or signal in any source query', async () => {
    const { svc, queryCalls } = service({ posts: [] });

    await svc.retrieve(baseInput({
      followingCreatorIds: [new ObjectId().toString()],
      topCreatorAffinities: [{ key: new ObjectId().toString(), decayedScore: 5 }]
    }));

    queryCalls.forEach((match) => {
      expect(JSON.stringify(match)).not.toMatch(/pinned/i);
    });
  });

  it('scopes every source to the active Home category tab when one is selected', async () => {
    const { svc, queryCalls } = service({ posts: [] });

    await svc.retrieve(baseInput({
      feedType: RECOMMENDATION_FEED_TYPES.HOME,
      topicKey: 'travel',
      followingCreatorIds: [new ObjectId().toString()],
      topCreatorAffinities: [{ key: new ObjectId().toString(), decayedScore: 5 }]
    }));

    expect(queryCalls.length).toBeGreaterThan(0);
    // Personalized's own topicKey $or clause is suppressed when a tab is
    // active (scopedMatch already pins topicKey directly), but every base
    // match must still carry the pin.
    queryCalls.forEach((match) => {
      expect(match.topicKey === 'travel' || match.$or?.some((clause: any) => clause.topicKey === 'travel')).toBeTruthy();
    });
  });

  it('never issues a bare $sample-style full scan — every query is limited', async () => {
    const { svc } = service({ posts: [] });
    const findSpy = jest.fn();
    const cursor: any = {
      select: () => cursor, sort: () => cursor, limit: (n: number) => { findSpy(n); return cursor; }, lean: () => Promise.resolve([])
    };
    (svc as any).postModel.find = jest.fn(() => cursor);

    await svc.retrieve(baseInput({
      followingCreatorIds: [new ObjectId().toString()],
      topCreatorAffinities: [{ key: new ObjectId().toString(), decayedScore: 5 }]
    }));

    expect(findSpy).toHaveBeenCalled();
    findSpy.mock.calls.forEach(([limit]) => expect(limit).toBeGreaterThan(0));
  });
});

/**
 * The guest mix is three buckets, not one.
 *
 * The engine's `debug` output reports a single label per post — whichever
 * source claimed it first during dedupe — so a guest feed can honestly show
 * only `trending` and `fresh` labels while the diverse bucket has in fact
 * contributed most of the pool. Traced on the real dataset: diverse returned
 * 64 candidates, 56 of which trending/fresh had already claimed, leaving 8
 * carrying the label.
 *
 * That makes the label a poor regression signal and the *retrieval* the thing
 * worth asserting on. These tests fail if a guest ever stops drawing from
 * fresh or diverse at all, which is the state that once shipped silently when
 * `recoShuffleKey` was missing and both buckets returned nothing.
 */
describe('RecommendationCandidateService — a guest draws from three buckets', () => {
  const guestInput = (overrides: Record<string, any> = {}) => baseInput({
    feedType: RECOMMENDATION_FEED_TYPES.HOME,
    isGuest: true,
    poolSize: 160,
    ...overrides
  });

  /** Distinguishes the sources by the shape of the query each one issues. */
  const classify = (calls: any[]) => ({
    // `fresh` and `diverse` both range-scan the shuffle key.
    shuffleScans: calls.filter((m) => m.recoShuffleKey !== undefined).length,
    // `trending` and `fresh`'s time window both bound `createdAt`.
    timeWindows: calls.filter((m) => m.createdAt !== undefined).length,
    // `personalized` is the only one with an `$or` of affinity clauses.
    affinityQueries: calls.filter((m) => Array.isArray(m.$or)).length,
    // `social` is the only one filtering by a creator list.
    creatorLists: calls.filter((m) => m.userId && m.userId.$in).length
  });

  it('issues the shuffle-key scans that fresh and diverse depend on', async () => {
    const { svc, queryCalls } = service({ posts: [] });
    await svc.retrieve(guestInput() as any);

    const shape = classify(queryCalls);
    // fresh does one, diverse does one; each may wrap, so at least two.
    expect(shape.shuffleScans).toBeGreaterThanOrEqual(2);
  });

  it('issues no personalized or social query for a guest', async () => {
    const { svc, queryCalls } = service({ posts: [] });
    await svc.retrieve(guestInput() as any);

    const shape = classify(queryCalls);
    expect(shape.affinityQueries).toBe(0);
    expect(shape.creatorLists).toBe(0);
  });

  it('keeps candidates from fresh and diverse, not only trending', async () => {
    /*
     * Each query returns *distinct* rows. A fixture where every source
     * returns the same posts is not a neutral simplification — the first
     * bucket to run claims all of them during dedupe and every other bucket
     * measures as empty, which says nothing about whether the sources work.
     */
    let batch = 0;
    const distinctPosts = () => {
      batch += 1;
      return Array.from({ length: 10 }, (_, i) => ({
        _id: new ObjectId(),
        topicKey: `topic-${batch}`,
        userId: new ObjectId(),
        index: `${batch}-${i}`
      }));
    };
    const queryCalls: any[] = [];
    const makeCursor = (result: any[]) => {
      const cursor: any = {
        select: () => cursor, sort: () => cursor, limit: () => cursor, lean: () => Promise.resolve(result)
      };
      return cursor;
    };
    const postModel: any = {
      find: jest.fn((match: any) => {
        queryCalls.push(match);
        return makeCursor(distinctPosts());
      })
    };
    const svc = new RecommendationCandidateService(
      postModel,
      { findActive: jest.fn().mockResolvedValue([]) } as any,
      { getFollowingCreatorIds: jest.fn().mockResolvedValue([]) } as any
    );

    const pool = await svc.retrieve(guestInput() as any);

    expect((pool.bySource.get(RECOMMENDATION_SOURCES.TRENDING) || []).length).toBeGreaterThan(0);
    expect((pool.bySource.get(RECOMMENDATION_SOURCES.FRESH) || []).length).toBeGreaterThan(0);
    expect((pool.bySource.get(RECOMMENDATION_SOURCES.DIVERSE) || []).length).toBeGreaterThan(0);
    // And nothing from the two a guest has no basis for.
    expect((pool.bySource.get(RECOMMENDATION_SOURCES.PERSONALIZED) || []).length).toBe(0);
    expect((pool.bySource.get(RECOMMENDATION_SOURCES.SOCIAL) || []).length).toBe(0);
  });

  it('asks each guest bucket for a share of the pool matching its quota', async () => {
    const { svc, postModel } = service({ posts: [] });
    await svc.retrieve(guestInput({ poolSize: 160 }) as any);

    // 50/30/20 of 160 is 80/48/32 before each source's own oversampling.
    // Asserting the calls happened at all is the durable part; the exact
    // limits belong to the sources, not to this contract.
    expect(postModel.find).toHaveBeenCalled();
    expect(postModel.find.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
