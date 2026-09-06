import { ObjectId } from 'mongodb';
import { RecommendationFeedService } from './recommendation-feed.service';

/**
 * `detailNext(..., videoOnly)` — the candidate source behind picture-in-picture
 * "next".
 *
 * PiP is a `<video>` element and a transport bar: it has nothing to draw a
 * photo post with. Before this, PiP navigated the Home grid's rendered order
 * instead, which is why "next" was whatever card happened to be below the one
 * that was playing.
 *
 * The point of routing PiP through the *detail* session rather than a second
 * random picker is that this pipeline already guarantees the two things PiP
 * needs: every post it has handed out is excluded from the next query, so it
 * never repeats and never returns the post that is playing.
 */

function makeCursor(result: any[]) {
  const cursor: any = {};
  cursor.select = jest.fn(() => cursor);
  cursor.sort = jest.fn(() => cursor);
  cursor.limit = jest.fn(() => cursor);
  cursor.lean = jest.fn().mockResolvedValue(result);
  return cursor;
}

function service(options: { candidates?: any[]; sessionItems?: string[] } = {}) {
  const sessionItems = options.sessionItems || [new ObjectId().toString()];
  const candidates = options.candidates || [];

  const postModel: any = {
    exists: jest.fn().mockResolvedValue(true),
    find: jest.fn().mockReturnValue(makeCursor(candidates))
  };
  const detailSessionService: any = {
    // No item ahead of the cursor: every call must compute a new candidate.
    stepForwardIfExists: jest.fn().mockResolvedValue(null),
    getState: jest.fn().mockResolvedValue({
      sessionId: 'detail-1',
      items: sessionItems.map((postId) => ({ postId, source: 'anchor' })),
      cursorIndex: sessionItems.length - 1,
      sessionSeed: 'seed'
    }),
    appendAndAdvance: jest.fn().mockImplementation((_sessionId, _subjectId, item) => Promise.resolve({
      sessionId: 'detail-1',
      items: [...sessionItems.map((postId) => ({ postId, source: 'anchor' })), item],
      cursorIndex: sessionItems.length,
      sessionSeed: 'seed'
    }))
  };
  const scoringService: any = {
    loadStats: jest.fn().mockResolvedValue(new Map()),
    loadPriors: jest.fn().mockResolvedValue(new Map()),
    score: jest.fn((post: any, source: string) => ({ post, source, finalScore: post.totalLike || 0, breakdown: {} }))
  };
  const affinityService: any = {
    getRaw: jest.fn().mockResolvedValue(null),
    topAffinities: jest.fn().mockReturnValue([]),
    formatPreferenceScore: jest.fn().mockReturnValue(0)
  };

  const svc = new RecommendationFeedService(
    postModel,
    { retrieve: jest.fn(), getFollowingCreatorIds: jest.fn().mockResolvedValue([]) } as any,
    scoringService,
    { rerank: jest.fn() } as any,
    { select: jest.fn(), getRecentHeroes: jest.fn(), rememberHero: jest.fn() } as any,
    { create: jest.fn(), getPage: jest.fn() } as any,
    affinityService,
    detailSessionService,
    { getBlockedEitherDirectionIds: jest.fn().mockResolvedValue([]) } as any,
    // Detail sequencing has no browsing chain: it is anchored on one
    // post, not on a scroll.
    { resolve: jest.fn().mockResolvedValue(null) } as any
  );

  return { svc, postModel, detailSessionService };
}

const subject = { anonymousId: 'anon-pip-1' };

