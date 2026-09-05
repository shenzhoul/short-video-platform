import { ObjectId } from 'mongodb';
import { plainToInstance } from 'class-transformer';
import { FEED_SESSION_POLICY } from 'src/common/constants/recommendation';
import { PostRecommendationRequest } from 'src/payloads/content/post/post-recommendation.request';
import { RecommendationFeedService } from './recommendation-feed.service';
import { RecommendationSessionService } from './recommendation-session.service';
import { createFakeRedis } from './test-fake-redis';

/**
 * Feed-session **chains**: what makes an infinite scroll continue past the end
 * of one ranked session without either repeating it or turning the session into
 * the whole catalogue.
 *
 * The failure these cover is what shipped: Home's session limit is 70 against a
 * 160-post corpus, `hasMore` went false at the end of it, and the client had no
 * way to ask for more — the feed simply stopped, two thirds of the catalogue
 * unreachable. Raising 70 to 160 would have removed the ranking instead of
 * fixing the scroll (see `SESSION_OUTPUT_POLICY`'s note on why a session is a
 * bounded sample), so the boundary is a *successor session in the same chain*.
 */

function posts(count: number, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    _id: new ObjectId(),
    userId: new ObjectId(),
    topicKey: `topic-${(index + offset) % 4}`,
    totalLike: index,
    createdAt: new Date(Date.now() - index * 1000)
  }));
}

function makeCursor(result: any[]) {
  const cursor: any = {};
  cursor.select = jest.fn(() => cursor);
  cursor.sort = jest.fn(() => cursor);
  cursor.limit = jest.fn(() => cursor);
  cursor.lean = jest.fn().mockResolvedValue(result);
  return cursor;
}

/**
 * A feed service whose candidate retrieval is a real function of the exclusion
 * list, so "the chain excluded these" is observable rather than asserted on a
 * mock call.
 */
function service(options: { corpus?: any[]; sessionService?: any } = {}) {
  const corpus = options.corpus || posts(160);

  const candidateService: any = {
    retrieve: jest.fn().mockImplementation(({ eligibility }) => {
      const excluded = new Set((eligibility?.excludedPostIds || []).map(String));
      const all = corpus.filter((post) => !excluded.has(post._id.toString()));
      return Promise.resolve({ bySource: new Map([['trending', all]]), all });
    }),
    getFollowingCreatorIds: jest.fn().mockResolvedValue([])
  };
  const scoringService: any = {
    loadStats: jest.fn().mockResolvedValue(new Map()),
    loadPriors: jest.fn().mockResolvedValue(new Map()),
    score: jest.fn((post: any, source: string) => ({
      post, source, finalScore: post.totalLike / 1000, breakdown: {}
    }))
  };
  const diversityService: any = {
    rerank: jest.fn((order: any[], { limit }: any) => order.slice(0, limit))
  };
  const selectionService: any = {
    select: jest.fn(({ scored }: any) => ({ candidateOrder: scored, hero: scored[0] || null })),
    getRecentHeroes: jest.fn().mockResolvedValue([]),
    rememberHero: jest.fn().mockResolvedValue(undefined)
  };
  const affinityService: any = {
    getRaw: jest.fn().mockResolvedValue(null),
    topAffinities: jest.fn().mockReturnValue([]),
    formatPreferenceScore: jest.fn().mockReturnValue(0)
  };
  const detailSessionService: any = {
    stepForwardIfExists: jest.fn().mockResolvedValue(null),
    getState: jest.fn().mockResolvedValue(null),
    appendAndAdvance: jest.fn()
  };
  const postModel: any = {
    exists: jest.fn().mockResolvedValue(true),
    find: jest.fn().mockReturnValue(makeCursor([])),
    // `reorderByIds` reads the ranked ids straight back out of the corpus.
    ...{}
  };
  postModel.find = jest.fn((query: any) => {
    if (query?._id?.$in) {
      const wanted = new Set(query._id.$in.map(String));
      const found = corpus.filter((post) => wanted.has(post._id.toString()));
      return { lean: jest.fn().mockResolvedValue(found) };
    }
    return makeCursor([]);
  });
  const userRelationshipService: any = { getBlockedEitherDirectionIds: jest.fn().mockResolvedValue([]) };

  const { client, sets } = createFakeRedis();
  const sessionService = options.sessionService || new RecommendationSessionService(client);

  const svc = new RecommendationFeedService(
    postModel,
    candidateService,
    scoringService,
    diversityService,
    selectionService,
    sessionService,
    affinityService,
    detailSessionService,
    userRelationshipService
  );

  return {
    svc, sessionService, candidateService, corpus, sets, client
  };
}

