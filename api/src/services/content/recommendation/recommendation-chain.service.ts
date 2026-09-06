import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { CHAIN_POLICY, RecommendationFeedType } from 'src/common/constants/recommendation';
import { REDIS_KEYS } from 'src/kernel/infras/redis/redis-keys';

export interface BrowsingChainState {
  chainId: string;
  /** Every post this chain has served, across all its sessions. */
  seenPostIds: string[];
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
 * ## A chain ends; it does not loop
 *
 * Once a chain has served every eligible post it is **finished**. It does not
 * recycle and start handing the same catalogue out again: the first attempt at
 * that shipped in `deploy-2026-09-06h`, and because a recycled post was given a
 * per-cycle render key the client treated it as new and appended it — Home grew
 * to **410 cards** on a 160-post corpus, visibly repeating itself. Starting
 * over is the viewer's decision ("Refresh recommendations", or a reload), and
 * both of those mint a new chain id.
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
      seen: REDIS_KEYS.recoChainSeen(feedType, chainId)
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
          .hset(keys.meta, { subjectId, createdAt: new Date().toISOString() })
          .expire(keys.meta, CHAIN_POLICY.ttlSeconds)
          .exec();
      }

      /*
       * The seen set is read whether or not the metadata was already there.
       *
       * Returning early on a missing hash would treat "this chain has no
       * metadata yet" as "this chain has served nothing" — and the two keys
       * have independent lifetimes, so losing the small one would silently
       * discard the browse's whole memory and replay the catalogue.
       */
      const seenPostIds = await this.redisClient.smembers(keys.seen);

      // Keep an active chain alive; an abandoned one still expires.
      await this.touch(feedType, id);

      return { chainId: id, seenPostIds };
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
        .expire(keys.meta, CHAIN_POLICY.ttlSeconds)
        .exec();
    } catch (e: any) {
      this.logger.warn(`Chain write failed; this session will not be excluded later: ${e.message}`);
    }
  }

  /** Refresh every TTL for a chain still being scrolled. */
  private async touch(feedType: RecommendationFeedType, chainId: string): Promise<void> {
    const keys = this.keys(feedType, chainId);
    await this.redisClient
      .multi()
      .expire(keys.meta, CHAIN_POLICY.ttlSeconds)
      .expire(keys.seen, CHAIN_POLICY.ttlSeconds)
      .exec();
  }
}
