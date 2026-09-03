import { ObjectId } from 'mongodb';
import { RecommendationSessionService } from './recommendation-session.service';
import { createFakeRedis } from './test-fake-redis';
import { ScoredCandidate } from './recommendation-scoring.service';

function rankedList(n: number): ScoredCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    post: { _id: new ObjectId(), userId: new ObjectId(), topicKey: 'food', tags: [], createdAt: new Date() } as any,
    source: 'trending',
    finalScore: n - i,
    breakdown: {
      userInterest: 0, watchQuality: 0, engagementQuality: 0, freshness: 0, explorationBonus: 0, creatorAffinity: 0, sessionJitter: 0
    },
    explorationStage: 2
  }));
}

describe('RecommendationSessionService', () => {
  it('pages a session without duplicates or gaps across the whole list', async () => {
    const { client } = createFakeRedis();
    const svc = new RecommendationSessionService(client);
    const ranked = rankedList(25);
    const sessionId = await svc.create({
      subjectId: 'user-1', feedType: 'for-you', sessionSeed: 's1', ranked
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    let hasMore = true;
    let guard = 0;
    while (hasMore && guard < 20) {
      guard += 1;
      // eslint-disable-next-line no-await-in-loop
      const page = await svc.getPage(sessionId, 'user-1', cursor, 10);
      expect(page).not.toBeNull();
      seen.push(...page!.items.map((i) => i.postId));
      hasMore = page!.hasMore;
      cursor = page!.nextCursor;
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25); // No duplicates.
    expect(seen).toEqual(ranked.map((c) => c.post._id.toString())); // Ranked order preserved.
  });

  it('two concurrent load-more calls with the same cursor return the same page, never duplicate or skip', async () => {
    const { client } = createFakeRedis();
    const svc = new RecommendationSessionService(client);
    const ranked = rankedList(30);
    const sessionId = await svc.create({ subjectId: 'user-1', feedType: 'home', sessionSeed: 's1', ranked });

    const first = await svc.getPage(sessionId, 'user-1', null, 10);
    const [pageA, pageB] = await Promise.all([
      svc.getPage(sessionId, 'user-1', first!.nextCursor, 10),
      svc.getPage(sessionId, 'user-1', first!.nextCursor, 10)
    ]);

    expect(pageA!.items.map((i) => i.postId)).toEqual(pageB!.items.map((i) => i.postId));
  });

  it('refuses to serve a session to a different subject', async () => {
    const { client } = createFakeRedis();
    const svc = new RecommendationSessionService(client);
    const sessionId = await svc.create({ subjectId: 'user-1', feedType: 'for-you', sessionSeed: 's1', ranked: rankedList(5) });
    const page = await svc.getPage(sessionId, 'someone-else', null, 10);
    expect(page).toBeNull();
  });

  it('returns null for a missing/expired session so the caller can fall back to a fresh one', async () => {
    const { client } = createFakeRedis();
    const svc = new RecommendationSessionService(client);
    const page = await svc.getPage('nonexistent-session', 'user-1', null, 10);
    expect(page).toBeNull();
  });

  it('degrades to null (not a throw) when Redis is unavailable', async () => {
    const { client } = createFakeRedis();
    client.hgetall = jest.fn().mockRejectedValue(new Error('redis down'));
    const svc = new RecommendationSessionService(client);
    await expect(svc.getPage('any-session', 'user-1', null, 10)).resolves.toBeNull();
  });

  it('caps stored items at the configured maxItems', async () => {
    const { client, lists } = createFakeRedis();
    const svc = new RecommendationSessionService(client);
    const ranked = rankedList(500);
    const sessionId = await svc.create({ subjectId: 'user-1', feedType: 'for-you', sessionSeed: 's1', ranked });
    const itemsKey = [...lists.keys()].find((k) => k.includes(sessionId))!;
    expect(lists.get(itemsKey)!.length).toBeLessThanOrEqual(160);
  });
});
