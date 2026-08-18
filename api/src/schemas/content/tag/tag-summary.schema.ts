import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Tag Summary Schema - Aggregate statistics per tag
 *
 * This schema maintains real-time aggregate statistics for each tag's usage,
 * organized by content type. It provides quick access to summary data
 * without requiring complex aggregation queries on the main content collections.
 */
@Schema({
  collection: 'tag_summaries',
  timestamps: true
})
export class TagSummary {
  // === TAG REFERENCE ===

  /**
   * The tag name (normalized, lowercase)
   * Has unique index for fast lookup
   */
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  })
  tag: string;

  // === AGGREGATE STATISTICS BY CONTENT TYPE ===

  /**
   * Post content usage breakdown
   */
  @Prop({
    type: {
      totalUsage: { type: Number, default: 0 },
      uniqueUsers: { type: Number, default: 0 },
      totalViews: { type: Number, default: 0 },
      totalLikes: { type: Number, default: 0 }
    },
    default: () => ({
      totalUsage: 0,
      uniqueUsers: 0,
      totalViews: 0,
      totalLikes: 0
    })
  })
  postStats: {
    totalUsage: number;
    uniqueUsers: number;
    totalViews: number;
    totalLikes: number;
  };

  // === GRAND TOTALS ===

  /**
   * Total usage across all content types
   * Sum of all totalUsage fields from individual stats
   */
  @Prop({
    default: 0
  })
  grandTotalUsage: number;

  /**
   * Total unique users across all content types
   * Count of unique users who have used this tag
   */
  @Prop({
    default: 0
  })
  grandTotalUniqueUsers: number;

  /**
   * Total views across all content types
   * Sum of all totalViews fields from individual stats
   */
  @Prop({
    default: 0
  })
  grandTotalViews: number;

  /**
   * Total likes across all content types
   * Sum of all totalLikes fields from individual stats
   */
  @Prop({
    default: 0
  })
  grandTotalLikes: number;

  // === POPULARITY METRICS ===

  /**
   * Trending score based on recent usage
   * Calculated based on usage velocity and engagement
   */
  @Prop({
    default: 0
  })
  trendingScore: number;

  /**
   * Popularity rank among all tags
   * Lower number = higher popularity
   */
  @Prop({
    default: 0
  })
  popularityRank: number;

  // === TIMESTAMPS ===

  /**
   * First usage date for this tag
   * Tracks when tag was first used
   */
  @Prop({
    type: Date
  })
  firstUsageDate: Date;

  /**
   * Last usage date for this tag
   * Tracks most recent usage activity
   */
  @Prop({
    type: Date
  })
  lastUsageDate: Date;

  /**
   * Creation timestamp
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  createdAt: Date;

  /**
   * Last update timestamp
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  updatedAt: Date;
}

export type TagSummaryDocument = HydratedDocument<TagSummary>;

export const TagSummarySchema = SchemaFactory.createForClass(TagSummary);

// === OPTIMIZED INDEXES FOR PERFORMANCE ===

/**
 * Primary index for tag lookup
 * Supports queries: "Get summary for specific tag"
 */
TagSummarySchema.index({
  tag: 1
}, { name: 'idx_tag_summary', unique: true });

/**
 * Index for popular tags queries
 * Supports queries: "Find most popular tags"
 */
TagSummarySchema.index({
  grandTotalUsage: -1,
  createdAt: -1
}, { name: 'idx_popular_tags' });

/**
 * Index for trending tags
 * Supports queries: "Find trending tags"
 */
TagSummarySchema.index({
  trendingScore: -1,
  lastUsageDate: -1
}, { name: 'idx_trending_tags' });

/**
 * Index for recent activity
 * Supports queries: "Find tags with recent usage"
 */
TagSummarySchema.index({
  lastUsageDate: -1,
  grandTotalUsage: -1
}, { name: 'idx_recent_tag_activity' });
