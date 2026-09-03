import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CATEGORY_PRIOR_MIN_SAMPLE_IMPRESSIONS,
  GLOBAL_ENGAGEMENT_PRIOR
} from 'src/common/constants/recommendation';
import {
  PostRecommendationStat,
  PostRecommendationStatDocument,
  RecommendationCategoryPrior,
  RecommendationCategoryPriorDocument,
  GLOBAL_ENGAGEMENT_PRIOR_KEY
} from 'src/schemas/content/recommendation';

/** Cap so one enormous recompute cannot pull the whole stats collection into memory — mirrors TagTrendingService. */
const MAX_STAT_ROWS_PER_RUN = 20_000;

/**
 * Recomputes the Bayesian-smoothing priors (`engagementQuality`'s "what's a
 * normal engagement rate for this category" input) on a schedule, from the
 * bounded `post_recommendation_stats` aggregate — never from raw events, and
 * never on the scoring read path. Mirrors `TagTrendingService`.
 */
@Injectable()
export class RecommendationCategoryPriorService {
  constructor(
    @InjectModel(PostRecommendationStat.name)
    private readonly statModel: Model<PostRecommendationStatDocument>,
    @InjectModel(RecommendationCategoryPrior.name)
    private readonly priorModel: Model<RecommendationCategoryPriorDocument>
  ) { }

  public async recalculate(): Promise<number> {
    const rows = await this.statModel
      .find({ impressions: { $gt: 0 } })
      .select({ topicKey: 1, impressions: 1, weightedEngagement: 1 })
      .limit(MAX_STAT_ROWS_PER_RUN)
      .lean();

    if (!rows.length) return 0;

    let globalImpressions = 0;
    let globalEngagement = 0;
    const byCategory = new Map<string, { impressions: number; engagement: number }>();

    rows.forEach((row: any) => {
      globalImpressions += row.impressions;
      globalEngagement += row.weightedEngagement || 0;
      if (!row.topicKey) return;
      const bucket = byCategory.get(row.topicKey) || { impressions: 0, engagement: 0 };
      bucket.impressions += row.impressions;
      bucket.engagement += row.weightedEngagement || 0;
      byCategory.set(row.topicKey, bucket);
    });

    const ops: any[] = [{
      updateOne: {
        filter: { key: GLOBAL_ENGAGEMENT_PRIOR_KEY },
        update: {
          $set: {
            priorMean: globalImpressions > 0 ? globalEngagement / globalImpressions : GLOBAL_ENGAGEMENT_PRIOR.priorMean,
            priorStrength: GLOBAL_ENGAGEMENT_PRIOR.priorStrength,
            sampleImpressions: globalImpressions,
            updatedAt: new Date()
          },
          $setOnInsert: { key: GLOBAL_ENGAGEMENT_PRIOR_KEY }
        },
        upsert: true
      }
    }];

    byCategory.forEach((bucket, key) => {
      if (bucket.impressions < CATEGORY_PRIOR_MIN_SAMPLE_IMPRESSIONS) return;
      ops.push({
        updateOne: {
          filter: { key },
          update: {
            $set: {
              priorMean: bucket.engagement / bucket.impressions,
              priorStrength: GLOBAL_ENGAGEMENT_PRIOR.priorStrength,
              sampleImpressions: bucket.impressions,
              updatedAt: new Date()
            },
            $setOnInsert: { key }
          },
          upsert: true
        }
      });
    });

    await this.priorModel.bulkWrite(ops, { ordered: false });
    return ops.length;
  }
}
