import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ObjectId } from 'mongodb';
import { Model } from "mongoose";
import {
  Post, PostDocument, TagSummary, TagSummaryDocument
} from "src/schemas";

/**
 * Tag Statistics Service
 *
 * Maintains exact hashtag summaries derived from posts that currently exist.
 *
 * Create, update, and deletion flows all call the same reconciliation entry
 * point. This prevents duplicate queue events or repeated edits from drifting
 * counters away from their authoritative post data.
 */
@Injectable()
export class TagStatisticsService {
  constructor(
    @InjectModel(TagSummary.name)
    private readonly TagSummaryModel: Model<TagSummaryDocument>,
    @InjectModel(Post.name)
    private readonly PostModel: Model<PostDocument>,
  ) { }
  /**
   * Rebuild summaries for a normalized, unique set of affected tags.
   *
   * This is intentionally an exact reconciliation rather than a decrement so
   * duplicate queue delivery and partial retries cannot corrupt counters.
   *
   * @param tags Hashtags without the leading hash character.
   */
  /** Whether a summary exists for this tag, i.e. at least one live post uses it. */
  public async tagExists(tag: string): Promise<boolean> {
    const normalized = tag?.toLowerCase().trim();
    if (!normalized) return false;
    return Boolean(await this.TagSummaryModel.exists({ tag: normalized }));
  }

  public async reconcileTagStatistics(tags: string[]): Promise<void> {
    // Normalize at the service boundary so callers can safely pass mixed case,
    // whitespace, or duplicate tags without producing duplicate database work.
    const normalizedTags = [...new Set(
      tags
        .map(tag => tag?.toLowerCase().trim())
        .filter(Boolean)
    )];

    await Promise.all(normalizedTags.map(tag => this.reconcileTagStatistic(tag)));
  }

  /**
   * Replace one tag summary with an aggregate of indexed Post.tags values.
   *
   * If the final post using a tag was deleted, its now-empty summary is removed.
   */
  private async reconcileTagStatistic(tag: string): Promise<void> {
    // Query only the indexed tag value and aggregate all cached fields in MongoDB
    // to avoid loading matching posts into application memory.
    const [statistics] = await this.PostModel.aggregate<{
      totalUsage: number;
      totalLikes: number;
      uniqueUsers: ObjectId[];
      firstUsageDate: Date;
      lastUsageDate: Date;
    }>([
      { $match: { tags: tag } },
      {
        $group: {
          _id: null,
          totalUsage: { $sum: 1 },
          totalLikes: { $sum: { $ifNull: ['$totalLike', 0] } },
          uniqueUsers: { $addToSet: '$userId' },
          firstUsageDate: { $min: '$createdAt' },
          lastUsageDate: { $max: '$createdAt' }
        }
      }
    ]);

    // No surviving post owns this tag, so keeping a zero summary would expose a
    // stale tag in discovery and trending queries.
    if (!statistics) {
      await this.TagSummaryModel.deleteOne({ tag });
      return;
    }

    const uniqueUsers = statistics.uniqueUsers.length;
    // Upsert supports newly introduced tags; $set replaces prior drifted totals
    // and $setOnInsert initializes ranking metadata only on first creation.
    await this.TagSummaryModel.updateOne(
      { tag },
      {
        $set: {
          postStats: {
            totalUsage: statistics.totalUsage,
            uniqueUsers,
            totalViews: 0,
            totalLikes: statistics.totalLikes
          },
          grandTotalUsage: statistics.totalUsage,
          grandTotalUniqueUsers: uniqueUsers,
          grandTotalViews: 0,
          grandTotalLikes: statistics.totalLikes,
          firstUsageDate: statistics.firstUsageDate,
          lastUsageDate: statistics.lastUsageDate,
          updatedAt: new Date()
        },
        $setOnInsert: {
          tag,
          createdAt: new Date(),
          trendingScore: 0,
          popularityRank: 0
        }
      },
      { upsert: true }
    );
  }

}
