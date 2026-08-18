import { Injectable, Logger } from '@nestjs/common';
import {
  COMMENT_CHANNELS,
  COMMENT_OBJECT_TYPES,
  NOTIFICATION_GROUP_KEYS,
  NOTIFICATION_POLICY,
  NOTIFICATION_TYPES
} from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { CommentService } from 'src/services/community/comment/comment.service';
import { NotificationService } from 'src/services/community/notification';
import { PostCrudService } from 'src/services/content/post/post-crud.service';

const NOTIFICATION_COMMENT_TOPIC = 'NOTIFICATION_COMMENT_TOPIC';

/**
 * Turns comment events into notifications.
 *
 * A top-level comment targets a post and notifies the post owner. A reply
 * targets its parent comment and notifies that comment's author.
 *
 * For replies the parent comment is loaded to find both the recipient and the
 * post the thread belongs to. The post id is stored alongside the comment id so
 * the notification can navigate somewhere useful — the app has no per-comment
 * deep link, so replies open the containing post.
 */
@Injectable()
export class NotificationCommentListener {
  private logger = new Logger(NotificationCommentListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly notificationService: NotificationService,
    private readonly commentService: CommentService,
    private readonly postService: PostCrudService
  ) {
    this.queueMessageService.subscribe(
      COMMENT_CHANNELS.COMMENT,
      NOTIFICATION_COMMENT_TOPIC,
      this.handleComment.bind(this)
    );
  }

  public async handleComment({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      /**
       * A deleted comment leaves its notifications standing — the interaction
       * still happened — but every connected recipient is holding a DTO that
       * still quotes text which no longer exists. The stored row needs no
       * change; only the rendered copy does.
       *
       * Re-resolving through the read path is what keeps a realtime update and
       * a refetch in agreement, instead of a socket-only notion of "deleted".
       */
      if (event.eventName === EVENT.DELETED) {
        const deletedId = event.data?._id;
        if (deletedId) await this.notificationService.invalidateByCommentIds([deletedId]);
        return;
      }

      if (event.eventName !== EVENT.CREATED) return;

      const {
        objectId, objectType, _id: commentId, replyToUserId
      } = event.data;
      const actorId = event.data.createdBy;
      if (!actorId || !objectId || !commentId) return;

      if (objectType === COMMENT_OBJECT_TYPES.POST) {
        const post = await this.postService.findById(objectId);
        if (!post?.userId) return;

        // Mentions are independent of the comment notification: someone named in
        // a comment hears about it whether or not they own the post, and the post
        // owner still gets their own POST_COMMENT.
        await this.notifyMentions(event.data, actorId, commentId, post._id);

        await this.notificationService.recordAdaptive({
          recipientId: post.userId,
          actorId,
          type: NOTIFICATION_TYPES.POST_COMMENT,
          groupKey: NOTIFICATION_GROUP_KEYS.postComment(commentId.toString()),
          aggregateGroupKey: NOTIFICATION_GROUP_KEYS.postCommentAggregate(post._id.toString()),
          aggregateResourceId: post._id,
          eventId: commentId,
          threshold: NOTIFICATION_POLICY.COMMENT_AGGREGATION_THRESHOLD,
          postId: post._id,
          commentId
        });
        return;
      }

      if (objectType === COMMENT_OBJECT_TYPES.COMMENT) {
        const parentComment = await this.commentService.findById(objectId);
        if (!parentComment) return;

        /**
         * Recipient is whoever is actually being replied to, which is not always
         * the owner of `objectId`.
         *
         * Threads are stored flat: a reply to a reply is still attached to the
         * top-level comment, and the person being answered is carried on
         * `replyToUserId`. Using the parent comment's author alone would send
         * every reply in a thread to whoever started it, so a user who replied
         * inside someone else's thread would never hear about answers to them.
         *
         * `replyToUserId` arrives from the client, so it is never trusted on its
         * own: it may only route a notification once it has been confirmed
         * against stored data as belonging to someone already in this thread.
         * Anything else falls back to the thread's own author, so a crafted
         * request cannot notify an unrelated user.
         */
        const recipientId = await this.resolveReplyRecipient(
          objectId,
          parentComment.createdBy,
          replyToUserId
        );
        if (!recipientId) return;

        // Resolved separately from the recipient: the containing post is what the
        // notification navigates to, and replies nest one level so the parent
        // always points at it.
        const postId = parentComment.objectType === COMMENT_OBJECT_TYPES.POST
          ? parentComment.objectId
          : null;

        await this.notifyMentions(event.data, actorId, commentId, postId);

        await this.notificationService.recordAdaptive({
          recipientId,
          actorId,
          type: NOTIFICATION_TYPES.COMMENT_REPLY,
          groupKey: NOTIFICATION_GROUP_KEYS.commentReply(commentId.toString()),
          aggregateGroupKey: NOTIFICATION_GROUP_KEYS.commentReplyAggregate(objectId.toString()),
          aggregateResourceId: objectId,
          eventId: commentId,
          threshold: NOTIFICATION_POLICY.COMMENT_AGGREGATION_THRESHOLD,
          postId,
          commentId
        });
      }
    } catch (e) {
      // The comment is already stored; a notification failure must not undo it.
      this.logger.error(`Failed to handle comment notification: ${e.message}`, e.stack);
    }
  }

