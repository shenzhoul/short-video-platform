import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { CHAIN_POLICY, RecommendationFeedType } from 'src/common/constants/recommendation';
import { REDIS_KEYS } from 'src/kernel/infras/redis/redis-keys';

export interface BrowsingChainState {
  chainId: string;
  /** Every post this chain has served, across all its sessions. */
  seenPostIds: string[];
  /**
   * The tail of what was served most recently, kept across a recycle so the
   * first session of a new cycle cannot open on the posts the viewer just
   * finished reading.
   */
  recentTailPostIds: string[];
  /** How many times this chain has been recycled. 0 is the first pass. */
  cycle: number;
}

/**
 * Browsing chains — the shared infrastructure behind "keep scrolling".
 *
 * ## The three identities, which are not the same thing
 *
 * | Concept | Lives for | Owned by |
 * |---|---|---|
 * | **subject** (`viewerId` / `anonymousId`) | as long as the account or the guest cookie | personalisation |
 * | **browsing chain** (`chainId`) | one page load of one surface | this service |
 * | **feed session** (`sessionId`) | one ranked batch | `RecommendationSessionService` |
 *
 * A chain is deliberately *not* derived from the subject: one subject browses
 * many times, in several tabs, and each of those must be free to see the
 * catalogue from the start. It is also not derived from the first session id,
 * which is what shipped in `deploy-2026-09-06g` — an implicit identity nobody
 * can name, reset or reason about from the client.
 *
 * The client mints it (`crypto.randomUUID()`, once per page load per surface)
 * and sends it. A reload mints a new one, so a reload is a fresh browse. Two
 * tabs mint different ones, so they do not consume each other's catalogue.
 *
 * ## Ranking is not in here
 *
 * This service knows nothing about scoring, candidate sources or diversity.
 * Home and For You keep their own rankers and their own session sizes; the only
 * thing they share is *what has already been served in this browse*, which is
 * bookkeeping rather than recommendation.
 *
 * ## Subject binding
 *
 * A chain id arrives from the client, so it is bounded, shape-checked, and
 * bound to the subject that created it. `resolve` returns null for a chain
 * belonging to somebody else — the caller then treats it as a new chain rather
 * than reading what another viewer was shown.
 */
@Injectable()
export class RecommendationChainService {
  private readonly logger = new Logger(RecommendationChainService.name);

  constructor(@InjectRedis() private readonly redisClient: Redis) { }

  /**
   * Shape check for a client-supplied chain id.
   *
   * It becomes a Redis key segment, so anything outside this shape is refused
   * rather than sanitised — a caller that sends a bad id gets an unchained
   * (still working) feed, not a key-injection surface.
   */
  public isValidChainId(value?: string | null): boolean {
    return typeof value === 'string'
      && value.length >= CHAIN_POLICY.minIdLength
      && value.length <= CHAIN_POLICY.maxIdLength
      && /^[A-Za-z0-9_-]+$/.test(value);
  }

  private keys(feedType: RecommendationFeedType, chainId: string) {
    return {
      meta: REDIS_KEYS.recoChainMeta(feedType, chainId),
      seen: REDIS_KEYS.recoChainSeen(feedType, chainId),
      tail: REDIS_KEYS.recoChainTail(feedType, chainId)
    };
  }

