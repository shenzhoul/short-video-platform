import { Injectable, Logger } from '@nestjs/common';
import {
  RELATIONSHIP_CHANNELS,
  RELATIONSHIP_EVENTS
} from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { MessageSystemNoticeService } from 'src/services/community/message';

const RELATIONSHIP_CLEARED_TOPIC = 'MESSAGE_RELATIONSHIP_CLEARED_TOPIC';

/**
 * Makes the announcement that was correctly refused while a flag was up.
 *
 * A pair who became mutual followers during a block or a restriction got no
 * notice, because at that moment they could not in fact chat. Lifting the flag
 * makes it true, so the announcement is attempted again.
 *
 * Nothing here decides whether to announce: `announceMutualFollow` re-reads the
 * follow rows, re-checks permission in both directions, and is keyed on those
 * follow records. So this listener is safe to fire on every cleared flag —
 * a pair who are no longer mutual get nothing, and a pair who already have a
 * notice for this mutual-follow epoch get nothing either, because the key
 * collides with the one already stored.
 */
@Injectable()
export class MessageRelationshipClearedListener {
  private readonly logger = new Logger(MessageRelationshipClearedListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly systemNoticeService: MessageSystemNoticeService
  ) {
    this.queueMessageService.subscribe(
      RELATIONSHIP_CHANNELS.RELATIONSHIP,
      RELATIONSHIP_CLEARED_TOPIC,
      this.handleEvent.bind(this)
    );
  }

  public async handleEvent({ data: event }: QueueEvent<Record<string, any>>): Promise<void> {
    try {
      if (event?.eventName !== RELATIONSHIP_EVENTS.CLEARED) return;

      const { userId, targetId } = event.data || {};
      if (!userId || !targetId) return;

      await this.systemNoticeService.announceMutualFollow(userId, targetId);
    } catch (error) {
      this.logger.error(
        `Failed to re-announce a mutual follow after a flag was cleared: ${error.message}`,
        error.stack
      );
    }
  }
}
