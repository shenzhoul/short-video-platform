import { plainToInstance } from 'class-transformer';
import { ObjectId } from 'mongodb';
import { CHAIN_POLICY, SESSION_OUTPUT_POLICY } from 'src/common/constants/recommendation';
import { REDIS_KEYS } from 'src/kernel/infras/redis/redis-keys';
import { PostRecommendationRequest } from 'src/payloads/content/post/post-recommendation.request';
import { RecommendationChainService } from './recommendation-chain.service';
import { RecommendationFeedService } from './recommendation-feed.service';
import { RecommendationSessionService } from './recommendation-session.service';
import { createFakeRedis } from './test-fake-redis';

/**
 * Browsing chains, driven end to end against a 160-post corpus.
 *
 * ## The production failure these reproduce
 *
 * `deploy-2026-09-06g` shipped chains but excluded the union of the chain's
 * served posts *and* the subject's `recentlySeenPostIds`, dropping the whole
 * suppression only once fewer than ten candidates survived. Measured in
 * production on 160 posts:
 *
 * - **Home stopped at 89.** Session 1 served 70; session 2's pool was
 *   160 − (71 already in `recentlySeenPostIds` ∪ 70 in the chain) = 19; session
 *   3 relaxed to the whole corpus and returned only posts already on screen,
 *   which the client discarded as duplicates and reported as exhaustion.
 * - **A reload then stopped at 11.** By then `recentlySeenPostIds` held ~149
 *   distinct ids, so the first session of a brand-new chain had a pool of 11 —
 *   and 11 is not below the threshold of 10, so nothing relaxed.
 *
 * Every assertion below counts **distinct post ids actually served**, because
 * that is the only number that would have caught either failure.
 *
 * ## And the failure the first fix introduced
 *
 * `deploy-2026-09-06h` made an exhausted chain *recycle* and hand the catalogue
 * out again under a new cycle number. It never ended: Home reached **410 cards**
 * of a 160-post corpus, openly repeating itself. A chain now **ends** — it says
 * `chainExhausted` and stops. Starting over is the viewer's decision, and both
 * ways of taking it ("Refresh recommendations", a reload) mint a new chain id.
 */

const CORPUS_SIZE = 160;
const HOME = 'home' as any;
const FOR_YOU = 'for-you' as any;