const HOME = 'home' as any;

describe('feed session chains — Home continues past one session', () => {
  /** Scenario 1: Home reaches the session boundary and continues with another session. */
  it('a rollover creates a NEW session rather than re-reading the exhausted one', async () => {
    const { svc } = service();
    const subject = { anonymousId: 'anon-chain-1' };

    const first = await svc.getFeed({
      feedType: HOME, subject, limit: 20
    });
    expect(first.sessionId).toBeTruthy();

    const second = await svc.getFeed({
      feedType: HOME, subject, limit: 20, sessionId: first.sessionId, rollover: true
    });

    expect(second.sessionId).toBeTruthy();
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.data.length).toBeGreaterThan(0);
  });

  /** Scenario 2: immediate cross-session duplicates are avoided. */
  it('the successor session shares no post with the session it continues', async () => {
    const { svc, sessionService } = service();
    const subject = { anonymousId: 'anon-chain-2' };

    const first = await svc.getFeed({ feedType: HOME, subject, limit: 70 });
    const firstChain = await sessionService.getChainId(first.sessionId, 'anon-chain-2');
    const firstServed = await sessionService.getChainSeenIds(firstChain as string);
    expect(firstServed.length).toBe(70); // homeSessionItemLimit

    const second = await svc.getFeed({
      feedType: HOME, subject, limit: 70, sessionId: first.sessionId, rollover: true
    });

    const secondIds = second.data.map((post: any) => post._id.toString());
    expect(secondIds.length).toBeGreaterThan(0);
    expect(secondIds.filter((id: string) => firstServed.includes(id))).toEqual([]);
  });

  it('keeps the chain, so a third session excludes both earlier ones', async () => {
    const { svc, sessionService } = service();
    const subject = { anonymousId: 'anon-chain-3' };

    const a = await svc.getFeed({ feedType: HOME, subject, limit: 70 });
    const b = await svc.getFeed({
      feedType: HOME, subject, limit: 70, sessionId: a.sessionId, rollover: true
    });
    const chainId = await sessionService.getChainId(b.sessionId, 'anon-chain-3');

    // Same chain root all the way down — a rollover must not start a new one,
    // or every rollover would forget everything before it.
    expect(chainId).toBe(await sessionService.getChainId(a.sessionId, 'anon-chain-3'));

    const seenAfterTwo = await sessionService.getChainSeenIds(chainId as string);
    expect(seenAfterTwo.length).toBe(140);

    const c = await svc.getFeed({
      feedType: HOME, subject, limit: 70, sessionId: b.sessionId, rollover: true
    });
    const cIds = c.data.map((post: any) => post._id.toString());
    expect(cIds.filter((id: string) => seenAfterTwo.includes(id))).toEqual([]);
  });

  /** Scenario 3: seen posts are preferred against until the corpus is exhausted. */
  it('recycles the chain only once the eligible corpus is genuinely spent', async () => {
    // 30 posts and a 70-item session limit: the first session takes all 30, so
    // the very next rollover has nothing unseen left.
    const { svc, sessionService } = service({ corpus: posts(30) });
    const subject = { anonymousId: 'anon-chain-4' };

    const first = await svc.getFeed({ feedType: HOME, subject, limit: 30 });
    const chainId = await sessionService.getChainId(first.sessionId, 'anon-chain-4') as string;
    expect((await sessionService.getChainSeenIds(chainId)).length).toBe(30);

    const second = await svc.getFeed({
      feedType: HOME, subject, limit: 30, sessionId: first.sessionId, rollover: true
    });

    // Recycled rather than empty: an exhausted corpus must not render a dead
    // end, and the chain's memory is cleared so the next cycle starts fresh.
    expect(second.data.length).toBe(30);
    const seenAfterRecycle = await sessionService.getChainSeenIds(chainId);
    expect(seenAfterRecycle.length).toBe(30);
  });

  it('does not recycle while unseen posts remain', async () => {
    const { svc, sessionService } = service({ corpus: posts(160) });
    const subject = { anonymousId: 'anon-chain-5' };
    const resetSpy = jest.spyOn(sessionService, 'resetChainSeen');

    const first = await svc.getFeed({ feedType: HOME, subject, limit: 70 });
    await svc.getFeed({
      feedType: HOME, subject, limit: 70, sessionId: first.sessionId, rollover: true
    });

    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('recycles when the chain set reaches its ceiling, so Redis cannot grow without bound', async () => {
    const sessionService: any = {
      newSessionSeed: jest.fn().mockReturnValue('seed'),
      create: jest.fn().mockResolvedValue({ sessionId: 'next', chainId: 'chain-1' }),
      getPage: jest.fn().mockResolvedValue({
        sessionId: 'next', items: [], hasMore: false, nextCursor: null
      }),
      getChainId: jest.fn().mockResolvedValue('chain-1'),
      getChainSeenIds: jest.fn().mockResolvedValue(
        Array.from({ length: FEED_SESSION_POLICY.maxChainSeenIds }, () => new ObjectId().toString())
      ),
      resetChainSeen: jest.fn().mockResolvedValue(undefined)
    };
    const chained = service({ sessionService });

    await chained.svc.getFeed({
      feedType: HOME, subject: { anonymousId: 'anon-chain-6' }, limit: 20, sessionId: 'old', rollover: true
    });

    expect(sessionService.resetChainSeen).toHaveBeenCalledWith('chain-1');
    // The ceiling recycle must also drop the exclusions, or the successor is
    // ranked over an empty pool.
    const excluded = chained.candidateService.retrieve.mock.calls[0][0].eligibility.excludedPostIds;
    expect(excluded).toEqual([]);
  });

  it('without the rollover flag, a sessionId still pages the existing session', async () => {
    const { svc } = service();
    const subject = { anonymousId: 'anon-chain-7' };

    const first = await svc.getFeed({ feedType: HOME, subject, limit: 20 });
    const page2 = await svc.getFeed({
      feedType: HOME, subject, limit: 20, sessionId: first.sessionId, cursor: '20'
    });

    expect(page2.sessionId).toBe(first.sessionId);
  });

  it('refuses to resolve another subject\'s chain', async () => {
    const { svc, sessionService } = service();

    const first = await svc.getFeed({ feedType: HOME, subject: { anonymousId: 'owner-abc' }, limit: 20 });
    expect(await sessionService.getChainId(first.sessionId, 'someone-else')).toBeNull();

    // A rollover quoting somebody else's session gets a brand-new chain, not
    // theirs — so a guessed session id cannot reveal what they were shown.
    const stolen = await svc.getFeed({
      feedType: HOME, subject: { anonymousId: 'someone-else' }, limit: 20, sessionId: first.sessionId, rollover: true
    });
    const stolenChain = await sessionService.getChainId(stolen.sessionId, 'someone-else');
    expect(stolenChain).toBe(stolen.sessionId);
  });
});

describe('PostRecommendationRequest.rollover', () => {
  /*
   * `main.ts` runs the global pipe with `enableImplicitConversion`, which turns
   * a query string into `Boolean(string)` before any `@Transform` sees `value`
   * — and `Boolean('false')` is `true`. Parsing has to be asserted with that
   * option on, or the test passes while production sends every page down the
   * rollover branch (see rules/api.md).
   */
  const parse = (raw: Record<string, any>) => plainToInstance(
    PostRecommendationRequest, raw, { enableImplicitConversion: true }
  );

  it('is true only for a genuine true', () => {
    expect(parse({ rollover: 'true' }).rollover).toBe(true);
    expect(parse({ rollover: true }).rollover).toBe(true);
  });

  it('is false for the string "false", which implicit conversion would make true', () => {
    expect(parse({ rollover: 'false' }).rollover).toBe(false);
  });

  it('is absent when absent — never accidentally truthy', () => {
    // `undefined`, not `false`: class-transformer does not run a `@Transform`
    // for a key that is not there. `ContentService` reads it through
    // `Boolean(req.rollover)`, so the observable behaviour is "no rollover".
    expect(parse({}).rollover).toBeUndefined();
    expect(Boolean(parse({}).rollover)).toBe(false);
  });
});
