import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { REACTION_CHANNELS, REACTION_TARGET_TYPES, REACTION_TYPES } from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { Comment, CommentDocument } from 'src/schemas/community/comment';

const REACTION_COMMENT_TOPIC = 'REACTION_COMMENT_TOPIC';

@Injectable()
export class ReactionCommentListener {
  private logger = new Logger(ReactionCommentListener.name);

  constructor(
    @InjectModel(Comment.name) private readonly CommentModel: Model<CommentDocument>,
    private readonly queueMessageService: QueueMessageService
  ) {
    this.queueMessageService.subscribe(
      REACTION_CHANNELS.REACTION,
      REACTION_COMMENT_TOPIC,
      this.handleReactComment.bind(this)
    );
  }

  public async handleReactComment({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      if (![EVENT.CREATED, EVENT.DELETED].includes(event.eventName)) return;
      const { objectId, objectType, action } = event.data;
      if (![REACTION_TARGET_TYPES.COMMENT].includes(objectType) || action !== REACTION_TYPES.LIKE) return;

      const comment = await this.CommentModel.findById(objectId);
      if (!comment) return;
      switch (event.eventName) {
        case EVENT.CREATED:
          await this.CommentModel.updateOne({ _id: objectId }, { $inc: { totalLike: 1 } });
          break;
        case EVENT.DELETED:
          await this.CommentModel.updateOne({ _id: objectId }, { $inc: { totalLike: -1 } });
          break;
        default: break;
      }
    } catch (e) {
      this.logger.error(`Failed to handle react comment: ${e.message}`, e.stack);
    }
  }
}
