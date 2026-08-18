import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import Redis from 'ioredis';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { POST_ROOM_EVENTS, POST_STATS_POLICY } from 'src/common/constants/community';
import { Post, PostDocument } from 'src/schemas';

import { PostRoomService } from './post-room.service';

/** Redis set holding posts whose shared counters have moved since the last flush. */
const DIRTY_POSTS_KEY = 'post:stats:dirty';

/**
 * Coalesces shared post counters into bounded, authoritative snapshots.
 *
 * A viral post can take thousands of likes a second. Emitting one socket frame
 * per mutation would turn that into thousands of room broadcasts a second, which
 * is the event storm this exists to prevent. Instead a mutation only *marks* the
 * post dirty, and a scheduled flush emits at most one snapshot per post per
 * interval — so broadcast volume is bounded by the flush rate, not by traffic.
 *
 * Snapshots are absolute totals read back from the database, never deltas: a
 * client that misses a frame is corrected by the next one instead of drifting
 * further away with every miss.
 */
@Injectable()
export class PostStatsCoalescerService {
  private readonly logger = new Logger(PostStatsCoalescerService.name);

  constructor(
    @InjectRedis() private readonly redisClient: Redis,
    @InjectModel(Post.name) private readonly PostModel: Model<PostDocument>,
    private readonly postRoomService: PostRoomService
  ) { }

  /**
   * Record that a post's shared counters moved.
   *
   * Deliberately cheap and idempotent — one `SADD` regardless of how many
   * mutations land in the same window, which is what collapses N mutations into
   * one flush. It carries no values, so nothing here can go stale; the flush
   * reads the authoritative totals instead.
   */
  public async markDirty(postId: string | ObjectId): Promise<void> {
    if (!postId) return;
    try {
      await this.redisClient.sadd(DIRTY_POSTS_KEY, postId.toString());
    } catch (e) {
      // A missed mark costs one late snapshot, never a wrong total, because the
      // next flush of that post re-reads everything from the database.
      this.logger.error(`Failed to mark post ${postId} dirty: ${e.message}`);
    }
  }

  /**
   * Emit one absolute snapshot for every post marked dirty since the last flush.
   *
   * `SPOP` is what makes this safe to run on several instances at once: it
   * removes and returns members atomically, so concurrent drainers receive
   * disjoint subsets — no post is emitted twice and none is skipped.
   *
   * The read-after-drain ordering is also deliberate. A mutation landing between
   * the drain and the database read re-adds the post to the set, so it is picked
   * up by the following flush. The worst case is one redundant snapshot; a lost
   * update is not possible.
   *
   * @returns how many snapshots were emitted, for the job log
   */
  public async flush(): Promise<number> {
    const postIds = await this.redisClient.spop(
      DIRTY_POSTS_KEY,
      POST_STATS_POLICY.MAX_POSTS_PER_FLUSH
    );
    if (!postIds?.length) return 0;

    const posts = await this.PostModel
      .find({ _id: { $in: postIds.map((id) => new ObjectId(id)) } })
      .select({
        _id: 1, totalLike: 1, totalComment: 1, totalShare: 1, updatedAt: 1
      })
      .lean();

    const at = new Date();
    await Promise.all(posts.map((post) => this.postRoomService.emit(
      post._id,
      POST_ROOM_EVENTS.STATS_UPDATED,
      {
        postId: post._id.toString(),
        totalLike: post.totalLike || 0,
        totalComment: post.totalComment || 0,
        totalShare: post.totalShare || 0,
        // The post's own last-write time, so a client can discard a snapshot
        // that overtook a newer one in flight. There is no dedicated sequence
        // counter on the document, and adding one is not worth a migration.
        version: post.updatedAt ? new Date(post.updatedAt).getTime() : at.getTime(),
        at: at.toISOString()
      }
    )));

    // A post deleted between the mark and the flush simply produces no snapshot.
    return posts.length;
  }
}
