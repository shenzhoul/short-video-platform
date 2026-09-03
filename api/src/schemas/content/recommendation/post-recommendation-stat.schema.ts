import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * Per-post recommendation aggregate — one document per post.
 *
 * Updated with small, atomic `$inc`s from `RecommendationEventService`, the
 * same class of write as `Post.totalLike` elsewhere in this codebase. That is
 * deliberate: an O(1) counter bump is not the "heavy statistics on the read
 * path" that `.agents/rules/shared.md` warns against — it is the same shape of
 * write the app already does inline for likes/shares/views. What *is* heavy
 * (recomputing category priors, decaying old signal) runs asynchronously on a
 * schedule via `RecommendationCategoryPriorJob`, mirroring `TagTrendingJob`.
 *
 * `topicKey` is denormalized from the post at write time so the category-prior
 * recompute job can group by it directly, without joining back to `posts` for
 * every one of potentially millions of stat rows.
 */
@Schema({
  collection: 'post_recommendation_stats',
  timestamps: { createdAt: false, updatedAt: 'updatedAt' }
})
export class PostRecommendationStat {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  postId: ObjectId;

  /** Denormalized creator id, for creator-level exploration-share checks without a Post join. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  creatorId: ObjectId;

  /** Denormalized category key at time of last write; may be null for uncategorized posts. */
  @Prop({
    type: String,
    default: null
  })
  topicKey: string | null;

  /** Total counted impressions (post visible >=50% viewport for >=1s). */
  @Prop({ type: Number, default: 0, min: 0 })
  impressions: number;

  /** Sum of watch ratios (watchedMs / durationMs, clamped to [0,1]) across video views, for averaging. */
  @Prop({ type: Number, default: 0, min: 0 })
  watchRatioSum: number;

  /** Count of video watch samples contributing to `watchRatioSum`. */
  @Prop({ type: Number, default: 0, min: 0 })
  watchSampleCount: number;

  /** Unique-per-exposure completions (watch ratio >= completion threshold). */
  @Prop({ type: Number, default: 0, min: 0 })
  completions: number;

  /** Replays are counted separately from completions — see rules/api.md watch-quality note. */
  @Prop({ type: Number, default: 0, min: 0 })
  replays: number;

  /** Quick skips (video: low ratio + low ms; photo: low dwell). */
  @Prop({ type: Number, default: 0, min: 0 })
  quickSkips: number;

  /** Sum of photo dwell milliseconds, for averaging. */
  @Prop({ type: Number, default: 0, min: 0 })
  dwellMsSum: number;

  /** Count of photo dwell samples. */
  @Prop({ type: Number, default: 0, min: 0 })
  dwellSampleCount: number;

  /** Post Detail opens attributed to a recommendation exposure. */
  @Prop({ type: Number, default: 0, min: 0 })
  detailOpens: number;

  /**
   * Weighted engagement attributable to recommendation-tracked interactions
   * (likes + comments*3 + shares*5 + followsAfterView*6). Kept here rather than
   * re-derived from `Post` counters at score time because it must reflect only
   * events observed through the tracked funnel, matching `impressions`.
   */
  @Prop({ type: Number, default: 0, min: 0 })
  weightedEngagement: number;

  @Prop({ type: Date, default: null })
  lastImpressionAt: Date | null;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export type PostRecommendationStatDocument = HydratedDocument<PostRecommendationStat>;
export const PostRecommendationStatSchema = SchemaFactory.createForClass(PostRecommendationStat);

/** One stat row per post; also the lookup path for every event ingestion write. */
PostRecommendationStatSchema.index({ postId: 1 }, { unique: true, name: 'uq_post_recommendation_stat_post' });
/** Category-prior recompute job groups by category and reads impressions/engagement. */
PostRecommendationStatSchema.index({ topicKey: 1, impressions: 1 }, { name: 'idx_post_recommendation_stat_topic' });
/** Exploration-stage / creator-spam-guard reads by creator. */
PostRecommendationStatSchema.index({ creatorId: 1, impressions: 1 }, { name: 'idx_post_recommendation_stat_creator' });
