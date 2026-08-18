import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { POST_CHANNELS } from 'src/common/constants/content';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { User, UserDocument } from 'src/schemas';
import { PostService } from 'src/services/content/post/post.service';

const CREATOR_COUNT_POST_TOPIC = 'CREATOR_COUNT_POST_TOPIC';

@Injectable()
export class CreatorAssetsListener {
  private readonly logger = new Logger(CreatorAssetsListener.name);

  constructor(
    @InjectModel(User.name) private readonly CreatorModel: Model<UserDocument>,
    private readonly queueMessageService: QueueMessageService,
    private readonly postService: PostService
  ) {
    this.queueMessageService.subscribe(
      POST_CHANNELS.CREATOR_POST,
      CREATOR_COUNT_POST_TOPIC,
      this.handlePostCount.bind(this)
    );
  }

  public async handlePostCount({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      const { eventName } = event;
      if (![EVENT.CREATED, EVENT.DELETED, EVENT.UPDATED].includes(eventName)) {
        return;
      }
      const {
        userId
      } = event.data;
      const id = userId;
      const count = await this.postService.countPostsByCreator(id, {
        status: 'active'
      });
      await this.CreatorModel.updateOne(
        { _id: userId },
        {
          $set: {
            'stats.totalPosts': count
          }
        }
      );
    } catch (e) {
      this.logger.error(e.stack || e, { context: 'CreatorAssetsListener' });
    }
  }
}
