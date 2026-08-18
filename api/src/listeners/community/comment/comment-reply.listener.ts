import { Injectable, Logger } from '@nestjs/common';
import { COMMENT_CHANNELS, COMMENT_OBJECT_TYPES } from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { CommentService } from 'src/services/community/comment/comment.service';

const REPLY_COMMENT_CHANNEL = 'REPLY_COMMENT_CHANNEL';

@Injectable()
export class ReplyCommentListener {
  private logger = new Logger(ReplyCommentListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly commentService: CommentService
  ) {
    this.queueMessageService.subscribe(
      COMMENT_CHANNELS.COMMENT,
      REPLY_COMMENT_CHANNEL,
      this.handleReplyComment.bind(this)
    );
  }

  public async handleReplyComment({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      if (![EVENT.CREATED, EVENT.DELETED].includes(event.eventName)) return;

      const { objectId: commentId, objectType } = event.data;
      if (objectType !== COMMENT_OBJECT_TYPES.COMMENT) return;
      await this.commentService.incrementReplyCount(
        commentId,
        event.eventName === EVENT.CREATED ? 1 : -1
      );
    } catch (e) {
      this.logger.error(`Failed to handle reply comment: ${e.message}`, e.stack);
    }
  }
}
