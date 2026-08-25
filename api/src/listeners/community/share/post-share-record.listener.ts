import { Injectable, Logger } from '@nestjs/common';
import {
  REACTION_TARGET_TYPES,
  SHARE_CHANNELS,
  SHARE_EVENTS
} from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { CommunicationService } from 'src/services/community/communication.service';
import { BaseUserService } from 'src/services/identity/user/base-user.service';

const SHARE_RECORD_TOPIC = 'SHARE_RECORD_TOPIC';

/**
 * Finishes a share whose counter update failed at the time.
 *
 * The message already exists — it was written before this event was published —
 * so what is outstanding is only the distinct-sharer row that `totalShare` is
 * derived from. Leaving that to a logged warning meant a transient blip in the
 * reaction store silently under-counted a share forever.
 *
 * Safe to run any number of times: `recordShare` writes through the unique
 * reaction index, so a retry that races the original produces one row, not two,
 * and the counter cannot move twice.
 *
 * Bounded, not infinite: the queue retries three times with exponential backoff
 * and then gives up. `api/scripts/reconcile-post-share-counts.js` is the backstop
 * for anything that falls through, and it recomputes from the rows rather than
 * adjusting the counter blindly.
 */
@Injectable()
export class PostShareRecordListener {
  private readonly logger = new Logger(PostShareRecordListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly communicationService: CommunicationService,
    private readonly baseUserService: BaseUserService
  ) {
    this.queueMessageService.subscribe(
      SHARE_CHANNELS.SHARE,
      SHARE_RECORD_TOPIC,
      this.handleEvent.bind(this)
    );
  }

  public async handleEvent({ data: event }: QueueEvent<Record<string, any>>): Promise<void> {
    if (event?.eventName !== SHARE_EVENTS.RECORD_REQUESTED) return;

    const { postId, sharerId } = event.data || {};
    if (!postId || !sharerId) return;

    // The sharer is re-read rather than carried on the event: `recordShare`
    // needs a user, and a serialised copy from minutes ago could describe an
    // account that has since been removed.
    const sharer = await this.baseUserService.findById(sharerId);
    if (!sharer) {
      this.logger.warn(`Dropping share record for a user that no longer exists: ${sharerId}`);
      return;
    }

    // Deliberately not caught. A throw is what tells the queue to retry, and
    // swallowing it here would turn a durable outbox back into a log line.
    await this.communicationService.recordShare(REACTION_TARGET_TYPES.POST, postId, sharer);
    this.logger.log(`Recovered the share record for post ${postId} by ${sharerId}`);
  }
}
