import { Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_GROUP_KEYS, NOTIFICATION_TYPES } from 'src/common/constants/community';
import { POST_CHANNELS } from 'src/common/constants/content';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { NotificationService } from 'src/services/community/notification';

const NOTIFICATION_POST_MENTION_TOPIC = 'NOTIFICATION_POST_MENTION_TOPIC';

/**
 * Notifies the users a creator named in a new post.
 *
 * The ids come straight off the published post, where they were already reduced
 * to accounts that exist — the caption is never re-parsed here, so what is
 * notified always matches what was stored.
 *
 * Only `EVENT.CREATED` is handled. A post becomes visible the moment it is
 * created (drafts live in the browser, never as documents), so this fires
 * exactly once at publication. Editing a post deliberately notifies nobody:
 * mentions already delivered must not be resurfaced by an unrelated edit.
 */
@Injectable()
export class NotificationPostMentionListener {
  private logger = new Logger(NotificationPostMentionListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly notificationService: NotificationService
  ) {
    this.queueMessageService.subscribe(
      POST_CHANNELS.CREATOR_POST,
      NOTIFICATION_POST_MENTION_TOPIC,
      this.handlePost.bind(this)
    );
  }

  public async handlePost({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      if (event.eventName !== EVENT.CREATED) return;

      const post = event.data;
      const actorId = post?.userId;
      const postId = post?._id;
      if (!actorId || !postId) return;

      // Naming someone twice in one caption is still one mention of them.
      const mentionedIds = [...new Set(
        (post.mentionedUserIds || [])
          .filter(Boolean)
          .map((id: any) => id.toString())
      )] as string[];
      if (!mentionedIds.length) return;

      const groupKey = NOTIFICATION_GROUP_KEYS.postMention(postId.toString());

      // Sequential rather than parallel: a mention fan-out is small and this
      // keeps one failure from cancelling the rest.
      await mentionedIds.reduce(async (previous, recipientId) => {
        await previous;
        // Mentioning yourself notifies nobody; the service enforces that, so no
        // check is duplicated here.
        await this.notificationService.createOnce({
          recipientId,
          actorId,
          type: NOTIFICATION_TYPES.POST_MENTION,
          groupKey,
          postId
        });
      }, Promise.resolve());
    } catch (e) {
      // The post is already published; failing to notify must not undo it.
      this.logger.error(`Failed to handle post mention notification: ${e.message}`, e.stack);
    }
  }
}
