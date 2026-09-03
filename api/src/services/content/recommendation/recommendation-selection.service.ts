import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { SESSION_OUTPUT_POLICY } from 'src/common/constants/recommendation';
import { REDIS_KEYS } from 'src/kernel/infras/redis/redis-keys';

import { seededUnitInterval } from './recommendation-hash.util';
import { ScoredCandidate } from './recommendation-scoring.service';

/**
 * Turns a scored candidate pool into the bounded, varied subset one session
 * actually shows.
 *
 * ## Why a session is a sample rather than a prefix
 *
 * Taking the top `N` of a scored pool is stable, explainable — and, when `N`
 * approaches the pool size, indistinguishable from "show everything, sorted".
 * That is what shipped: 160 candidates, a 160-item session, and a ±0.03 jitter
 * that cannot reorder anything whose scores differ by more than that. Reloading
 * produced a re-sort of one fixed set, always led by the same post.
 *
 * Weighted sampling without replacement keeps the ranking meaningful — a
 * candidate scoring twice as high is `2 ** samplingExponent` times as likely to
 * be drawn — while making every session a genuinely different draw. Nothing is
 * shuffled: a strong post is still very likely to appear, it simply is not
 * guaranteed to appear *first, every time*.
 *
 * ## Determinism
 *
 * The randomness is the session seed, not `Math.random()`. The same seed over
 * the same pool selects the same posts in the same order, which is what keeps
 * cursor pagination inside a session stable and replayable; a new session gets
 * a new seed and therefore a new draw.
 */
@Injectable()
export class RecommendationSelectionService {
  private readonly logger = new Logger(RecommendationSelectionService.name);

  constructor(@InjectRedis() private readonly redisClient: Redis) { }

  /**
   * Posts that recently led this subject's feed.
   *
   * Read-through: Redis being unavailable costs variety in the lead slot, never
   * the feed itself, so a failure here degrades rather than throws.
   */
  public async getRecentHeroes(feedType: string, subjectId: string): Promise<string[]> {
    try {
      return await this.redisClient.lrange(REDIS_KEYS.recoRecentHeroes(feedType, subjectId), 0, -1);
    } catch (e: any) {
      this.logger.warn(`Hero cooldown read failed, continuing without it: ${e.message}`);
      return [];
    }
  }

  /**
   * Records a lead post, trimmed to the cooldown window and given a TTL.
   *
   * A cooldown, never a ban: the list holds the last `heroCooldownSize` leads
   * and expires, so a post pushed out of the lead slot today can lead again.
   */
  public async rememberHero(feedType: string, subjectId: string, postId: string): Promise<void> {
    const key = REDIS_KEYS.recoRecentHeroes(feedType, subjectId);
    try {
      const pipeline = this.redisClient.pipeline();
      pipeline.lpush(key, postId);
      pipeline.ltrim(key, 0, SESSION_OUTPUT_POLICY.heroCooldownSize - 1);
      pipeline.expire(key, SESSION_OUTPUT_POLICY.heroCooldownTtlSeconds);
      await pipeline.exec();
    } catch (e: any) {
      this.logger.warn(`Hero cooldown write failed: ${e.message}`);
    }
  }

  /**
   * Orders the whole candidate pool by a seeded, score-weighted draw and picks
   * the rotated lead.
   *
   * Deliberately **not** truncated to the session length. Truncating here and
   * re-ranking afterwards means the session's composition is fixed before any
   * diversity rule is consulted — and a draw weighted on score alone is blind
   * to authorship, so a catalogue where one creator owns the strongest work
   * yields a session that no re-ordering can make compliant. Handing the full
   * order to `rerank` with a `limit` lets it take the best candidate that
   * *fits*, so a constraint is conceded only when nothing in the remaining pool
   * satisfies it.
   *
   * The order is still a weighted sample: walking it and stopping at `limit`
   * draws the same distribution, it simply lets the diversity rules decide
   * which of two comparably-weighted candidates is taken first.
   */
  public select(params: {
    scored: ScoredCandidate[];
    sessionSeed: string;
    /** Post ids that recently led this subject's feed; skipped for the lead slot only. */
    recentHeroIds?: string[];
  }): { candidateOrder: ScoredCandidate[]; hero: ScoredCandidate | null } {
    const { scored, sessionSeed } = params;
    if (!scored.length) return { candidateOrder: [], hero: null };

    const byScore = [...scored].sort((a, b) => b.finalScore - a.finalScore
      || a.post._id.toString().localeCompare(b.post._id.toString()));

    const hero = this.pickHero(byScore, sessionSeed, params.recentHeroIds || []);
    const heroId = hero?.post._id.toString();

    // The lead is already chosen, so it is drawn out before the rest is ordered
    // rather than competing with itself for a slot.
    const remaining = heroId ? byScore.filter((c) => c.post._id.toString() !== heroId) : byScore;
    const ordered = this.byRaceKey(remaining, sessionSeed).map((row) => row.candidate);

    return { candidateOrder: hero ? [hero, ...ordered] : ordered, hero };
  }

  /**
   * The lead post: a seeded weighted draw from the top-scoring window, skipping
   * posts that recently led this subject's feed.
   *
   * Restricted to that window on purpose. Picking the lead from the whole pool
   * would put an arbitrary post in the most valuable slot on the page, which is
   * a worse failure than always picking the best one.
   */
  private pickHero(
    byScore: ScoredCandidate[],
    sessionSeed: string,
    recentHeroIds: string[]
  ): ScoredCandidate | null {
    if (!byScore.length) return null;
    const window = byScore.slice(0, Math.min(SESSION_OUTPUT_POLICY.heroWindowSize, byScore.length));
    const onCooldown = new Set(recentHeroIds);
    // If every candidate in the window recently led, the cooldown has nothing
    // left to say — fall back to the whole window rather than to no lead at all.
    const eligible = window.filter((c) => !onCooldown.has(c.post._id.toString()));
    const pool = eligible.length ? eligible : window;
    const [picked] = this.weightedSampleWithoutReplacement(pool, 1, `${sessionSeed}:hero`);
    return picked || pool[0] || null;
  }

  /**
   * Seeded weighted order without replacement, for the lead draw.
   *
   * The exponential-race form of Efraimidis-Spirakis: each candidate draws a
   * key `u ** (1 / weight)` from its own seeded uniform and the highest keys
   * win. One pass, and — because each `u` comes from `sha256(seed + postId)` —
   * the same seed always produces the same order, whatever order the pool
   * arrives in.
   */
  private weightedSampleWithoutReplacement(
    candidates: ScoredCandidate[],
    count: number,
    seed: string
  ): ScoredCandidate[] {
    if (count <= 0 || !candidates.length) return [];
    return this.byRaceKey(candidates, seed).slice(0, count).map((row) => row.candidate);
  }

  private byRaceKey(candidates: ScoredCandidate[], seed: string) {
    return candidates
      .map((candidate) => {
        const id = candidate.post._id.toString();
        // `finalScore` can be zero or (through a negative signal) below it;
        // the floor keeps every candidate reachable and the exponent decides
        // how sharply score translates into odds.
        const weight = SESSION_OUTPUT_POLICY.samplingWeightFloor
          + Math.max(0, candidate.finalScore) ** SESSION_OUTPUT_POLICY.samplingExponent;
        const u = Math.max(seededUnitInterval(`${seed}:${id}`), Number.EPSILON);
        return { candidate, key: u ** (1 / weight) };
      })
      .sort((a, b) => b.key - a.key
        || a.candidate.post._id.toString().localeCompare(b.candidate.post._id.toString()));
  }
}