function makeCorpus(count = CORPUS_SIZE) {
  return Array.from({ length: count }, (_, index) => ({
    _id: new ObjectId(),
    // 16 creators x 10 posts, which is the shape of the seeded demo dataset.
    userId: new ObjectId(),
    topicKey: `topic-${index % 8}`,
    totalLike: count - index,
    createdAt: new Date(Date.now() - index * 60_000)
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
 * A feed service whose retrieval is a real function of the exclusion list, so
 * "the chain excluded these" is an observable outcome rather than an assertion
 * on a mock call.
 */
function harness(options: { corpus?: any[]; affinitySeenIds?: string[] } = {}) {
  const corpus = options.corpus || makeCorpus();

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
  // The real re-ranker never drops a candidate; this stand-in keeps that
  // property so a short session can only ever mean a short pool.
  const diversityService: any = {
    rerank: jest.fn((order: any[], { limit }: any) => order.slice(0, limit))
  };
  const selectionService: any = {
    select: jest.fn(({ scored }: any) => ({ candidateOrder: scored, hero: scored[0] || null })),
    getRecentHeroes: jest.fn().mockResolvedValue([]),
    rememberHero: jest.fn().mockResolvedValue(undefined)
  };
  const affinityService: any = {
    getRaw: jest.fn().mockResolvedValue(
      options.affinitySeenIds ? { recentlySeenPostIds: options.affinitySeenIds } : null
    ),
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
    find: jest.fn((query: any) => {
      if (query?._id?.$in) {
        const wanted = new Set(query._id.$in.map(String));
        return { lean: jest.fn().mockResolvedValue(corpus.filter((p) => wanted.has(p._id.toString()))) };
      }
      return makeCursor([]);
    })
  };
  const userRelationshipService: any = { getBlockedEitherDirectionIds: jest.fn().mockResolvedValue([]) };

  const fake = createFakeRedis();
  const sessionService = new RecommendationSessionService(fake.client);
  const chainService = new RecommendationChainService(fake.client);

  const svc = new RecommendationFeedService(
    postModel,
    candidateService,
    scoringService,
    diversityService,
    selectionService,
    sessionService,
    affinityService,
    detailSessionService,
    userRelationshipService,
    chainService
  );

  return {
    svc,
    sessionService,
    chainService,
    candidateService,
    corpus,
    corpusIds: corpus.map((post) => post._id.toString()),
    fake
  };
}

/**
 * Walk a feed the way the client does: page the session, roll over when it is
 * spent, stop when the server answers a rollover with nothing.
 *
 * Returns every id served, in order — repeats included, so a chain that quietly
 * repeats itself is visible rather than hidden by a Set.
 */
async function browse(
  svc: RecommendationFeedService,
  options: {
    feedType: any;
    subject: any;
    chainId?: string;
    limit?: number;
    maxRequests?: number;
  }
) {
  const limit = options.limit ?? 20;
  const served: string[] = [];
  const sessionIds: string[] = [];
  let sessionId: string | undefined;
  let cursor: string | null = null;
  let hasMore = true;
  let spent = false;
  let requests = 0;

  while (!spent && requests < (options.maxRequests ?? 60)) {
    requests += 1;
    const rollover = Boolean(sessionId) && !hasMore;
    // eslint-disable-next-line no-await-in-loop
    const result = await svc.getFeed({
      feedType: options.feedType,
      subject: options.subject,
      chainId: options.chainId,
      limit,
      ...(sessionId ? { sessionId } : {}),
      ...(rollover ? { rollover: true } : { cursor })
    });

    served.push(...result.data.map((post: any) => post._id.toString()));
    if (!sessionIds.includes(result.sessionId)) sessionIds.push(result.sessionId);

    // Exactly what the client does: stop on the server's word, never on its own
    // de-duplication.
    if (result.chainExhausted || (rollover && result.data.length === 0)) spent = true;
    sessionId = result.sessionId;
    hasMore = result.hasMore;
    cursor = result.nextCursor;
  }

  return {
    served, distinct: new Set(served), sessionIds, requests, spent
  };
}

describe('Home browsing chain', () => {
  const subject = { anonymousId: 'guest-home-chain' };

  /** Acceptance 1. */
  it('the first session is the policy size, not the whole catalogue', async () => {
    const { svc } = harness();
    const first = await svc.getFeed({
      feedType: HOME, subject, chainId: 'chain-first-session', limit: 200
    });

    expect(first.data.length).toBe(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
    expect(first.data.length).toBeLessThan(CORPUS_SIZE);
    expect(first.chainExhausted).toBe(false);
    expect(first.chainId).toBe('chain-first-session');
  });

  /** Acceptance 2, 3, 4 — the failure that shipped, measured in distinct ids. */
  it('scrolls past 70, past 100 and past 140 distinct posts in one chain', async () => {
    const { svc } = harness();
    const walk = await browse(svc, { feedType: HOME, subject, chainId: 'chain-long-scroll' });

    expect(walk.distinct.size).toBeGreaterThan(70);
    expect(walk.distinct.size).toBeGreaterThan(100);
    expect(walk.distinct.size).toBeGreaterThan(140);
    expect(walk.distinct.size).toBe(CORPUS_SIZE);
    // Several sessions, none of them the catalogue.
    expect(walk.sessionIds.length).toBeGreaterThan(1);
  });

  /*
   * The 410-card defect, measured the only way that catches it: total served
   * against distinct served. A chain that recycles passes every "reaches 160"
   * assertion and still repeats itself indefinitely.
   */
  it('serves every post exactly once and never more than the corpus', async () => {
    const { svc } = harness();
    const walk = await browse(svc, { feedType: HOME, subject, chainId: 'chain-no-repeat' });

    expect(walk.served.length).toBe(walk.distinct.size);
    expect(walk.served.length).toBe(CORPUS_SIZE);
    expect(walk.served.length).toBeLessThan(CORPUS_SIZE * 2);
    expect(walk.spent).toBe(true);
  });

  it('reports the chain exhausted rather than recycling it', async () => {
    const { svc, chainService, corpusIds } = harness();
    const chainId = 'chain-reports-exhaustion';
    await chainService.recordServed(HOME, chainId, corpusIds);

    const result = await svc.getFeed({
      feedType: HOME, subject, chainId, limit: 70
    });

    expect(result.chainExhausted).toBe(true);
    expect(result.data.length).toBe(0);
    // The seen set is left intact: nothing was reset, so nothing can be
    // silently handed out a second time.
    const stillSeen = await chainService.resolve(chainId, 'guest-home-chain', HOME);
    expect(stillSeen?.seenPostIds.length).toBe(CORPUS_SIZE);
  });

  /** Acceptance 5 — nothing reports exhaustion while unseen posts remain. */
  it('never answers with an empty page while the chain still has unseen posts', async () => {
    const { svc } = harness();
    const chainId = 'chain-not-premature';
    let sessionId: string | undefined;
    let cursor: string | null = null;
    let hasMore = true;
    const distinct = new Set<string>();

    for (let request = 0; request < 12; request += 1) {
      const rollover = Boolean(sessionId) && !hasMore;
      // eslint-disable-next-line no-await-in-loop
      const result = await svc.getFeed({
        feedType: HOME,
        subject,
        chainId,
        limit: 20,
        ...(sessionId ? { sessionId } : {}),
        ...(rollover ? { rollover: true } : { cursor })
      });

      if (distinct.size < CORPUS_SIZE) {
        expect(result.data.length).toBeGreaterThan(0);
      }
      result.data.forEach((post: any) => distinct.add(post._id.toString()));
      sessionId = result.sessionId;
      hasMore = result.hasMore;
      cursor = result.nextCursor;
    }
  });

  /** Acceptance 6 — a short final batch, rather than a premature dead end. */
  it('returns the last few unseen posts even though they cannot fill a session', async () => {
    const { svc, chainService, corpusIds } = harness();
    const chainId = 'chain-partial-tail';

    // Pretend the chain has already served all but nine posts.
    await chainService.recordServed(HOME, chainId, corpusIds.slice(0, CORPUS_SIZE - 9));

    const result = await svc.getFeed({
      feedType: HOME, subject, chainId, limit: 70
    });

    expect(result.data.length).toBe(9);
    expect(result.data.length).toBeLessThan(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
    // A short batch is the remaining unseen posts, not an exhausted chain.
    expect(result.chainExhausted).toBe(false);
  });

  it('an explicit new chain may serve posts the spent chain already showed', async () => {
    // "Refresh recommendations" and a reload both mint a new chain id. That is
    // the only way to see the catalogue again, and it is the viewer's decision.
    const { svc, chainService, corpusIds } = harness();
    await chainService.recordServed(HOME, 'chain-spent', corpusIds);

    const spent = await svc.getFeed({
      feedType: HOME, subject, chainId: 'chain-spent', limit: 70
    });
    expect(spent.chainExhausted).toBe(true);

    const refreshed = await svc.getFeed({
      feedType: HOME, subject, chainId: 'chain-after-refresh', limit: 70
    });
    expect(refreshed.data.length).toBe(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
    expect(refreshed.chainExhausted).toBe(false);
  });

  /** Acceptance 9 — the reload defect. */
  it('a new chain starts fresh even when the subject has seen almost everything', async () => {
    const corpus = makeCorpus();
    // The exact production state after Run 1: 149 of 160 in the subject's
    // impression-driven memory. In `06g` this produced an 11-post feed.
    const affinitySeenIds = corpus.slice(0, 149).map((post) => post._id.toString());
    const { svc } = harness({ corpus, affinitySeenIds });

    const reloaded = await svc.getFeed({
      feedType: HOME, subject, chainId: 'chain-after-reload', limit: 70
    });

    expect(reloaded.data.length).toBe(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
    expect(reloaded.data.length).not.toBe(11);
    expect(reloaded.chainExhausted).toBe(false);
  });

  it('still prefers unseen posts when the cross-session memory leaves enough of them', async () => {
    const corpus = makeCorpus();
    const affinitySeenIds = corpus.slice(0, 40).map((post) => post._id.toString());
    const { svc } = harness({ corpus, affinitySeenIds });

    const result = await svc.getFeed({
      feedType: HOME, subject, chainId: 'chain-soft-preference', limit: 70
    });

    const returned = result.data.map((post: any) => post._id.toString());
    // 120 unseen is more than a 70-item session needs, so the preference holds.
    expect(returned.filter((id: string) => affinitySeenIds.includes(id))).toEqual([]);
  });

  /** Acceptance 10. */
  it('same-page rollovers stay in one chain; a reload does not', async () => {
    const { svc } = harness();

    const a = await svc.getFeed({ feedType: HOME, subject, chainId: 'chain-same-page', limit: 20 });
    const b = await svc.getFeed({
      feedType: HOME, subject, chainId: 'chain-same-page', limit: 20, sessionId: a.sessionId, rollover: true
    });
    expect(a.chainId).toBe('chain-same-page');
    expect(b.chainId).toBe('chain-same-page');
    expect(b.sessionId).not.toBe(a.sessionId);

    const afterReload = await svc.getFeed({
      feedType: HOME, subject, chainId: 'chain-after-page-reload', limit: 20
    });
    expect(afterReload.chainId).toBe('chain-after-page-reload');
    // A full page, drawn from the whole catalogue: the new chain inherits
    // nothing from the one it replaced.
    expect(afterReload.data.length).toBe(20);
    expect(afterReload.chainExhausted).toBe(false);
  });

  it('works unchained, for a client that sends no chain id at all', async () => {
    const { svc } = harness();
    const result = await svc.getFeed({ feedType: HOME, subject, limit: 20 });

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.chainId).toBeNull();
    expect(result.chainExhausted).toBe(false);
  });
});

describe('For You browsing chain', () => {
  const subject = { anonymousId: 'guest-for-you-chain' };

  /** Acceptance 11 and 12. */
  it('rolls over inside one chain with no cross-session duplicates', async () => {
    const { svc } = harness();

    const first = await svc.getFeed({
      feedType: FOR_YOU, subject, chainId: 'chain-fy', limit: 40
    });
    expect(first.data.length).toBe(SESSION_OUTPUT_POLICY.forYouInitialSessionLimit);

    const second = await svc.getFeed({
      feedType: FOR_YOU, subject, chainId: 'chain-fy', limit: 40, sessionId: first.sessionId, rollover: true
    });

    const firstIds = first.data.map((post: any) => post._id.toString());
    const secondIds = second.data.map((post: any) => post._id.toString());
    expect(second.chainId).toBe('chain-fy');
    expect(secondIds.filter((id: string) => firstIds.includes(id))).toEqual([]);
  });

  /** Acceptance 13. */
  it('accumulates distinct posts across several sessions', async () => {
    const { svc } = harness();
    const walk = await browse(svc, {
      feedType: FOR_YOU, subject, chainId: 'chain-fy-long', limit: 10
    });

    expect(walk.sessionIds.length).toBeGreaterThan(3);
    expect(walk.distinct.size).toBe(CORPUS_SIZE);
    // Same guarantee as Home: one browse, one appearance per post.
    expect(walk.served.length).toBe(walk.distinct.size);
  });

  it('keeps its own session size — a chain does not turn For You into the catalogue', async () => {
    const { svc } = harness();
    const result = await svc.getFeed({
      feedType: FOR_YOU, subject, chainId: 'chain-fy-size', limit: 200
    });

    expect(result.data.length).toBe(SESSION_OUTPUT_POLICY.forYouInitialSessionLimit);
    expect(result.data.length).toBeLessThan(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
  });

  /** Acceptance 14. */
  it('a reload gets a new chain and the catalogue from the start', async () => {
    const { svc } = harness();
    await browse(svc, { feedType: FOR_YOU, subject, chainId: 'chain-fy-spent', limit: 10 });

    const afterReload = await svc.getFeed({
      feedType: FOR_YOU, subject, chainId: 'chain-fy-reloaded', limit: 40
    });
    expect(afterReload.data.length).toBe(SESSION_OUTPUT_POLICY.forYouInitialSessionLimit);
    expect(afterReload.chainExhausted).toBe(false);
  });

  it('Home and For You chains never share a seen set', async () => {
    const { svc, fake } = harness();

    await svc.getFeed({ feedType: HOME, subject, chainId: 'same-id-both-surfaces', limit: 20 });
    await svc.getFeed({ feedType: FOR_YOU, subject, chainId: 'same-id-both-surfaces', limit: 20 });

    const homeSeen = await fake.client.scard(REDIS_KEYS.recoChainSeen(HOME, 'same-id-both-surfaces'));
    const forYouSeen = await fake.client.scard(REDIS_KEYS.recoChainSeen(FOR_YOU, 'same-id-both-surfaces'));
    expect(homeSeen).toBe(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
    expect(forYouSeen).toBe(SESSION_OUTPUT_POLICY.forYouInitialSessionLimit);
  });
});

describe('subjects', () => {
  /** Acceptance 16. */
  it('an authenticated viewer gets a working chain', async () => {
    const { svc } = harness();
    const viewerId = new ObjectId().toString();
    const walk = await browse(svc, {
      feedType: HOME, subject: { viewerId }, chainId: 'chain-authed', limit: 20
    });

    expect(walk.distinct.size).toBeGreaterThan(140);
  });

  /** Acceptance 17. */
  it('a guest anonymous subject gets a working chain', async () => {
    const { svc } = harness();
    const walk = await browse(svc, {
      feedType: HOME, subject: { anonymousId: 'guest-abcdefgh' }, chainId: 'chain-guest', limit: 20
    });

    expect(walk.distinct.size).toBeGreaterThan(140);
  });

  /** Acceptance 18 — two tabs. */
  it('two chains for the same subject do not consume each other', async () => {
    const { svc } = harness();
    const subject = { anonymousId: 'guest-two-tabs' };

    const tabA = await svc.getFeed({ feedType: HOME, subject, chainId: 'tab-a-chain', limit: 70 });
    const tabB = await svc.getFeed({ feedType: HOME, subject, chainId: 'tab-b-chain', limit: 70 });

    // Each tab sees a full session drawn from the whole catalogue; neither is
    // starved by the other's browse.
    expect(tabA.data.length).toBe(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
    expect(tabB.data.length).toBe(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
    expect(tabA.chainId).not.toBe(tabB.chainId);
  });

  it('refuses a chain belonging to a different subject', async () => {
    const { svc, chainService } = harness();

    await svc.getFeed({
      feedType: HOME, subject: { anonymousId: 'owner-subject' }, chainId: 'private-chain', limit: 20
    });

    // Another subject quoting the same id gets no chain at all rather than the
    // owner's browse — a guessed id can never reveal what they were shown.
    const stolen = await chainService.resolve('private-chain', 'someone-else', HOME);
    expect(stolen).toBeNull();

    const feed = await svc.getFeed({
      feedType: HOME, subject: { anonymousId: 'someone-else' }, chainId: 'private-chain', limit: 20
    });
    expect(feed.chainId).toBeNull();
    expect(feed.data.length).toBeGreaterThan(0);
  });
});

describe('chain Redis state', () => {
  const subject = { anonymousId: 'guest-redis-state' };

  /** Acceptance 20. */
  it('gives every chain key a TTL, refreshed while the browse is active', async () => {
    const { svc, fake } = harness();
    await svc.getFeed({ feedType: HOME, subject, chainId: 'chain-ttl', limit: 20 });

    expect(await fake.client.ttl(REDIS_KEYS.recoChainMeta(HOME, 'chain-ttl'))).toBe(CHAIN_POLICY.ttlSeconds);
    expect(await fake.client.ttl(REDIS_KEYS.recoChainSeen(HOME, 'chain-ttl'))).toBe(CHAIN_POLICY.ttlSeconds);
  });

  /** Acceptance 19. */
  it('bounds the seen set — one browse can never grow it without limit', async () => {
    const { svc, fake } = harness();
    const walk = await browse(svc, { feedType: HOME, subject, chainId: 'chain-bounded', limit: 20 });

    expect(walk.requests).toBeGreaterThan(1);
    const size = await fake.client.scard(REDIS_KEYS.recoChainSeen(HOME, 'chain-bounded'));
    expect(size).toBeLessThanOrEqual(CHAIN_POLICY.maxSeenIds);
    expect(size).toBeLessThanOrEqual(CORPUS_SIZE);
  });

  it('refuses a malformed chain id rather than making it a Redis key', async () => {
    const { chainService } = harness();

    expect(chainService.isValidChainId('short')).toBe(false);
    expect(chainService.isValidChainId('has:colons:in:it')).toBe(false);
    expect(chainService.isValidChainId('a'.repeat(CHAIN_POLICY.maxIdLength + 1))).toBe(false);
    expect(chainService.isValidChainId('5f3b2c1a-9d8e-4f7a-b6c5-1234567890ab')).toBe(true);
    expect(await chainService.resolve('has:colons', 'subject', HOME)).toBeNull();
  });
});

describe('PostRecommendationRequest', () => {
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

  it('rollover is true only for a genuine true', () => {
    expect(parse({ rollover: 'true' }).rollover).toBe(true);
    expect(parse({ rollover: true }).rollover).toBe(true);
  });

  it('rollover is false for the string "false", which implicit conversion would make true', () => {
    expect(parse({ rollover: 'false' }).rollover).toBe(false);
  });

  it('rollover is absent when absent — never accidentally truthy', () => {
    expect(parse({}).rollover).toBeUndefined();
    expect(Boolean(parse({}).rollover)).toBe(false);
  });

  it('carries chainId through unchanged', () => {
    const chainId = '5f3b2c1a-9d8e-4f7a-b6c5-1234567890ab';
    expect(parse({ chainId }).chainId).toBe(chainId);
  });
});
