import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { FEED_SESSION_POLICY, RecommendationFeedType, RecommendationSource } from 'src/common/constants/recommendation';
import { REDIS_KEYS } from 'src/kernel/infras/redis/redis-keys';
import { ScoredCandidate } from './recommendation-scoring.service';

export interface FeedSessionItem {
  postId: string;
  source: RecommendationSource;
  score: number;
}

export interface FeedSessionPage {
  sessionId: string;
  items: FeedSessionItem[];
  hasMore: boolean;
  nextCursor: string | null;
  total: number;
  /** The browsing chain this session belongs to, echoed on every page. */
  chainId: string | null;
}

/**
 * Redis-backed, write-once ranked list for one Home/For You feed session.
 *
 * The full ranked order is computed once (`create`) and stored as a Redis
 * `LIST`; every subsequent page is a stateless `LRANGE` keyed by a
 * client-held numeric-offset cursor. That statelessness is what makes
 * concurrent "load more" calls safe without a lock: two requests for the same
 * cursor both read the same, unmutated range — there is no server-side
 *
 * A reload (no `sessionId` supplied by the caller) always calls `create`
 * again with a fresh `sessionSeed`, which is what makes reload produce a
 * different mix/order while an existing session's pagination stays stable
 */
@Injectable()
export class RecommendationSessionService {
  private readonly logger = new Logger(RecommendationSessionService.name);

  constructor(@InjectRedis() private readonly redisClient: Redis) { }

  public newSessionSeed(): string {
    return randomUUID();
  }

  /**
   * Store a freshly ranked candidate list as a new session, bound to
   * `subjectId` (an authenticated user id or an anonymous session id — never
   * guessable, so one subject can never read another's session by swapping
   * the id even if they somehow learned it).
   *
   * `chainId` is recorded but not interpreted here: this service owns one
   * ranked batch; `RecommendationChainService` owns the browse that strings
   * several of them together.
   */
  public async create(params: {
    subjectId: string;
    feedType: RecommendationFeedType;
    topicKey?: string | null;
    sessionSeed: string;
    ranked: ScoredCandidate[];
    chainId?: string | null;
  }): Promise<{ sessionId: string; postIds: string[] }> {
    const sessionId = randomUUID();
    const items = params.ranked.slice(0, FEED_SESSION_POLICY.maxItems);
    const postIds = items.map((candidate) => candidate.post._id.toString());
    const encoded = items.map((candidate, index) => JSON.stringify({
      postId: postIds[index],
      source: candidate.source,
      score: Number(candidate.finalScore.toFixed(6))
    } as FeedSessionItem));

    const itemsKey = REDIS_KEYS.recoFeedSessionItems(sessionId);
    const metaKey = REDIS_KEYS.recoFeedSessionMeta(sessionId);

    const pipeline = this.redisClient.pipeline();
    if (encoded.length) pipeline.rpush(itemsKey, ...encoded);
    pipeline.hset(metaKey, {
      subjectId: params.subjectId,
      feedType: params.feedType,
      topicKey: params.topicKey || '',
      sessionSeed: params.sessionSeed,
      chainId: params.chainId || '',
      createdAt: new Date().toISOString()
    });
    pipeline.expire(itemsKey, FEED_SESSION_POLICY.ttlSeconds);
    pipeline.expire(metaKey, FEED_SESSION_POLICY.ttlSeconds);
    await pipeline.exec();

    return { sessionId, postIds };
  }

  /**
   * Read a page. Returns `null` when the session is missing/expired/mismatched
   * subject — callers treat that as "create a new session"
   */
  public async getPage(sessionId: string, subjectId: string, cursor: string | null, limit: number): Promise<FeedSessionPage | null> {
    const itemsKey = REDIS_KEYS.recoFeedSessionItems(sessionId);
    const metaKey = REDIS_KEYS.recoFeedSessionMeta(sessionId);

    let meta: Record<string, string>;
    try {
      meta = await this.redisClient.hgetall(metaKey);
    } catch (e: any) {
      this.logger.warn(`Feed session read failed, degrading to a fresh session: ${e.message}`);
      return null;
    }

    if (!meta || !meta.subjectId) return null;
    if (meta.subjectId !== subjectId) return null; // Never serve one subject's session to another.

    const offset = Math.max(0, Number.parseInt(cursor || '0', 10) || 0);
    const [rawItems, total] = await Promise.all([
      this.redisClient.lrange(itemsKey, offset, offset + limit - 1),
      this.redisClient.llen(itemsKey)
    ]);

    // Keep an active session alive; an idle one still expires at ttlSeconds
    await Promise.all([
      this.redisClient.expire(itemsKey, FEED_SESSION_POLICY.ttlSeconds),
      this.redisClient.expire(metaKey, FEED_SESSION_POLICY.ttlSeconds)
    ]);

    const items = rawItems.map((raw) => JSON.parse(raw) as FeedSessionItem);
    const hasMore = offset + limit < total;

    return {
      sessionId,
      items,
      hasMore,
      nextCursor: hasMore ? String(offset + limit) : null,
      total,
      chainId: meta.chainId || null
    };
  }

  public async getTopicKey(sessionId: string): Promise<string | null> {
    const value = await this.redisClient.hget(REDIS_KEYS.recoFeedSessionMeta(sessionId), 'topicKey');
    return value || null;
  }
}
