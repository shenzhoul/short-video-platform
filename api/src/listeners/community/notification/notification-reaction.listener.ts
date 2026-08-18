import { Injectable, Logger } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import {
  COMMENT_OBJECT_TYPES,
  NOTIFICATION_GROUP_KEYS,
  NOTIFICATION_POLICY,
  NOTIFICATION_TYPES,
  REACTION_CHANNELS,
  REACTION_TARGET_TYPES,
  REACTION_TYPES
} from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { CommentService } from 'src/services/community/comment/comment.service';
import { NotificationService } from 'src/services/community/notification';
import { ReactionService } from 'src/services/community/reaction/reaction.service';
import { PostCrudService } from 'src/services/content/post/post-crud.service';

const NOTIFICATION_REACTION_TOPIC = 'NOTIFICATION_REACTION_TOPIC';

/** Converts committed like and follow events into policy-aware notifications. */
@Injectable()
export class NotificationReactionListener {
  private logger = new Logger(NotificationReactionListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly notificationService: NotificationService,
    private readonly postService: PostCrudService,
    private readonly commentService: CommentService,
    private readonly reactionService: ReactionService
  ) {
    this.queueMessageService.subscribe(
      REACTION_CHANNELS.REACTION,
      NOTIFICATION_REACTION_TOPIC,
      this.handleReaction.bind(this)
    );
  }

  public async handleReaction({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      if (![EVENT.CREATED, EVENT.DELETED].includes(event.eventName)) return;

      const {
        _id: reactionId, objectId, objectType, action
      } = event.data;
      const actorId = event.data.createdBy;
      if (!actorId || !objectId) return;

      if (objectType === REACTION_TARGET_TYPES.CREATOR && action === REACTION_TYPES.FOLLOW) {
        if (event.eventName !== EVENT.CREATED) return;
        await this.notificationService.resurface({
          recipientId: objectId,
          actorId,
          type: NOTIFICATION_TYPES.FOLLOW,
          groupKey: NOTIFICATION_GROUP_KEYS.follow(actorId.toString())
        }, NOTIFICATION_POLICY.FOLLOW_COOLDOWN_MS);
        return;
      }

      // Shares update statistics only; they deliberately do not create an
      // interaction notification because delivery belongs to messaging.
      if (action !== REACTION_TYPES.LIKE || !reactionId) return;

      if (objectType === REACTION_TARGET_TYPES.POST) {
        const post = await this.postService.findById(objectId);
        if (!post?.userId) return;

        await this.handleLike({
          eventName: event.eventName,
          reactionId,
          recipientId: post.userId,
          actorId,
          type: NOTIFICATION_TYPES.POST_LIKE,
          groupKey: NOTIFICATION_GROUP_KEYS.postLike(post._id.toString()),
          postId: post._id,
          reactionTargetId: post._id,
          reactionTargetType: REACTION_TARGET_TYPES.POST
        });
        return;
      }

      if (objectType !== REACTION_TARGET_TYPES.COMMENT) return;

      const comment = await this.commentService.findById(objectId);
      if (!comment?.createdBy) return;
      const postId = await this.resolveCommentPostId(comment);

      await this.handleLike({
        eventName: event.eventName,
        reactionId,
        recipientId: comment.createdBy,
        actorId,
        type: NOTIFICATION_TYPES.COMMENT_LIKE,
        groupKey: NOTIFICATION_GROUP_KEYS.commentLike(objectId.toString()),
        postId,
        commentId: objectId,
        reactionTargetId: objectId,
        reactionTargetType: REACTION_TARGET_TYPES.COMMENT
      });
    } catch (e) {
      this.logger.error(`Failed to handle reaction notification: ${e.message}`, e.stack);
    }
  }

  private async handleLike(options: {
    eventName: string;
    reactionId: string | ObjectId;
    recipientId: string | ObjectId;
    actorId: string | ObjectId;
    type: string;
    groupKey: string;
    postId?: string | ObjectId | null;
    commentId?: string | ObjectId | null;
    reactionTargetId: string | ObjectId;
    reactionTargetType: string;
  }) {
    if (options.eventName === EVENT.CREATED) {
      await this.notificationService.aggregate({
        recipientId: options.recipientId,
        actorId: options.actorId,
        type: options.type,
        groupKey: options.groupKey,
        postId: options.postId,
        commentId: options.commentId,
        eventId: options.reactionId
      });
      return;
    }

    await this.notificationService.replaceAggregateActor(
      options.recipientId,
      options.groupKey,
      options.actorId,
      async () => {
        const remaining = await this.reactionService.search({
          objectId: options.reactionTargetId.toString(),
          objectType: options.reactionTargetType,
          action: REACTION_TYPES.LIKE,
          limit: 1
        } as any);
        const replacementId = remaining.data[0]?.createdBy;
        return replacementId ? new ObjectId(replacementId.toString()) : null;
      }
    );
  }

  private async resolveCommentPostId(comment: Record<string, any>) {
    if (comment.objectType === COMMENT_OBJECT_TYPES.POST) return comment.objectId || null;
    if (comment.objectType !== COMMENT_OBJECT_TYPES.COMMENT || !comment.objectId) return null;

    const root = await this.commentService.findById(comment.objectId);
    return root?.objectType === COMMENT_OBJECT_TYPES.POST ? root.objectId : null;
  }
}
