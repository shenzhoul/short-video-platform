import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ObjectId } from 'mongodb';
import { POST_STATS_POLICY, USER_STATS_EVENTS } from 'src/common/constants/community';
import { FollowService } from 'src/services/community/follow/follow.service';

import { SocketUserService } from './socket-user.service';
import { REDIS_KEYS } from 'src/kernel/infras/redis/redis-keys';

/** Redis set holding users whose follow counters have moved since the last flush. */
const DIRTY_FOLLOW_USERS_KEY = REDIS_KEYS.dirtyFollowUsers();

/**
 * Coalesces follow counters into bounded, authoritative snapshots.
 *
 * The same shape as the post and comment coalescers, for the same reason: a
 * creator can gain followers faster than anyone can read them, and one socket
 * frame per follow would turn that into an event storm on their sessions.
 *
 * Two things make this one different:
 *
 * - the snapshot goes **only to the user it describes**, through
 *   `emitToUsers`, not to a room. Follow counts are shown in that person's own
 *   header; nobody else needs a frame every time they gain a follower, and
 *   broadcasting one would leak activity to strangers watching the profile.
 * - the totals are counted from the **follow rows**, not from `User.stats`.
 *   The stored counters are a cache that only `follow`/`unfollow` maintain, so
 *   a write that bypassed the service leaves them behind. Counting the rows is
 *   the same definition the profile endpoint and the follower list use, which
 *   is what stops the header and the modal disagreeing.
 */
@Injectable()
export class FollowStatsCoalescerService {
  private readonly logger = new Logger(FollowStatsCoalescerService.name);

  constructor(
    @InjectRedis() private readonly redisClient: Redis,
    private readonly followService: FollowService,
    private readonly socketUserService: SocketUserService
  ) { }

  /**
   * Record that a user's follow counters moved.
   *
   * Must be called after the follow row is written. `FollowService` publishes
   * its domain event only once the row and the cached counters are committed,
   * so a listener reacting to that event is already past the write.
   */
  public async markDirty(userId: string | ObjectId): Promise<void> {
    if (!userId) return;
    try {
      await this.redisClient.sadd(DIRTY_FOLLOW_USERS_KEY, userId.toString());
    } catch (e) {
      // A missed mark costs one late snapshot, never a wrong total: the next
      // flush of that user re-counts from the database.
      this.logger.error(`Failed to mark follow stats dirty for ${userId}: ${e.message}`);
    }
  }

  /**
   * Emit one absolute snapshot for every user marked dirty since the last flush.
   *
   * `SPOP` is what makes this safe on several instances at once: it removes and
   * returns members atomically, so concurrent drainers get disjoint subsets.
   *
   * @returns how many snapshots were emitted, for the job log
   */
  public async flush(): Promise<number> {
    const userIds = await this.redisClient.spop(
      DIRTY_FOLLOW_USERS_KEY,
      POST_STATS_POLICY.MAX_USERS_PER_FOLLOW_FLUSH
    );
    if (!userIds?.length) return 0;

    const at = new Date();
    const emitted = await Promise.all(userIds.map(async (userId) => {
      try {
        const counts = await this.followService.countFollowRelations(userId);
        await this.socketUserService.emitToUsers(
          userId,
          USER_STATS_EVENTS.FOLLOW_STATS_UPDATED,
          {
            // Identifies the subject, not the occurrence: applying the same
            // absolute snapshot twice reaches the same state, so there is
            // nothing here for a client to de-duplicate.
            eventId: `${USER_STATS_EVENTS.FOLLOW_STATS_UPDATED}:${userId}`,
            userId: userId.toString(),
            followersCount: counts.followers,
            followingCount: counts.followings,
            // Emission time, because a follow row carries no version of its own
            // and the pair of counts has no single document to read one from.
            // Monotonic per flush, which is all the client needs to discard a
            // frame that overtook a newer one.
            revision: at.getTime(),
            updatedAt: at.toISOString()
          }
        );
        return 1;
      } catch (e) {
        // Live delivery is an enhancement over the authoritative HTTP state, so
        // one failed user must not stop the others being told.
        this.logger.error(`Failed to emit follow stats for ${userId}: ${e.message}`, e.stack);
        return 0;
      }
    }));

    return emitted.reduce((total, one) => total + one, 0);
  }
}
