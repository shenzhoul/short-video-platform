import { Injectable, Logger } from '@nestjs/common';
import {
  COMMENT_CHANNELS,
  COMMENT_OBJECT_TYPES,
  POST_ROOM_EVENTS,
  REACTION_CHANNELS,
  REACTION_TARGET_TYPES
} from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { CommentService } from 'src/services/community/comment/comment.service';
import { PostRoomService } from 'src/services/socket/post-room.service';
import { PostStatsCoalescerService } from 'src/services/socket/post-stats-coalescer.service';

const POST_ROOM_COMMENT_TOPIC = 'POST_ROOM_COMMENT_TOPIC';
const POST_ROOM_REACTION_TOPIC = 'POST_ROOM_REACTION_TOPIC';

/**
 * Feeds the live Post Detail rooms from committed domain events.
 *
 * Two classes of traffic, handled deliberately differently:
 *
 * - **content** (a comment appearing or disappearing) is emitted per event,
 *   because the content itself is what the viewer needs;
 * - **counters** are never emitted per mutation. They only mark the post dirty,
 *   and the coalescer turns any number of mutations into a bounded number of
 *   absolute snapshots.
 *
 * Its own queue topics, so post-room delivery cannot interfere with the
 * notification listeners already subscribed to the same channels — those two
 * concerns have different audiences and must fail independently.
 */
@Injectable()
export class PostRoomListener {
  private readonly logger = new Logger(PostRoomListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly postRoomService: PostRoomService,
    private readonly postStatsCoalescerService: PostStatsCoalescerService,
    private readonly commentService: CommentService
  ) {
    this.queueMessageService.subscribe(
      COMMENT_CHANNELS.COMMENT,
      POST_ROOM_COMMENT_TOPIC,
      this.handleComment.bind(this)
    );
    this.queueMessageService.subscribe(
      REACTION_CHANNELS.REACTION,
      POST_ROOM_REACTION_TOPIC,
      this.handleReaction.bind(this)
    );
  }

  public async handleComment({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      const comment = event.data;
      if (!comment?._id) return;

      const isReply = comment.objectType === COMMENT_OBJECT_TYPES.COMMENT;
      // A reply names its root, not the post, so the containing post has to be
      // resolved before the room can be addressed.
      const postId = isReply
        ? (await this.commentService.findById(comment.objectId))?.objectId
        : comment.objectId;
      if (!postId) return;

      if (event.eventName === EVENT.CREATED) {
        await this.postRoomService.emit(
          postId,
          isReply ? POST_ROOM_EVENTS.REPLY_CREATED : POST_ROOM_EVENTS.COMMENT_CREATED,
          {
            // The comment id doubles as the event id: a redelivered queue job
            // carries the same one, so the client can ignore what it already has.
            eventId: comment._id.toString(),
            postId: postId.toString(),
            occurredAt: new Date().toISOString(),
            ...(isReply ? { rootId: comment.objectId?.toString() } : {}),
            [isReply ? 'reply' : 'comment']: comment
          }
        );
      }

      if (event.eventName === EVENT.DELETED) {
        await this.postRoomService.emit(postId, POST_ROOM_EVENTS.COMMENT_DELETED, {
          eventId: comment._id.toString(),
          postId: postId.toString(),
          occurredAt: new Date().toISOString(),
          commentId: comment._id.toString(),
          ...(isReply ? { rootId: comment.objectId?.toString() } : {})
        });
      }

      // totalComment moved either way, but it travels in a snapshot rather than
      // alongside the content event, so both classes stay bounded separately.
      await this.postStatsCoalescerService.markDirty(postId);
    } catch (e) {
      // The comment is already stored; live delivery must not undo it.
      this.logger.error(`Failed to handle post room comment event: ${e.message}`, e.stack);
    }
  }

  public async handleReaction({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      const { objectId, objectType } = event.data || {};
      // Only post-level reactions move a post's shared counters. Comment likes
      // and follows are someone else's concern.
      if (objectType !== REACTION_TARGET_TYPES.POST || !objectId) return;

      // Never an emit — only a mark. This is the line that keeps 10,000
      // likes/sec from becoming 10,000 broadcasts/sec.
      await this.postStatsCoalescerService.markDirty(objectId);
    } catch (e) {
      this.logger.error(`Failed to handle post room reaction event: ${e.message}`, e.stack);
    }
  }
}
