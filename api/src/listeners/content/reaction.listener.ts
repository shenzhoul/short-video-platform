import { Injectable } from '@nestjs/common';
import { REACTION_CHANNELS, REACTION_TARGET_TYPES, REACTION_TYPES } from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { UserAccountManagementService } from 'src/services/identity/user/user.service';
import { PostCrudService } from 'src/services/content/post/post-crud.service';
import { PostStatisticsService } from 'src/services/content/post/post-statistics.service';

/** Queue topic for reaction-related asset updates */
const REACTION_ASSETS_TOPIC = 'REACTION_ASSETS_TOPIC';

/**
 * Reaction Assets Listener
 *
 * Event listener service that handles reaction events and updates related statistics.
 * This service maintains data consistency by updating counters and metrics when users
 * react to content (like, dislike, etc.).
 *
 * Key Responsibilities:
 * - Listen to reaction creation and deletion events
 * - Update product like/reaction statistics
 * - Update creator statistics based on reactions to their content
 * - Maintain data consistency across reaction-related entities
 *
 * Event Processing:
 * - Processes CREATED events to increment statistics
 * - Processes DELETED events to decrement statistics
 * - Updates both content-level and creator-level metrics
 *
 * Supported Reaction Types:
 * - LIKE: Positive reaction to content
 * - Additional reaction types can be added in the switch statement
 *
 * @example Reaction event flow
 * ```
 * 1. User likes a product
 * 2. Reaction service publishes CREATED event
 * 3. This listener receives the event
 * 4. Product like count is incremented
 * 5. Creator's total likes are incremented
 * ```
 *
 * Business Impact:
 * - Provides real-time statistics for content popularity
 * - Enables creator analytics and performance tracking
 * - Supports recommendation algorithms based on engagement
 * - Maintains accurate metrics for business intelligence
 */
@Injectable()
export class ReactionAssetsListener {
  constructor(
    private readonly userService: UserAccountManagementService,
    private readonly queueMessageService: QueueMessageService,
    private readonly postService: PostCrudService,
    private readonly postStatisticsService: PostStatisticsService
  ) {
    // Subscribe to reaction events on service initialization
    this.queueMessageService.subscribe(
      REACTION_CHANNELS.REACTION,
      REACTION_ASSETS_TOPIC,
      this.handleReaction.bind(this)
    );
  }

  /**
   * Handle reaction events and update related statistics
   * Processes both creation and deletion of reactions to maintain accurate counts
   * @param event - Queue event containing reaction data
   * TODO: Add support for additional reaction types (dislike, love, etc.)
   * TODO: Consider batch processing for high-volume reaction events
   * TODO: Add error handling and retry logic for failed statistic updates
   */
  public async handleReaction({ data: event }: QueueEvent<Record<string, any>>) {
    // Only process creation and deletion events
    if (![EVENT.CREATED, EVENT.DELETED].includes(event.eventName)) {
      return;
    }

    const {
      objectId, objectType, action
    } = event.data;

    // Posts carry more than one reaction action, so every branch below must
    // filter on the action as well as the target. Treating "a post reaction" as
    // "a like" would make shares move the like counters.
    if (objectType !== REACTION_TARGET_TYPES.POST) return;

    if (action === REACTION_TYPES.SHARE) {
      // Share reactions are created once per user and never removed, so only
      // creation is meaningful and the counter only ever grows.
      if (event.eventName !== EVENT.CREATED) return;
      await this.postStatisticsService.handleShareStat(objectId, 1);
      return;
    }

    if (action !== REACTION_TYPES.LIKE) return;

    // Determine increment/decrement based on event type
    const num = event.eventName === EVENT.CREATED ? 1 : -1;

    const post = await this.postService.findById(objectId);

    // Update both post and creator statistics in parallel
    await Promise.all([
      this.postStatisticsService.handleLikeStat(objectId, num),
      post && this.userService.updateLikeStat(post.userId, num)
    ]);
  }
}
