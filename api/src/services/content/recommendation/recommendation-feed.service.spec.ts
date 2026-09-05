import { ObjectId } from 'mongodb';
import { SESSION_OUTPUT_POLICY } from 'src/common/constants/recommendation';
import { RecommendationFeedService } from './recommendation-feed.service';

function makeCursor(result: any[]) {
  const cursor: any = {
    select: () => cursor, sort: () => cursor, limit: () => cursor, lean: () => Promise.resolve(result)
  };
  return cursor;
}

function service(options: {
  replayExists?: boolean;
  replayPostId?: string;
  isReplayAlive?: boolean;
  freshCandidates?: any[];
  /** Candidates returned while `excludedPostIds` is non-empty. */
  poolWhenSuppressed?: any[];
  /** Candidates returned once suppression is dropped. */
  poolWhenRelaxed?: any[];
  /** The viewer's `recentlySeenPostIds`. */
  seenPostIds?: string[];
  /** The chain id `getChainId` resolves a rollover to. */
  chainId?: string | null;
  /** Post ids the chain has already served. */
  chainSeenPostIds?: string[];
} = {}) {
  const replayPostId = options.replayPostId || new ObjectId().toString();

  const postModel: any = {
    exists: jest.fn().mockResolvedValue(options.isReplayAlive ?? true),
    find: jest.fn().mockReturnValue(makeCursor(options.freshCandidates || []))
  };
  const candidateService: any = {
    retrieve: jest.fn().mockImplementation(({ eligibility }) => {
      // Lets a test say "this many candidates survive suppression, this many
      // without it", which is the whole shape of the starvation bug.
      const suppressed = (eligibility?.excludedPostIds || []).length;
      const all = suppressed && options.poolWhenSuppressed !== undefined
        ? options.poolWhenSuppressed
        : (options.poolWhenRelaxed ?? options.freshCandidates ?? []);
      // Scoring walks `bySource`, not `all`, so a pool that only fills `all`
      // scores nothing and every assertion on `ranked` reads zero.
      return Promise.resolve({ bySource: new Map([['trending', all]]), all });
    }),
    getFollowingCreatorIds: jest.fn().mockResolvedValue([])
  };
  const scoringService: any = {
    loadStats: jest.fn().mockResolvedValue(new Map()),
    loadPriors: jest.fn().mockResolvedValue(new Map()),
    score: jest.fn((post: any, source: any) => ({
      post, source, finalScore: Math.random(), breakdown: {}, explorationStage: 2
    }))
  };
  // Honours `limit`, as the real re-ranker does — it is the step that decides
  // the session length now, not selection.
  const diversityService: any = {
    rerank: jest.fn((order: any[], options: any = {}) => (
      options.limit ? order.slice(0, options.limit) : order
    ))
  };
  // The real selection service samples; these tests are about the orchestration
  // around it, so this one passes the pool through in score order and reports
  // the leader as the hero — a deterministic stand-in with the same contract.
  const selectionService: any = {
    select: jest.fn(({ scored }: any) => {
      const ordered = [...scored].sort((a: any, b: any) => b.finalScore - a.finalScore);
      return { candidateOrder: ordered, hero: ordered[0] || null };
    }),
    getRecentHeroes: jest.fn().mockResolvedValue([]),
    rememberHero: jest.fn().mockResolvedValue(undefined)
  };
  const sessionService: any = {
    newSessionSeed: jest.fn().mockReturnValue('deterministic-seed'),
    create: jest.fn().mockResolvedValue({ sessionId: 'new-session-id', chainId: 'new-session-id' }),
    getPage: jest.fn().mockResolvedValue({
      sessionId: 'new-session-id', items: [], hasMore: false, nextCursor: null
    }),
    getChainId: jest.fn().mockResolvedValue(options.chainId ?? null),
    getChainSeenIds: jest.fn().mockResolvedValue(options.chainSeenPostIds || []),
    resetChainSeen: jest.fn().mockResolvedValue(undefined)
  };
  const affinityService: any = {
    getRaw: jest.fn().mockResolvedValue(
      options.seenPostIds ? { recentlySeenPostIds: options.seenPostIds } : null
    ),
    topAffinities: jest.fn().mockReturnValue([]),
    formatPreferenceScore: jest.fn().mockReturnValue(0)
  };
  const detailSessionService: any = {
    stepForwardIfExists: jest.fn().mockResolvedValue(
      options.replayExists === false
        ? null
        : { sessionId: 's1', items: [{ postId: replayPostId, source: 'personalized' }], cursorIndex: 0, sessionSeed: 'seed' }
    ),
    getState: jest.fn().mockResolvedValue({
      sessionId: 's1', items: [{ postId: replayPostId, source: 'personalized' }], cursorIndex: 0, sessionSeed: 'seed'
    }),
    appendAndAdvance: jest.fn().mockImplementation((sessionId, subjectId, item) => Promise.resolve({
      sessionId, items: [{ postId: replayPostId, source: 'personalized' }, item], cursorIndex: 1, sessionSeed: 'seed'
    }))
  };
  const userRelationshipService: any = { getBlockedEitherDirectionIds: jest.fn().mockResolvedValue([]) };

  return {
    svc: new RecommendationFeedService(
      postModel,
      candidateService,
      scoringService,
      diversityService,
      selectionService,
      sessionService,
      affinityService,
      detailSessionService,
      userRelationshipService
    ),
    postModel,
    candidateService,
    selectionService,
    sessionService,
    detailSessionService,
    replayPostId
  };
}

