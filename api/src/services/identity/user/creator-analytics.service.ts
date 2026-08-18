import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ObjectId } from 'mongodb';
import { Model } from "mongoose";
import { User, UserDocument } from "src/schemas";

/**
 * Creator Analytics and Statistics Service
 *
 * Handles all analytics, statistics, and metrics tracking for creators.
 * Provides atomic operations for updating creator statistics and comprehensive
 * reporting capabilities for creator performance analysis.
 *
 * Key Features:
 * - Profile view tracking and analytics
 * - Subscription count management
 * - Like and engagement metrics
 * - Custom statistics updates with atomic operations
 * - Creator counting and filtering for reports
 * - Performance metrics for creator ranking
 *
 * Analytics Tracking:
 * - Profile views for popularity metrics
 * - Subscription counts for revenue analysis
 * - Like counts for engagement tracking
 * - Custom metrics for specialized features
 * - Status-based creator counting
 * - Query-based creator analytics
 *
 * Business Impact:
 * - Drives creator discovery algorithms
 * - Affects creator ranking and recommendations
 * - Provides insights for creator monetization
 * - Supports platform analytics and reporting
 * - Enables creator performance optimization
 *
 * @example Track profile view
 * ```typescript
 * await creatorAnalyticsService.incrementProfileViews(creatorId);
 * ```
 *
 * @example Update subscription count
 * ```typescript
 * await creatorAnalyticsService.incrementSubscriptionCount(creatorId, 1);
 * ```
 *
 * @example Get creator statistics
 * ```typescript
 * const activeCreators = await creatorAnalyticsService.countCreatorsByStatus('active');
 * ```
 *
 * @author ShenZhoul
 * @version 1.0.0
 */
@Injectable()
export class CreatorAnalyticsService {
  constructor(
    @InjectModel(User.name) private readonly CreatorModel: Model<UserDocument>,
  ) { }
  /**
   * Update creator like statistics
   *
   * Updates the total like count for a creator when users like or unlike their content.
   * Used for creator analytics, profile statistics, and content ranking algorithms.
   *
   * Statistics Tracking:
   * - Increments/decrements total like count
   * - Updates creator profile statistics
   * - Used for creator popularity ranking
   * - Affects content discovery algorithms
   * - Provides engagement metrics for creators
   *
   * @param creatorId Creator's unique identifier
   * @param num Number to add to like count (default: 1, can be negative for unlikes)
   * @returns Promise resolving to MongoDB update result
   * @example
   * ```typescript
   * // User likes creator content
   * await creatorAnalyticsService.incrementLikeCount(creatorId, 1);
   *
   * // User unlikes creator content
   * await creatorAnalyticsService.incrementLikeCount(creatorId, -1);
   * ```
   *
   * @statistics Updates creator like count for analytics and ranking
   */
  public async incrementLikeCount(creatorId: string | ObjectId | any, num = 1) {
    return this.CreatorModel.updateOne(
      { _id: creatorId },
      {
        $inc: { 'stats.totalLikes': num }
      }
    );
  }

  /**
   * Replace a creator's cached like total with an authoritative value.
   */
  public async setLikeCount(creatorId: string | ObjectId | any, total: number) {
    return this.CreatorModel.updateOne(
      { _id: creatorId },
      { $set: { 'stats.totalLikes': Math.max(0, total) } }
    );
  }
}
