import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { DETAIL_SESSION_POLICY } from 'src/common/constants/recommendation';
import { REDIS_KEYS } from 'src/kernel/infras/redis/redis-keys';

export interface DetailSessionItem {
  postId: string;
  /** 'anchor' for the post the modal was opened on, otherwise the bucket that produced it. */
  source: string;
}

export interface DetailSessionState {
  sessionId: string;
  items: DetailSessionItem[];
  cursorIndex: number;
  sessionSeed: string;
}

/**
 * Anchor-based Post Detail next/previous sequence for sources that are not a
 * feed the viewer is looking at (Home grid, notification, message-shared-post,
 * direct link — rules/instructions §13.1, §13.4).
 *
 * Unlike the feed session, this list is *not* pre-generated: it starts as
 * `[anchor]` and grows one post at a time as the viewer presses "next", via
 * `appendAndAdvance`. "Previous" only ever re-reads an index that was already
 * appended, which is what makes it revisit exactly what was shown rather than
 * recomputing anything (rules/instructions §13.1: "Không recompute ngẫu nhiên
 * khi bấm previous").
 */
@Injectable()
export class PostDetailRecommendationSessionService {
  private readonly logger = new Logger(PostDetailRecommendationSessionService.name);

  constructor(@InjectRedis() private readonly redisClient: Redis) { }

  public async create(subjectId: string, anchorPostId: string): Promise<DetailSessionState> {
    const sessionId = randomUUID();
    const sessionSeed = randomUUID();
    const itemsKey = REDIS_KEYS.recoDetailSessionItems(sessionId);
    const metaKey = REDIS_KEYS.recoDetailSessionMeta(sessionId);

    const anchorItem: DetailSessionItem = { postId: anchorPostId, source: 'anchor' };

    const pipeline = this.redisClient.pipeline();
    pipeline.rpush(itemsKey, JSON.stringify(anchorItem));
    pipeline.hset(metaKey, {
      subjectId, cursorIndex: '0', sessionSeed, createdAt: new Date().toISOString()
    });
    pipeline.expire(itemsKey, DETAIL_SESSION_POLICY.ttlSeconds);
    pipeline.expire(metaKey, DETAIL_SESSION_POLICY.ttlSeconds);
    await pipeline.exec();

    return {
      sessionId, items: [anchorItem], cursorIndex: 0, sessionSeed
    };
  }

  public async getState(sessionId: string, subjectId: string): Promise<DetailSessionState | null> {
    const itemsKey = REDIS_KEYS.recoDetailSessionItems(sessionId);
    const metaKey = REDIS_KEYS.recoDetailSessionMeta(sessionId);

    let meta: Record<string, string>;
    try {
      meta = await this.redisClient.hgetall(metaKey);
    } catch (e: any) {
      this.logger.warn(`Detail session read failed, degrading to a fresh session: ${e.message}`);
      return null;
    }
    if (!meta || !meta.subjectId || meta.subjectId !== subjectId) return null;

    const rawItems = await this.redisClient.lrange(itemsKey, 0, -1);
    if (!rawItems.length) return null;

    await Promise.all([
      this.redisClient.expire(itemsKey, DETAIL_SESSION_POLICY.ttlSeconds),
      this.redisClient.expire(metaKey, DETAIL_SESSION_POLICY.ttlSeconds)
    ]);

    return {
      sessionId,
      items: rawItems.map((raw) => JSON.parse(raw) as DetailSessionItem),
      cursorIndex: Math.min(Number.parseInt(meta.cursorIndex, 10) || 0, rawItems.length - 1),
      sessionSeed: meta.sessionSeed
    };
  }

  /** Moves the cursor back one step, if there is a previous item. Never mutates the list. */
  public async stepBack(sessionId: string, subjectId: string): Promise<DetailSessionState | null> {
    const state = await this.getState(sessionId, subjectId);
    if (!state || state.cursorIndex <= 0) return null;
    const cursorIndex = state.cursorIndex - 1;
    await this.redisClient.hset(REDIS_KEYS.recoDetailSessionMeta(sessionId), 'cursorIndex', String(cursorIndex));
    return { ...state, cursorIndex };
  }

  /** Moves the cursor forward one step if an item is already there; returns null when the caller must generate one. */
  public async stepForwardIfExists(sessionId: string, subjectId: string): Promise<DetailSessionState | null> {
    const state = await this.getState(sessionId, subjectId);
    if (!state || state.cursorIndex + 1 >= state.items.length) return null;
    const cursorIndex = state.cursorIndex + 1;
    await this.redisClient.hset(REDIS_KEYS.recoDetailSessionMeta(sessionId), 'cursorIndex', String(cursorIndex));
    return { ...state, cursorIndex };
  }

  /** Appends a newly computed post and advances the cursor to it. Capped at `maxItems`. */
  public async appendAndAdvance(sessionId: string, subjectId: string, item: DetailSessionItem): Promise<DetailSessionState | null> {
    const state = await this.getState(sessionId, subjectId);
    if (!state) return null;
    if (state.items.length >= DETAIL_SESSION_POLICY.maxItems) return state; // Hard cap — treat as end of sequence.

    const itemsKey = REDIS_KEYS.recoDetailSessionItems(sessionId);
    const metaKey = REDIS_KEYS.recoDetailSessionMeta(sessionId);
    const cursorIndex = state.items.length;

    const pipeline = this.redisClient.pipeline();
    pipeline.rpush(itemsKey, JSON.stringify(item));
    pipeline.hset(metaKey, 'cursorIndex', String(cursorIndex));
    pipeline.expire(itemsKey, DETAIL_SESSION_POLICY.ttlSeconds);
    pipeline.expire(metaKey, DETAIL_SESSION_POLICY.ttlSeconds);
    await pipeline.exec();

    return { ...state, items: [...state.items, item], cursorIndex };
  }
}