  /**
   * Notify everyone deliberately named in a comment.
   *
   * The ids come off the stored comment, where they were already reduced to
   * accounts that exist, so the text is never re-parsed here. Mentions stay
   * individual rather than aggregating: being named is a direct, high-value
   * interaction, unlike the ambient volume of likes and replies.
   *
   * `createOnce` makes each mention idempotent — a redelivered comment event
   * cannot re-notify or resurface a mention the recipient has already read.
   */
  private async notifyMentions(
    comment: Record<string, any>,
    actorId: any,
    commentId: any,
    postId: any
  ): Promise<void> {
    // Naming someone repeatedly in one comment is still one mention of them.
    const mentionedIds = [...new Set(
      (comment.mentionedUserIds || [])
        .filter(Boolean)
        .map((id: any) => id.toString())
    )] as string[];
    if (!mentionedIds.length) return;

    const groupKey = NOTIFICATION_GROUP_KEYS.commentMention(commentId.toString());

    await mentionedIds.reduce(async (previous, recipientId) => {
      await previous;
      // Mentioning yourself notifies nobody; the service owns that rule.
      await this.notificationService.createOnce({
        recipientId,
        actorId,
        type: NOTIFICATION_TYPES.COMMENT_MENTION,
        groupKey,
        postId,
        commentId
      });
    }, Promise.resolve());
  }

  /**
   * Decide who a reply notifies, without trusting the client.
   *
   * The request names the user being answered but not the reply itself, so the
   * exact target cannot be re-derived from stored data. What can be checked is
   * membership: the claimed user must already be part of this thread, either as
   * its author or as someone who has replied in it. A claim that fails that
   * check is discarded rather than honoured.
   *
   * The author comparison is done in memory first so an ordinary direct reply —
   * the common case — costs no extra query.
   *
   * @param rootCommentId - The thread's top-level comment
   * @param threadAuthorId - Author of that top-level comment, and the fallback
   * @param replyToUserId - Client-supplied claim about who is being answered
   */
  private async resolveReplyRecipient(
    rootCommentId: string,
    threadAuthorId: any,
    replyToUserId?: string
  ): Promise<any> {
    if (!replyToUserId) return threadAuthorId;

    const claimed = replyToUserId.toString();
    if (claimed === threadAuthorId?.toString()) return threadAuthorId;

    const isParticipant = await this.commentService.hasReplyFromUser(rootCommentId, claimed);
    if (isParticipant) return replyToUserId;

    this.logger.warn(
      `Ignoring reply target ${claimed}: not a participant of thread ${rootCommentId}`
    );
    return threadAuthorId;
  }
}
