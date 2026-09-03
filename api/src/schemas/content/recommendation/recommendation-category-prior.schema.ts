import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** The row holding the platform-wide fallback prior, when a category lacks its own. */
export const GLOBAL_ENGAGEMENT_PRIOR_KEY = 'global';

/**
 * Bayesian-smoothing prior for engagement-quality scoring, one row per
 * category key plus one `global` row. Recomputed on a schedule by
 * `RecommendationCategoryPriorJob` from `PostRecommendationStat` (a bounded
 * aggregate collection, not the raw event log) — mirrors `TagTrendingService`
 * / `TagTrendingJob`.
 *
 * Never written on the request path: engagement scoring reads whichever row
 * exists (falling back to `global`) and treats it as read-only.
 */
@Schema({
  collection: 'recommendation_category_priors',
  timestamps: { createdAt: false, updatedAt: 'updatedAt' }
})
export class RecommendationCategoryPrior {
  /** A category `topicKey`, or `GLOBAL_ENGAGEMENT_PRIOR_KEY`. */
  @Prop({ type: String, required: true })
  key: string;

  /** Mean weighted-engagement-per-impression observed for this cohort. */
  @Prop({ type: Number, required: true })
  priorMean: number;

  /** Prior strength in "virtual impressions" — how strongly small posts regress toward `priorMean`. */
  @Prop({ type: Number, required: true })
  priorStrength: number;

  /** How many real impressions this prior was computed from, for observability. */
  @Prop({ type: Number, default: 0 })
  sampleImpressions: number;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export type RecommendationCategoryPriorDocument = HydratedDocument<RecommendationCategoryPrior>;
export const RecommendationCategoryPriorSchema = SchemaFactory.createForClass(RecommendationCategoryPrior);

RecommendationCategoryPriorSchema.index({ key: 1 }, { unique: true, name: 'uq_recommendation_category_prior_key' });
