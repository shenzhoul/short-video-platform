import { Injectable, Logger } from '@nestjs/common';
import {
  REACTION_CHANNELS,
  REACTION_TARGET_TYPES,
  REACTION_TYPES
} from 'src/common/constants/community';
import { EVENT } from 'src/kernel/constants';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { FollowService } from 'src/services/community/follow';
import { MessageSystemNoticeService } from 'src/services/community/message';

const MUTUAL_FOLLOW_NOTICE_TOPIC = 'MUTUAL_FOLLOW_NOTICE_TOPIC';

/**
 * Puts a notice in the conversation when two people start following each other.
 *
 * Event-driven rather than a call inside `FollowService`: the message domain
 * already depends on the follow domain, so calling the other way would close a
 * cycle. It also means the follow request returns without waiting for a
 * conversation to be found or created.
 *
 * The transition is what matters, not the follow. `FollowService` publishes
 * `created` only for a genuinely new relation — a repeated follow, a
 * double-clicked button and a request that lost the unique-index race all
 * publish nothing — so this fires once per new edge. The second edge of a pair
 * is the one that completes the mutual follow, and that is where the notice
 * belongs.
 *
 * Anything that slips past that (two follows landing together, each seeing the
 * other's row) is caught by the unique key on the notice itself.
 */
@Injectable()
export class MessageMutualFollowListener {
  private readonly logger = new Logger(MessageMutualFollowListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly followService: FollowService,
    private readonly systemNoticeService: MessageSystemNoticeService
  ) {
    this.queueMessageService.subscribe(
      REACTION_CHANNELS.REACTION,
      MUTUAL_FOLLOW_NOTICE_TOPIC,
      this.handleEvent.bind(this)
    );
  }

  public async handleEvent({ data: event }: QueueEvent<Record<string, any>>): Promise<void> {
    try {
      if (event?.eventName !== EVENT.CREATED) return;

      const { objectType, action, objectId, createdBy } = event.data || {};
      // The reaction channel carries likes and comments too; this only cares
      // about one creator following another.
      if (objectType !== REACTION_TARGET_TYPES.CREATOR) return;
      if (action !== REACTION_TYPES.FOLLOW) return;
      if (!objectId || !createdBy) return;

      // Read live rather than inferring from the event: between the follow and
      // this job the other person may have unfollowed, and a notice for a pair
      // who are no longer mutual would be wrong.
      const isMutual = await this.followService.areMutuallyFollowing(createdBy, objectId);
      if (!isMutual) return;

      await this.systemNoticeService.announceMutualFollow(createdBy, objectId);
    } catch (error) {
      this.logger.error(
        `Failed to announce a mutual follow: ${error.message}`,
        error.stack
      );
    }
  }
}