describe('RecommendationFeedService.detailNext', () => {
  it('replays the next item already in the session when it is still alive (no recompute)', async () => {
    const { svc, postModel, replayPostId } = service({ isReplayAlive: true });

    const result = await svc.detailNext('sess-1', { viewerId: new ObjectId().toString() });

    expect(result?.postId).toBe(replayPostId);
    expect(postModel.exists).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    // No fresh candidate query issued — this was a pure replay.
    expect(postModel.find).not.toHaveBeenCalled();
  });

  it('skips a replayed post that was deleted/deactivated since being appended, generating a fresh one instead', async () => {
    const freshCandidate = {
      _id: new ObjectId(), userId: new ObjectId(), topicKey: 'food', tags: [], createdAt: new Date()
    };
    const { svc, detailSessionService, replayPostId } = service({
      isReplayAlive: false,
      freshCandidates: [freshCandidate]
    });

    const result = await svc.detailNext('sess-1', { viewerId: new ObjectId().toString() });

    expect(result?.postId).toBe(freshCandidate._id.toString());
    expect(result?.postId).not.toBe(replayPostId);
    // The dead entry stays in session history (a tombstone `previous` can
    // still step back onto) — appendAndAdvance adds the fresh one after it,
    // it does not rewrite the dead slot.
    expect(detailSessionService.appendAndAdvance).toHaveBeenCalledWith(
      'sess-1',
      expect.any(String),
      expect.objectContaining({ postId: freshCandidate._id.toString() })
    );
  });

  it('returns null when there is no next item and no eligible fresh candidate either', async () => {
    const { svc } = service({ replayExists: false, freshCandidates: [] });
    const result = await svc.detailNext('sess-1', { viewerId: new ObjectId().toString() });
    expect(result).toBeNull();
  });

  it('returns null for an unauthenticated, anonymous-id-less subject', async () => {
    const { svc } = service();
    const result = await svc.detailNext('sess-1', {});
    expect(result).toBeNull();
  });
});

