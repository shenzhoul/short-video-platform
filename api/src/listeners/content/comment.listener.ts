import { Injectable, Logger } from '@nestjs/common';
import { COMMENT_CHANNELS, COMMENT_OBJECT_TYPES } from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { CommentService } from 'src/services';
import { PostService } from 'src/services/content/post/post.service';

const COMMENT_CONTENT_TOPIC = 'COMMENT_CONTENT_TOPIC';

@Injectable()
export class CommentContentListener {
  private readonly logger = new Logger(CommentContentListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly postService: PostService,
    private readonly commentService: CommentService
  ) {
    this.queueMessageService.subscribe(
      COMMENT_CHANNELS.COMMENT,
      COMMENT_CONTENT_TOPIC,
      this.handleComment.bind(this)
    );
  }

  public async handleComment({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      if (![EVENT.CREATED, EVENT.DELETED].includes(event.eventName)) {
        return;
      }
      const { objectId, objectType, totalReply } = event.data;

      // Handle post comments
      if (objectType === COMMENT_OBJECT_TYPES.POST) {
        let increment = event.eventName === EVENT.CREATED ? 1 : -1;

        // Deleting a top-level comment also removes its replies, which are
        // counted in this same total.
        //
        // `totalReply` is absent on a comment that never had a reply, and
        // `-(1 + undefined)` is NaN. That NaN reached the `$add` in the update
        // pipeline and `$max: [0, NaN]` resolved to 0, so a single deletion
        // silently zeroed the post's whole comment count — the list stayed full
        // while the counter read 0.
        if (event.eventName === EVENT.DELETED) {
          increment = -(1 + (totalReply || 0));
        }

        await this.postService.updateCommentCount(objectId, increment);
        return;
      }

      // Handle update parent comment comment count
      if (objectType === COMMENT_OBJECT_TYPES.COMMENT) {
        const increment = event.eventName === EVENT.CREATED ? 1 : -1;
        const parentComment = await this.commentService.findById(objectId);

        if (parentComment?.objectType === COMMENT_OBJECT_TYPES.POST) {
          await this.postService.updateCommentCount(parentComment.objectId.toString(), increment);
        }
      }
    } catch (e) {
      this.logger.error(e.stack || e, { context: 'comment_content_listener' });
    }
  }
}
