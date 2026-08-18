import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CREATOR_CHANNELS, USER_STATUS } from 'src/common/constants/identity';
import { UserDto } from 'src/dtos/identity/user';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT, STATUS } from 'src/kernel/constants';
import { Post, PostDocument } from 'src/schemas/content';

/**
 * CreatorDeletePostListener
 *
 * Listens for creator account deletion events and marks all of the creator's
 * posts as inactive so they are excluded from public-facing search queries
 * without needing in-memory filtering after DB retrieval.
 *
 * Trigger:
 *   CREATOR_CHANNELS.CREATOR + EVENT.DELETED
 */
@Injectable()
export class CreatorDeletePostListener {
  private readonly logger = new Logger(CreatorDeletePostListener.name);

  constructor(
    @InjectModel(Post.name) private readonly PostModel: Model<PostDocument>,
    private readonly queueMessageService: QueueMessageService
  ) {
    this.queueMessageService.subscribe(
      CREATOR_CHANNELS.CREATOR,
      'DELETE_CREATOR_POST_TOPIC',
      this.handleDeleteData.bind(this)
    );
    this.queueMessageService.subscribe(
      CREATOR_CHANNELS.CREATOR,
      'CREATOR_INACTIVE_POST_TOPIC',
      this.handleInactiveData.bind(this)
    );
  }

  private async handleDeleteData({ data: event }: QueueEvent<Record<string, any>>): Promise<void> {
    try {
      if (event.eventName !== EVENT.DELETED) return;

      const creator: UserDto = event.data;

      // Mark ALL of the creator's posts as inactive (regardless of current status)
      // and deactivate them so they are hidden from public-facing queries.
      await this.PostModel.updateMany(
        { userId: creator._id },
        { status: STATUS.INACTIVE, isCreatorDeleted: true }
      );
    } catch (e) {
      this.logger.error(e.stack || e, { context: 'CreatorDeletePostListener' });
    }
  }

  private async handleInactiveData({ data: event }: QueueEvent<Record<string, any>>): Promise<void> {
    try {
      if (event.eventName !== EVENT.UPDATED) return;

      const creator: UserDto = event.data;
      // if creator is inactive, mark all of their posts as inactive
      //
      if (creator.status === USER_STATUS.INACTIVE) {
        await this.PostModel.updateMany(
          { userId: creator._id },
          { status: STATUS.INACTIVE }
        );
      }
      // if creator is active, mark all of their posts as active
      // this action might be needed if the creator is reactivated after being inactive
      // but some posts which were inactive might become activate even creator doesn't want to reactivate them
      if (creator.status === USER_STATUS.ACTIVE) {
        await this.PostModel.updateMany(
          { userId: creator._id },
          { status: STATUS.ACTIVE }
        );
      }
    } catch (e) {
      this.logger.error(e.stack || e, { context: 'CreatorInactivePostListener' });
    }
  }
}
