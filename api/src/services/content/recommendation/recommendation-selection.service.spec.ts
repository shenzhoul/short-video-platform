import { ObjectId } from 'mongodb';
import { SESSION_OUTPUT_POLICY } from 'src/common/constants/recommendation';

import { RecommendationSelectionService } from './recommendation-selection.service';
import { ScoredCandidate } from './recommendation-scoring.service';

/**
 * Session selection: the seeded, score-weighted order a session is drawn from,
 * and the rotated lead.
 *
 * The behaviour these defend, measured in a production build before the change:
 * ten guest reloads of Home produced ten sessions holding the *same* 160 posts
 * in a different order, every one of them led by the same post. A session that
 * is the whole catalogue cannot be a recommendation, and a ±0.03 jitter cannot
 * reorder scores that differ by more than that.
 *
 * Note what this service no longer does: it does **not** truncate to the
 * session length. Composing a session before any diversity rule is consulted
 * produced sessions no re-ordering could make compliant, so the whole ordered
 * pool is handed to `rerank`, which takes the best candidate that fits and
 * stops at the limit. The length and the diversity guarantees are asserted in
 * `recommendation-lead-diversity.spec.ts`.
 */

function candidate(id: string, finalScore: number, creator = 'c1', topicKey = 'food'): ScoredCandidate {
  return {
    post: {
      _id: new ObjectId(id.padStart(24, '0')),
      userId: new ObjectId(creator.padStart(24, '0')),
      topicKey
    },
    source: 'trending',
    finalScore,
    breakdown: {},
    explorationStage: 2
  } as unknown as ScoredCandidate;
}

/** A pool whose scores span a realistic range, so sampling has something to prefer. */
function pool(size: number): ScoredCandidate[] {
  return Array.from({ length: size }, (_, index) => candidate(
    `${index + 1}`,
    1 - (index / (size * 2)),
    `${(index % 16) + 1}`,
    ['food', 'music', 'games', 'travel'][index % 4]
  ));
}

function service() {
  const redis: any = {
    lrange: jest.fn().mockResolvedValue([]),
    pipeline: jest.fn(() => {
      const chain: any = {
        lpush: jest.fn(() => chain),
        ltrim: jest.fn(() => chain),
        expire: jest.fn(() => chain),
        exec: jest.fn().mockResolvedValue([])
      };
      return chain;
    })
  };
  return { svc: new RecommendationSelectionService(redis), redis };
}