describe('RecommendationFeedService.getFeed — guest without an anonymousId', () => {
  /*
   * This threw, and the global filter turned it into an unhandled 500 on
   * `GET /posts/home-posts`. The caller it hit was the most ordinary one
   * there is — a first-time visitor, before the client has generated and
   * stored an anonymous id — so Home simply failed to load for them. Found
   * by a browser pass rather than by any unit test, because every test and
   * script until then had always supplied an id.
   */
  it('serves a feed instead of throwing', async () => {
    const { svc } = service();
    const result = await svc.getFeed({
      feedType: 'home' as any,
      subject: {},
      limit: 10
    });
    expect(result.sessionId).toBeTruthy();
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('registers the session under the same key it then reads pages back with', async () => {
    const { svc, sessionService } = service();
    await svc.getFeed({ feedType: 'home' as any, subject: {}, limit: 10 });

    const createdWith = sessionService.create.mock.calls[0][0].subjectId;
    const readWith = sessionService.getPage.mock.calls[0][1];
    expect(createdWith).toBeTruthy();
    expect(readWith).toBe(createdWith);
  });

  it('does not look up affinity for an identity that names nobody', async () => {
    const { svc } = service();
    const affinityCalls: any[] = [];
    (svc as any).affinityService.getRaw = jest.fn((id: string) => {
      affinityCalls.push(id);
      return Promise.resolve(null);
    });
    await svc.getFeed({ feedType: 'home' as any, subject: {}, limit: 10 });
    expect(affinityCalls).toHaveLength(0);
  });

  it('still reads affinity for a real anonymous session id', async () => {
    const { svc } = service();
    const getRaw = jest.fn().mockResolvedValue(null);
    (svc as any).affinityService.getRaw = getRaw;
    await svc.getFeed({ feedType: 'home' as any, subject: { anonymousId: 'anon-1' }, limit: 10 });
    expect(getRaw).toHaveBeenCalledWith('anon-1');
  });
});

/** A pool of `n` distinct candidates, each from its own creator. */
const posts = (n: number) => Array.from({ length: n }, () => ({
  _id: new ObjectId(), topicKey: 'food', userId: new ObjectId()
}));

describe('RecommendationFeedService.getFeed — seen-suppression must not starve the feed', () => {

  /*
   * Measured in a real browser: an engaged viewer had 140 of 160 active posts
   * in `recentlySeenPostIds`, 10 more were their own, and Home rendered
   * "Your Feed is Empty". Showing somebody a post twice is a far smaller
   * failure than showing them nothing.
   */
  it('drops suppression when it is what leaves the viewer with nothing', async () => {
    const { svc, sessionService } = service({
      seenPostIds: Array.from({ length: 140 }, () => new ObjectId().toString()),
      poolWhenSuppressed: [],
      poolWhenRelaxed: posts(30)
    });

    await svc.getFeed({
      feedType: 'home' as any, subject: { viewerId: new ObjectId().toString() }, limit: 10
    });

    const ranked = sessionService.create.mock.calls[0][0].ranked;
    expect(ranked.length).toBe(30);
  });

  it('keeps suppressing when there is still plenty to serve', async () => {
    const { svc, candidateService } = service({
      seenPostIds: Array.from({ length: 20 }, () => new ObjectId().toString()),
      poolWhenSuppressed: posts(60),
      poolWhenRelaxed: posts(160)
    });

    await svc.getFeed({
      feedType: 'home' as any, subject: { viewerId: new ObjectId().toString() }, limit: 10
    });

    // One retrieval only: no reason to relax, so no second attempt.
    expect(candidateService.retrieve).toHaveBeenCalledTimes(1);
  });

  it('does not retry for a viewer who has seen nothing yet', async () => {
    const { svc, candidateService } = service({ poolWhenRelaxed: [] });
    await svc.getFeed({
      feedType: 'home' as any, subject: { viewerId: new ObjectId().toString() }, limit: 10
    });
    expect(candidateService.retrieve).toHaveBeenCalledTimes(1);
  });

  it('keeps the suppressed result when relaxing does not actually help', async () => {
    const { svc, sessionService } = service({
      seenPostIds: [new ObjectId().toString()],
      poolWhenSuppressed: posts(3),
      poolWhenRelaxed: posts(3)
    });
    await svc.getFeed({
      feedType: 'home' as any, subject: { viewerId: new ObjectId().toString() }, limit: 10
    });
    expect(sessionService.create.mock.calls[0][0].ranked.length).toBe(3);
  });
});

/**
 * A session is a bounded, rotated subset of the pool — not the pool.
 *
 * Before this, retrieval and the session were the same number, and on a
 * 160-post catalogue that meant a session held everything. Ten guest reloads
 * produced ten orderings of one fixed set, all led by the same post.
 */
describe('RecommendationFeedService.getFeed — a session is a subset, not the catalogue', () => {
  it('bounds a Home session below the candidate pool', async () => {
    const { svc, sessionService } = service({ poolWhenRelaxed: posts(160) });

    await svc.getFeed({
      feedType: 'home' as any, subject: { viewerId: new ObjectId().toString() }, limit: 20
    });

    const ranked = sessionService.create.mock.calls[0][0].ranked;
    expect(ranked.length).toBe(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
    expect(ranked.length).toBeLessThan(160);
  });

  it('hands the whole candidate order to the re-ranker, with the session limit', async () => {
    const { svc } = service({ poolWhenRelaxed: posts(160) });
    const rerank = jest.fn((order: any[], options: any) => order.slice(0, options.limit));
    (svc as any).diversityService = { rerank };

    await svc.getFeed({
      feedType: 'home' as any, subject: { viewerId: new ObjectId().toString() }, limit: 20
    });

    // Selection must not truncate: a session composed before any diversity rule
    // is consulted can be impossible to make compliant afterwards.
    expect(rerank.mock.calls[0][0]).toHaveLength(160);
    expect(rerank.mock.calls[0][1]).toEqual(expect.objectContaining({
      limit: SESSION_OUTPUT_POLICY.homeSessionItemLimit, preserveOrder: true
    }));
  });

  it('gives For You its own, shorter segment', async () => {
    const { svc } = service({ poolWhenRelaxed: posts(160) });
    const rerank = jest.fn((order: any[], options: any) => order.slice(0, options.limit));
    (svc as any).diversityService = { rerank };

    await svc.getFeed({
      feedType: 'for-you' as any, subject: { viewerId: new ObjectId().toString() }, limit: 10
    });

    expect(rerank.mock.calls[0][1].limit).toBe(SESSION_OUTPUT_POLICY.forYouInitialSessionLimit);
  });

  it('reads the lead cooldown for an identified subject and records the new lead', async () => {
    const { svc, selectionService } = service({ poolWhenRelaxed: posts(30) });
    const viewerId = new ObjectId().toString();

    await svc.getFeed({ feedType: 'home' as any, subject: { viewerId }, limit: 20 });

    expect(selectionService.getRecentHeroes).toHaveBeenCalledWith('home', viewerId);
    expect(selectionService.rememberHero).toHaveBeenCalledWith('home', viewerId, expect.any(String));
  });

  it('skips the cooldown entirely for a guest with no identity to key it on', async () => {
    const { svc, selectionService } = service({ poolWhenRelaxed: posts(30) });

    await svc.getFeed({ feedType: 'home' as any, subject: {}, limit: 20 });

    expect(selectionService.getRecentHeroes).not.toHaveBeenCalled();
    expect(selectionService.rememberHero).not.toHaveBeenCalled();
  });

  it('hands the lead to the re-ranker rather than splicing it in afterwards', async () => {
    const { svc, sessionService, selectionService } = service({ poolWhenRelaxed: posts(30) });
    const rerank = jest.fn((order: any[], options: any) => [
      options.lead,
      ...order.filter((c: any) => c.post._id.toString() !== options.lead.post._id.toString())
    ]);
    (svc as any).diversityService = { rerank };

    await svc.getFeed({
      feedType: 'home' as any, subject: { viewerId: new ObjectId().toString() }, limit: 20
    });

    const heroId = selectionService.select.mock.results[0].value.hero.post._id.toString();
    // The lead is an *input* to re-ranking. Splicing it in afterwards is what
    // left the emitted order uncertified by the diversity pass.
    expect(rerank).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      lead: expect.objectContaining({ post: expect.objectContaining({ _id: expect.anything() }) })
    }));
    expect(rerank.mock.calls[0][1].lead.post._id.toString()).toBe(heroId);

    const ranked = sessionService.create.mock.calls[0][0].ranked;
    expect(ranked[0].post._id.toString()).toBe(heroId);
    // …and nothing was lost or duplicated on the way to the session.
    expect(new Set(ranked.map((c: any) => c.post._id.toString())).size).toBe(ranked.length);
  });
});

