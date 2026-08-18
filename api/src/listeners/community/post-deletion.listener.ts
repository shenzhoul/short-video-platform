import { Injectable } from '@nestjs/common';
import { POST_CHANNELS } from 'src/common/constants/content';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { PostDeletionCleanupService } from 'src/services/content';

const COMMUNITY_POST_DELETION_TOPIC = 'COMMUNITY_POST_DELETION_TOPIC';

@Injectable()
export class PostDeletionListener {
  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly postDeletionCleanupService: PostDeletionCleanupService
  ) {
    this.queueMessageService.subscribe(
      POST_CHANNELS.CREATOR_POST,
      COMMUNITY_POST_DELETION_TOPIC,
      this.handlePostDeletion.bind(this)
    );
  }

  /**
   * Validate the shared post event and delegate business work to the cleanup
   * service. Errors deliberately escape so BullMQ applies retry/backoff.
   */
  public async handlePostDeletion({ data: event }: QueueEvent<Record<string, any>>) {
    if (event.eventName !== EVENT.DELETED) {
      return;
    }

    const post = event.data;
    if (!post || !post._id) {
      return;
    }

    await this.postDeletionCleanupService.cleanup(post);
  }
}