describe('detailNext videoOnly', () => {
  /** Scenario 7: PiP only ever selects video posts. */
  it('constrains the query to posts that carry a video', async () => {
    const candidate = { _id: new ObjectId(), topicKey: 't', totalLike: 5 };
    const { svc, postModel } = service({ candidates: [candidate] });

    await svc.detailNext('detail-1', subject, 'home' as any, true);

    const match = postModel.find.mock.calls[0][0];
    expect(match.$and).toEqual(
      expect.arrayContaining([{ $or: [{ type: 'video' }, { mediaTypes: 'video' }] }])
    );
  });

  it('leaves the query unconstrained when videoOnly is not asked for', async () => {
    const candidate = { _id: new ObjectId(), topicKey: 't', totalLike: 5 };
    const { svc, postModel } = service({ candidates: [candidate] });

    await svc.detailNext('detail-1', subject);

    const match = postModel.find.mock.calls[0][0];
    const clauses = match.$and || [];
    expect(clauses).not.toEqual(
      expect.arrayContaining([{ $or: [{ type: 'video' }, { mediaTypes: 'video' }] }])
    );
  });

  /*
   * The video constraint is appended to `$and`, never assigned to it. Assigning
   * would silently drop the already-seen and blocked-creator exclusions that
   * `buildEligibilityMatch` puts there — which is exactly how "never repeat"
   * would turn into "repeat constantly" with no error anywhere.
   */
  it('keeps the eligibility exclusions the video filter is added alongside', async () => {
    const alreadyShown = [new ObjectId().toString(), new ObjectId().toString()];
    const candidate = { _id: new ObjectId(), topicKey: 't', totalLike: 5 };
    const { svc, postModel } = service({ candidates: [candidate], sessionItems: alreadyShown });

    await svc.detailNext('detail-1', subject, 'home' as any, true);

    const match = postModel.find.mock.calls[0][0];
    const exclusion = (match.$and || []).find((clause: any) => clause._id?.$nin);
    expect(exclusion).toBeTruthy();
    expect(exclusion._id.$nin.map(String).sort()).toEqual([...alreadyShown].sort());
  });

  /** Scenario 5: next never selects the post that is currently playing. */
  it('excludes every post already in the session, the current one included', async () => {
    const current = new ObjectId().toString();
    const earlier = new ObjectId().toString();
    const candidate = { _id: new ObjectId(), topicKey: 't', totalLike: 5 };
    const { svc, postModel } = service({ candidates: [candidate], sessionItems: [earlier, current] });

    const result = await svc.detailNext('detail-1', subject, 'home' as any, true);

    const exclusion = (postModel.find.mock.calls[0][0].$and || []).find((clause: any) => clause._id?.$nin);
    expect(exclusion._id.$nin.map(String)).toContain(current);
    expect(result?.postId).not.toBe(current);
  });

  /** Scenario 8: repeated next walks the corpus instead of cycling a tiny subset. */
  it('hands out a different post every time, until the eligible set runs out', async () => {
    const corpus = Array.from({ length: 12 }, (_, index) => ({
      _id: new ObjectId(), topicKey: `t${index % 3}`, totalLike: 12 - index
    }));

    // A session that really grows, so each call excludes everything before it —
    // the property that makes the walk distribute rather than loop.
    const items: string[] = [corpus[0]._id.toString()];
    const postModel: any = {
      exists: jest.fn().mockResolvedValue(true),
      find: jest.fn((match: any) => {
        const excluded = new Set(((match.$and || [])
          .find((clause: any) => clause._id?.$nin)?._id.$nin || []).map(String));
        return makeCursor(corpus.filter((post) => !excluded.has(post._id.toString())));
      })
    };
    const detailSessionService: any = {
      stepForwardIfExists: jest.fn().mockResolvedValue(null),
      getState: jest.fn(async () => ({
        sessionId: 'detail-1',
        items: items.map((postId) => ({ postId, source: 'anchor' })),
        cursorIndex: items.length - 1,
        sessionSeed: 'seed'
      })),
      appendAndAdvance: jest.fn(async (_s: string, _u: string, item: any) => {
        items.push(item.postId);
        return {
          sessionId: 'detail-1',
          items: items.map((postId) => ({ postId, source: 'anchor' })),
          cursorIndex: items.length - 1,
          sessionSeed: 'seed'
        };
      })
    };
    const svc = new RecommendationFeedService(
      postModel,
      { retrieve: jest.fn(), getFollowingCreatorIds: jest.fn().mockResolvedValue([]) } as any,
      {
        loadStats: jest.fn().mockResolvedValue(new Map()),
        loadPriors: jest.fn().mockResolvedValue(new Map()),
        score: jest.fn((post: any, source: string) => ({
          post, source, finalScore: post.totalLike, breakdown: {}
        }))
      } as any,
      { rerank: jest.fn() } as any,
      { select: jest.fn(), getRecentHeroes: jest.fn(), rememberHero: jest.fn() } as any,
      { create: jest.fn(), getPage: jest.fn() } as any,
      {
        getRaw: jest.fn().mockResolvedValue(null),
        topAffinities: jest.fn().mockReturnValue([]),
        formatPreferenceScore: jest.fn().mockReturnValue(0)
      } as any,
      detailSessionService,
      { getBlockedEitherDirectionIds: jest.fn().mockResolvedValue([]) } as any,
      // Detail sequencing has no browsing chain: it is anchored on one
      // post, not on a scroll.
      { resolve: jest.fn().mockResolvedValue(null) } as any
    );

    const handed: string[] = [];
    for (let step = 0; step < 11; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await svc.detailNext('detail-1', subject, 'home' as any, true);
      if (result) handed.push(result.postId);
    }

    expect(handed.length).toBe(11);
    expect(new Set(handed).size).toBe(11); // every one distinct
    expect(handed).not.toContain(corpus[0]._id.toString()); // never the anchor

    // And once the corpus is spent it says so, rather than starting over on its
    // own — recycling is the client's decision, deterministically (PiP wraps to
    // the start of its own history).
    expect(await svc.detailNext('detail-1', subject, 'home' as any, true)).toBeNull();
  });
});