/**
 * The lead cooldown is per subject, and a guest is a subject only when they
 * brought an identity of their own.
 */
describe('RecommendationFeedService — guest lead cooldown isolation', () => {
  it('keys the cooldown to each anonymous id, never to a shared global key', async () => {
    const { svc, selectionService } = service({ poolWhenRelaxed: posts(30) });

    await svc.getFeed({ feedType: 'home' as any, subject: { anonymousId: 'guest-a' }, limit: 20 });
    await svc.getFeed({ feedType: 'home' as any, subject: { anonymousId: 'guest-b' }, limit: 20 });

    const keys = selectionService.getRecentHeroes.mock.calls.map((call: any[]) => call[1]);
    expect(keys).toEqual(['guest-a', 'guest-b']);
    const written = selectionService.rememberHero.mock.calls.map((call: any[]) => call[1]);
    expect(written).toEqual(['guest-a', 'guest-b']);
  });

  it('serves a first-time guest with no id at all, and stores nothing under them', async () => {
    const { svc, selectionService } = service({ poolWhenRelaxed: posts(30) });

    const result = await svc.getFeed({ feedType: 'home' as any, subject: {}, limit: 20 });

    expect(result.sessionId).toBeTruthy();
    // An ephemeral key names nobody: reading it is a guaranteed miss and writing
    // to it would leave a row nothing can ever read again.
    expect(selectionService.getRecentHeroes).not.toHaveBeenCalled();
    expect(selectionService.rememberHero).not.toHaveBeenCalled();
  });

  it('keeps one guest\'s cooldown out of another\'s, and Home\'s out of For You\'s', async () => {
    const { svc, selectionService } = service({ poolWhenRelaxed: posts(30) });

    await svc.getFeed({ feedType: 'home' as any, subject: { anonymousId: 'guest-a' }, limit: 20 });
    await svc.getFeed({ feedType: 'for-you' as any, subject: { anonymousId: 'guest-a' }, limit: 10 });

    const pairs = selectionService.getRecentHeroes.mock.calls.map((call: any[]) => `${call[0]}/${call[1]}`);
    expect(pairs).toEqual(['home/guest-a', 'for-you/guest-a']);
  });
});
