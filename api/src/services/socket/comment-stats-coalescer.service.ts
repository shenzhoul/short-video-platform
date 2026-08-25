import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import Redis from 'ioredis';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import {
  COMMENT_OBJECT_TYPES,
  POST_ROOM_EVENTS,
  POST_STATS_POLICY
} from 'src/common/constants/community';
import { Comment, CommentDocument } from 'src/schemas/community/comment';

import { PostRoomService } from './post-room.service';

/** Redis set holding comments whose counters have moved since the last flush. */
const DIRTY_COMMENTS_KEY = 'comment:stats:dirty';

/**
 * Coalesces per-comment counters into bounded, authoritative snapshots.
 *
 * The same shape as the post coalescer, and for the same reason: a comment on a
 * viral post can take likes faster than anyone can read them, and one socket
 * frame per like would turn that into an event storm. A mutation only *marks*
 * the comment dirty; the scheduled flush emits at most one snapshot per comment
 * per interval, so broadcast volume is bounded by the flush rate rather than by
 * traffic.
 *
 * Snapshots are absolute totals read back from the database, never deltas. That
 * is what makes a dropped frame, a reconnect and two people liking at the same
 * instant all self-correct: the next snapshot states the truth outright instead
 * of asking the client to have applied every previous one.
 *
 * Both counters travel together because they coalesce through the same set — a
 * comment being liked and replied to at once costs one frame, not two.
 */
@Injectable()
export class CommentStatsCoalescerService {
  private readonly logger = new Logger(CommentStatsCoalescerService.name);

  constructor(
    @InjectRedis() private readonly redisClient: Redis,
    @InjectModel(Comment.name) private readonly CommentModel: Model<CommentDocument>,
    private readonly postRoomService: PostRoomService
  ) { }

  /**
   * Record that a comment's counters moved.
   *
   * Cheap and idempotent — one `SADD` however many mutations land in the same
   * window, which is what collapses N mutations into one flush. It carries no
   * values, so nothing here can go stale; the flush reads the totals.
   *
   * Must be called *after* the counter write commits. Marking before would let
   * a flush land in between and publish the pre-increment total as though it
   * were final, and with no further mutation to correct it that stale number
   * would be the last thing every viewer saw.
   */
  public async markDirty(commentId: string | ObjectId): Promise<void> {
    if (!commentId) return;
    try {
      await this.redisClient.sadd(DIRTY_COMMENTS_KEY, commentId.toString());
    } catch (e) {
      // A missed mark costs one late snapshot, never a wrong total: the next
      // flush of that comment re-reads everything from the database.
      this.logger.error(`Failed to mark comment ${commentId} dirty: ${e.message}`);
    }
  }

  /**
   * Emit one absolute snapshot for every comment marked dirty since the last
   * flush, to the room of the post that contains it.
   *
   * `SPOP` is what makes this safe on several instances at once: it removes and
   * returns members atomically, so concurrent drainers get disjoint subsets.
   *
   * @returns how many snapshots were emitted, for the job log
   */
  public async flush(): Promise<number> {
    const commentIds = await this.redisClient.spop(
      DIRTY_COMMENTS_KEY,
      POST_STATS_POLICY.MAX_COMMENTS_PER_FLUSH
    );
    if (!commentIds?.length) return 0;

    const comments = await this.CommentModel
      .find({ _id: { $in: commentIds.map((id) => new ObjectId(id)) } })
      .select({
        _id: 1, objectId: 1, objectType: 1, totalLike: 1, totalReply: 1, updatedAt: 1
      })
      .lean();
    if (!comments.length) return 0;

    const postIdByComment = await this.resolvePostIds(comments);

    const at = new Date();
    const emits = comments.map((comment) => {
      const postId = postIdByComment.get(comment._id.toString());
      // A comment whose post has gone simply produces no snapshot; there is no
      // room left to address.
      if (!postId) return null;

      const isReply = comment.objectType === COMMENT_OBJECT_TYPES.COMMENT;
      return this.postRoomService.emit(postId, POST_ROOM_EVENTS.COMMENT_STATS_UPDATED, {
        // Identifies the subject, not the occurrence: a client applying the
        // same absolute snapshot twice reaches the same state, so there is
        // nothing here to de-duplicate.
        eventId: `${POST_ROOM_EVENTS.COMMENT_STATS_UPDATED}:${comment._id}`,
        postId,
        commentId: comment._id.toString(),
        parentCommentId: isReply ? comment.objectId.toString() : null,
        likesCount: comment.totalLike || 0,
        replyCount: comment.totalReply || 0,
        // The comment's own last-write time, so a client can discard a snapshot
        // that overtook a newer one in flight. Mongoose maintains it on the
        // counter updates themselves, so it moves whenever these numbers do.
        revision: comment.updatedAt ? new Date(comment.updatedAt).getTime() : at.getTime(),
        updatedAt: (comment.updatedAt ? new Date(comment.updatedAt) : at).toISOString()
      });
    });

    await Promise.all(emits.filter(Boolean));
    return emits.filter(Boolean).length;
  }

  /**
   * Map every drained comment to the post whose room should hear about it.
   *
   * Parents are fetched in one `$in` rather than per reply: a busy thread drains
   * many replies of the same parent in a single flush, and a query each would
   * turn one flush into a query storm.
   */
  private async resolvePostIds(
    comments: Array<{ _id: ObjectId; objectId: ObjectId; objectType: string }>
  ): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    const parentIds: ObjectId[] = [];

    comments.forEach((comment) => {
      if (comment.objectType === COMMENT_OBJECT_TYPES.COMMENT) {
        parentIds.push(comment.objectId);
        return;
      }
      resolved.set(comment._id.toString(), comment.objectId.toString());
    });

    if (!parentIds.length) return resolved;

    const parents = await this.CommentModel
      .find({ _id: { $in: parentIds } })
      .select({ _id: 1, objectId: 1, objectType: 1 })
      .lean();
    const postIdByParent = new Map(parents
      .filter((parent) => parent.objectType !== COMMENT_OBJECT_TYPES.COMMENT)
      .map((parent) => [parent._id.toString(), parent.objectId.toString()]));

    comments
      .filter((comment) => comment.objectType === COMMENT_OBJECT_TYPES.COMMENT)
      .forEach((comment) => {
        const postId = postIdByParent.get(comment.objectId.toString());
        if (postId) resolved.set(comment._id.toString(), postId);
      });

    return resolved;
  }
}
