import { RecommendationAffinityService } from './recommendation-affinity.service';

function service() {
  const model: any = {
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    updateOne: jest.fn().mockResolvedValue({}),
  };
  return { svc: new RecommendationAffinityService(model), model };
}

describe('RecommendationAffinityService', () => {
  it('decays older signal below newer signal of the same raw score', () => {
    const { svc } = service();
    const now = new Date('2026-09-02T00:00:00.000Z');
    const fresh = svc.topAffinities(new Map([['food', { score: 10, updatedAt: now }]]), 5, now);
    const stale = svc.topAffinities(
      new Map([['food', { score: 10, updatedAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) }]]), 5, now
    );
    expect(fresh[0].decayedScore).toBeGreaterThan(stale[0].decayedScore);
    // 14 days is exactly one half-life in this engine's default config.
    expect(stale[0].decayedScore).toBeCloseTo(5, 0);
  });

  it('sorts top affinities highest-decayed-score first, capped at n', () => {
    const { svc } = service();
    const now = new Date();
    const map = new Map([
      ['low', { score: 1, updatedAt: now }],
      ['high', { score: 20, updatedAt: now }],
      ['mid', { score: 5, updatedAt: now }]
    ]);
    const top = svc.topAffinities(map, 2, now);
    expect(top).toHaveLength(2);
    expect(top[0].key).toBe('high');
    expect(top[1].key).toBe('mid');
  });

  it('drops effectively-zero decayed scores rather than returning noise', () => {
    const { svc } = service();
    const now = new Date();
    const veryOld = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const top = svc.topAffinities(new Map([['ancient', { score: 1, updatedAt: veryOld }]]), 5, now);
    expect(top).toHaveLength(0);
  });

  it('is a no-op for a zero-weight event (no wasted write)', async () => {
    const { svc, model } = service();
    await svc.applyEvent({
      subjectId: 'user-1', isAuthenticatedUser: true, weight: 0
    });
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('applies category, hashtag and creator increments in a single upsert', async () => {
    const { svc, model } = service();
    await svc.applyEvent({
      subjectId: 'user-1',
      isAuthenticatedUser: true,
      topicKey: 'food',
      tags: ['pho', 'hanoi'],
      creatorId: 'creator-1',
      weight: 3,
      isVideo: true
    });
    expect(model.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = model.updateOne.mock.calls[0];
    expect(update.$inc['categoryScores.food.score']).toBe(3);
    expect(update.$inc['hashtagScores.pho.score']).toBe(3);
    expect(update.$inc['hashtagScores.hanoi.score']).toBe(3);
    expect(update.$inc['creatorScores.creator-1.score']).toBe(3);
    expect(update.$inc['videoFormatPreference.score']).toBe(3);
  });

  describe('markSeen labels the subject honestly', () => {
    it('records an anonymous session as NOT an authenticated user', async () => {
      // This is a regression: `markSeen` used to hardcode
      // `isAuthenticatedUser: true`, and an impression is both the event that
      // reaches `markSeen` and the one event carrying no affinity weight — so
      // for a guest who browsed without interacting, the mislabelled row was
      // the *only* row ever written for them.
      const { svc, model } = service();
      await svc.markSeen('anon-session-1', ['post-1'], false);

      const [, update] = model.updateOne.mock.calls[0];
      expect(update.$setOnInsert.isAuthenticatedUser).toBe(false);
      expect(update.$setOnInsert.subjectId).toBe('anon-session-1');
    });

    it('records a signed-in subject as an authenticated user', async () => {
      const { svc, model } = service();
      await svc.markSeen('user-1', ['post-1'], true);

      const [, update] = model.updateOne.mock.calls[0];
      expect(update.$setOnInsert.isAuthenticatedUser).toBe(true);
    });

    it('bounds the recently-seen ring buffer rather than growing it forever', async () => {
      const { svc, model } = service();
      await svc.markSeen('user-1', ['post-1', 'post-2'], true, 50);

      const [, update] = model.updateOne.mock.calls[0];
      expect(update.$push.recentlySeenPostIds.$slice).toBe(-50);
      expect(update.$push.recentlySeenPostIds.$each).toEqual(['post-1', 'post-2']);
    });

    it('writes nothing when there is nothing to record', async () => {
      const { svc, model } = service();
      await svc.markSeen('user-1', [], true);
      await svc.markSeen('', ['post-1'], true);
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });
});