describe('RecommendationSelectionService.select', () => {
  it('returns the whole pool in a seeded order, not a truncated sample', () => {
    const { svc } = service();
    const scored = pool(160);
    const { candidateOrder } = svc.select({ scored, sessionSeed: 'seed-a' });

    // Truncating here is what made a badly composed session unfixable.
    expect(candidateOrder).toHaveLength(160);
    expect(new Set(candidateOrder.map((c) => c.post._id.toString())).size).toBe(160);
  });

  it('is deterministic for one seed, so pagination inside a session is stable', () => {
    const { svc } = service();
    const first = svc.select({ scored: pool(160), sessionSeed: 'same-seed' });
    const second = svc.select({ scored: pool(160), sessionSeed: 'same-seed' });

    expect(second.candidateOrder.map((c) => c.post._id.toString()))
      .toEqual(first.candidateOrder.map((c) => c.post._id.toString()));
    expect(second.hero?.post._id.toString()).toBe(first.hero?.post._id.toString());
  });

  it('orders differently for a new session, so the draw is genuinely new', () => {
    const { svc } = service();
    const a = svc.select({ scored: pool(160), sessionSeed: 'seed-a' })
      .candidateOrder.slice(0, 70).map((c) => c.post._id.toString());
    const b = svc.select({ scored: pool(160), sessionSeed: 'seed-b' })
      .candidateOrder.slice(0, 70).map((c) => c.post._id.toString());

    const shared = a.filter((id) => new Set(b).has(id)).length;
    expect(shared).toBeLessThan(a.length);
    expect(a.length - shared).toBeGreaterThanOrEqual(5);
  });

  it('weights the order by score: the top decile leads far more often than the bottom', () => {
    const { svc } = service();
    const scored = pool(160);
    const ranked = [...scored].sort((a, b) => b.finalScore - a.finalScore).map((c) => c.post._id.toString());
    const best = new Set(ranked.slice(0, 16));
    const worst = new Set(ranked.slice(-16));

    let bestEarly = 0;
    let worstEarly = 0;
    for (let index = 0; index < 40; index += 1) {
      svc.select({ scored, sessionSeed: `w-${index}` })
        .candidateOrder.slice(0, 40)
        .forEach((c) => {
          const id = c.post._id.toString();
          if (best.has(id)) bestEarly += 1;
          if (worst.has(id)) worstEarly += 1;
        });
    }

    expect(bestEarly).toBeGreaterThan(worstEarly);
    // …and the weakest candidates are still reachable, or exploration stops.
    expect(worstEarly).toBeGreaterThan(0);
  });

  it('does not lead every session with the same post', () => {
    const { svc } = service();
    const heroes = Array.from({ length: 20 }, (_, index) => svc.select({
      scored: pool(160), sessionSeed: `seed-${index}`
    }).hero?.post._id.toString());

    expect(new Set(heroes).size).toBeGreaterThan(1);
  });

  it('still prefers strong candidates — the lead comes from the top-scoring window', () => {
    const { svc } = service();
    const scored = pool(160);
    const topWindow = new Set(
      [...scored].sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, SESSION_OUTPUT_POLICY.heroWindowSize)
        .map((c) => c.post._id.toString())
    );

    for (let index = 0; index < 20; index += 1) {
      const { hero } = svc.select({ scored, sessionSeed: `seed-${index}` });
      expect(topWindow.has(hero!.post._id.toString())).toBe(true);
    }
  });

  it('puts the lead first in the order it returns', () => {
    const { svc } = service();
    const { candidateOrder, hero } = svc.select({ scored: pool(160), sessionSeed: 'seed-z' });
    expect(candidateOrder[0].post._id.toString()).toBe(hero!.post._id.toString());
    // …and never twice.
    expect(candidateOrder.filter((c) => c.post._id.toString() === hero!.post._id.toString())).toHaveLength(1);
  });

  it('skips a lead that recently led this subject, without banning it', () => {
    const { svc } = service();
    const scored = pool(160);
    const firstHero = svc.select({ scored, sessionSeed: 'seed-x' }).hero!.post._id.toString();

    const withCooldown = svc.select({ scored, sessionSeed: 'seed-x', recentHeroIds: [firstHero] });
    expect(withCooldown.hero!.post._id.toString()).not.toBe(firstHero);

    // The cooldown is a window, not a ban: without it the same seed leads with
    // the same post again.
    const again = svc.select({ scored, sessionSeed: 'seed-x' });
    expect(again.hero!.post._id.toString()).toBe(firstHero);
  });

  it('falls back to the top window when every candidate in it is on cooldown', () => {
    const { svc } = service();
    const scored = pool(20);
    const everyId = scored.map((c) => c.post._id.toString());

    const { hero, candidateOrder } = svc.select({ scored, sessionSeed: 'seed-y', recentHeroIds: everyId });
    expect(hero).not.toBeNull();
    expect(candidateOrder).toHaveLength(20);
  });

  it('handles a pool smaller than a session without dropping or duplicating anything', () => {
    const { svc } = service();
    const { candidateOrder } = svc.select({ scored: pool(5), sessionSeed: 'seed-small' });

    expect(candidateOrder).toHaveLength(5);
    expect(new Set(candidateOrder.map((c) => c.post._id.toString())).size).toBe(5);
  });

  it('returns nothing for an empty pool rather than throwing', () => {
    const { svc } = service();
    expect(svc.select({ scored: [], sessionSeed: 'seed' }))
      .toEqual({ candidateOrder: [], hero: null });
  });
});

describe('RecommendationSelectionService hero cooldown storage', () => {
  it('trims the cooldown list and gives it a TTL', async () => {
    const { svc, redis } = service();
    await svc.rememberHero('home', 'subject-1', 'post-1');

    const chain = redis.pipeline.mock.results[0].value;
    expect(chain.lpush).toHaveBeenCalledWith(expect.stringContaining('home:subject-1'), 'post-1');
    expect(chain.ltrim).toHaveBeenCalledWith(expect.any(String), 0, SESSION_OUTPUT_POLICY.heroCooldownSize - 1);
    expect(chain.expire).toHaveBeenCalledWith(expect.any(String), SESSION_OUTPUT_POLICY.heroCooldownTtlSeconds);
  });

  it('degrades to no cooldown when Redis is unavailable, rather than failing the feed', async () => {
    const { svc, redis } = service();
    redis.lrange.mockRejectedValue(new Error('redis down'));
    await expect(svc.getRecentHeroes('home', 'subject-1')).resolves.toEqual([]);
  });

  it('keys Home and For You separately', async () => {
    const { svc, redis } = service();
    await svc.getRecentHeroes('home', 'subject-1');
    await svc.getRecentHeroes('for-you', 'subject-1');
    const [homeKey] = redis.lrange.mock.calls[0];
    const [forYouKey] = redis.lrange.mock.calls[1];
    expect(homeKey).not.toBe(forYouKey);
  });

  it('keys two guests separately', async () => {
    const { svc, redis } = service();
    await svc.getRecentHeroes('home', 'guest-a');
    await svc.getRecentHeroes('home', 'guest-b');
    expect(redis.lrange.mock.calls[0][0]).not.toBe(redis.lrange.mock.calls[1][0]);
  });
});
