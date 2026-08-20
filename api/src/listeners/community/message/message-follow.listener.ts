import { Injectable, Logger } from '@nestjs/common';
import {
  REACTION_CHANNELS,
  REACTION_TARGET_TYPES,
  REACTION_TYPES
} from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { ConversationService, MessagePermissionService } from 'src/services/community/message';

const MESSAGE_FOLLOW_TOPIC = 'MESSAGE_FOLLOW_TOPIC';

/**
 * Returns a conversation to an unanswered request when its pair stops following
 * each other.
 *
 * Mutual followers message freely, and a non-mutual pair whose request was
 * answered also message freely. Those are different reasons, and only the second
 * survives on its own: freedom that came from a follow must not outlive the
 * follow. So when one side unfollows, the pair's conversation is reset to
 * "nobody is waiting" and the next sender gets one request message again.
 *
 * Driven by an event rather than called from `FollowService` directly. The
 * follow domain would otherwise need a dependency on the message domain, which
 * already depends on it — a cycle the repository does not allow.
 *
 * Only the unfollowed pair's own conversation is touched; it is located by the
 * canonical `hashKey`, so an unrelated unfollow cannot disturb anyone else.
 * No message is ever deleted.
 */
@Injectable()
export class MessageFollowListener {
  private readonly logger = new Logger(MessageFollowListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly conversationService: ConversationService,
    private readonly permissionService: MessagePermissionService
  ) {
    this.queueMessageService.subscribe(
      REACTION_CHANNELS.REACTION,
      MESSAGE_FOLLOW_TOPIC,
      this.handleReaction.bind(this)
    );
  }

  public async handleReaction({ data: event }: QueueEvent<Record<string, any>>): Promise<void> {
    try {
      if (event?.eventName !== EVENT.DELETED) return;

      const { objectType, action, objectId, createdBy } = event.data || {};
      // The reaction channel carries likes and bookmarks too; only a creator
      // follow being removed can change messaging permission.
      if (objectType !== REACTION_TARGET_TYPES.CREATOR) return;
      if (action !== REACTION_TYPES.FOLLOW) return;
      if (!objectId || !createdBy) return;

      const conversation = await this.conversationService.findByPair(createdBy, objectId);
      // No conversation means nothing to reset — the pair never talked.
      if (!conversation) return;

      await this.permissionService.resetRequestState(conversation._id);
    } catch (e) {
      this.logger.error(`Failed to reset messaging state after an unfollow: ${e.message}`, e.stack);
    }
  }
}
