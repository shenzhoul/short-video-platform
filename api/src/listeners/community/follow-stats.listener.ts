import { Injectable, Logger } from '@nestjs/common';
import {
  REACTION_CHANNELS,
  REACTION_TARGET_TYPES,
  REACTION_TYPES
} from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { FollowStatsCoalescerService } from 'src/services/socket/follow-stats-coalescer.service';

const FOLLOW_STATS_TOPIC = 'FOLLOW_STATS_TOPIC';

/**
 * Keeps both sides of a follow told about their own counters.
 *
 * Follows are stored as reactions, so this listens on the reaction channel and
 * filters to creator follows. Its own topic, so follow-count delivery cannot
 * interfere with the notification and messaging listeners already subscribed to
 * that channel — those have different audiences and must fail independently.
 *
 * `FollowService` publishes only for a genuinely created or deleted relation, so
 * a repeated follow, a lost unique-index race, or an unfollow of somebody who
 * was never followed produce nothing here. That is what stops a double-clicked
 * button emitting two snapshots.
 *
 * Both participants are marked, because one relation moves two numbers:
 *
 * - the follower's `followingCount`
 * - the creator's `followersCount`
 *
 * Removing a follower is the same relation seen from the other side — the
 * controller routes it through `unfollow` — so it needs no separate branch here.
 *
 * Block and restrict are deliberately absent: they store a flag and leave follow
 * rows alone, so neither changes a count and neither should emit.
 */
@Injectable()
export class FollowStatsListener {
  private readonly logger = new Logger(FollowStatsListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly followStatsCoalescerService: FollowStatsCoalescerService
  ) {
    this.queueMessageService.subscribe(
      REACTION_CHANNELS.REACTION,
      FOLLOW_STATS_TOPIC,
      this.handleFollowChange.bind(this)
    );
  }

  public async handleFollowChange({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      if (![EVENT.CREATED, EVENT.DELETED].includes(event.eventName)) return;

      const { objectType, action, objectId, createdBy } = event.data || {};
      if (objectType !== REACTION_TARGET_TYPES.CREATOR) return;
      if (action !== REACTION_TYPES.FOLLOW) return;
      if (!objectId || !createdBy) return;

      // Never an emit — only a mark. The flush turns any number of follows in
      // the same window into one snapshot per person.
      await Promise.all([
        this.followStatsCoalescerService.markDirty(createdBy),
        this.followStatsCoalescerService.markDirty(objectId)
      ]);
    } catch (e) {
      // The relation is already stored; live delivery must not undo it.
      this.logger.error(`Failed to handle follow stats event: ${e.message}`, e.stack);
    }
  }
}