  /**
   * Read a chain, creating its metadata on first use.
   *
   * Returns null when the id is malformed or the chain belongs to a different
   * subject. Redis being unavailable also returns null: losing the chain
   * degrades the feed to "may repeat", which is the pre-chain behaviour, and is
   * never a reason to fail a feed request.
   */
  public async resolve(
    chainId: string | undefined | null,
    subjectId: string,
    feedType: RecommendationFeedType
  ): Promise<BrowsingChainState | null> {
    if (!this.isValidChainId(chainId)) return null;
    const id = chainId as string;
    const keys = this.keys(feedType, id);

    try {
      const meta = await this.redisClient.hgetall(keys.meta);

      if (meta && meta.subjectId && meta.subjectId !== subjectId) {
        // Somebody else's chain. Not an error the caller needs to see — it
        // simply is not theirs, so they get a fresh one.
        this.logger.warn(`Chain ${id.slice(0, 8)} requested by a different subject; ignoring`);
        return null;
      }

      if (!meta || !meta.subjectId) {
        await this.redisClient
          .multi()
          .hset(keys.meta, { subjectId, cycle: '0', createdAt: new Date().toISOString() })
          .expire(keys.meta, CHAIN_POLICY.ttlSeconds)
          .exec();
      }

      /*
       * The seen set and the tail are read whether or not the metadata was
       * already there.
       *
       * Returning early on a missing hash would treat "this chain has no
       * metadata yet" as "this chain has served nothing" — and the three keys
       * have independent lifetimes, so losing the small one would silently
       * discard the browse's whole memory and replay the catalogue.
       */
      const [seenPostIds, recentTailPostIds] = await Promise.all([
        this.redisClient.smembers(keys.seen),
        this.redisClient.lrange(keys.tail, 0, CHAIN_POLICY.recentTailSize - 1)
      ]);

      // Keep an active chain alive; an abandoned one still expires.
      await this.touch(feedType, id);

      return {
        chainId: id,
        seenPostIds,
        recentTailPostIds,
        cycle: Number.parseInt(meta?.cycle, 10) || 0
      };
    } catch (e: any) {
      this.logger.warn(`Chain read failed, continuing unchained: ${e.message}`);
      return null;
    }
  }

  /**
   * Record what a session served.
   *
   * Written when the ranked order is fixed, not when the client reports an
   * impression: telemetry is best-effort and arrives late, and a rollover
   * racing it would re-rank the page still on screen.
   */
  public async recordServed(
    feedType: RecommendationFeedType,
    chainId: string,
    postIds: string[]
  ): Promise<void> {
    if (!postIds.length) return;
    const keys = this.keys(feedType, chainId);
    try {
      await this.redisClient
        .multi()
        .sadd(keys.seen, ...postIds)
        .expire(keys.seen, CHAIN_POLICY.ttlSeconds)
        // LPUSH pushes each argument in turn, so the LAST id given ends up at
        // index 0 — the tail reads most-recent-first, and the anti-repeat
        // window after a recycle is the end of the previous cycle rather than
        // its beginning.
        .lpush(keys.tail, ...postIds)
        .ltrim(keys.tail, 0, CHAIN_POLICY.recentTailSize - 1)
        .expire(keys.tail, CHAIN_POLICY.ttlSeconds)
        .expire(keys.meta, CHAIN_POLICY.ttlSeconds)
        .exec();
    } catch (e: any) {
      this.logger.warn(`Chain write failed; this session will not be excluded later: ${e.message}`);
    }
  }

  /**
   * Start a new cycle: forget what has been served, keep the recent tail.
   *
   * Called when the chain has genuinely served every eligible post. The tail
   * survives on purpose — recycling must not hand the viewer the same posts
   * they were reading a moment ago.
   */
  public async recycle(feedType: RecommendationFeedType, chainId: string): Promise<number> {
    const keys = this.keys(feedType, chainId);
    try {
      const cycle = await this.redisClient.hincrby(keys.meta, 'cycle', 1);
      await this.redisClient
        .multi()
        .del(keys.seen)
        .expire(keys.meta, CHAIN_POLICY.ttlSeconds)
        .expire(keys.tail, CHAIN_POLICY.ttlSeconds)
        .exec();
      return cycle;
    } catch (e: any) {
      this.logger.warn(`Chain recycle failed: ${e.message}`);
      return 0;
    }
  }

  /** Refresh every TTL for a chain still being scrolled. */
  private async touch(feedType: RecommendationFeedType, chainId: string): Promise<void> {
    const keys = this.keys(feedType, chainId);
    await this.redisClient
      .multi()
      .expire(keys.meta, CHAIN_POLICY.ttlSeconds)
      .expire(keys.seen, CHAIN_POLICY.ttlSeconds)
      .expire(keys.tail, CHAIN_POLICY.ttlSeconds)
      .exec();
  }
}
