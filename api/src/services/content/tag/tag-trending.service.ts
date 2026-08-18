import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TagSummary, TagSummaryDocument } from 'src/schemas';

/** How much a tag's score decays as its last use recedes into the past. */
const RECENCY_WEIGHTS: Array<{ maxAgeDays: number; weight: number }> = [
  { maxAgeDays: 1, weight: 1 },
  { maxAgeDays: 3, weight: 0.8 },
  { maxAgeDays: 7, weight: 0.5 },
  { maxAgeDays: 30, weight: 0.2 }
];
const STALE_WEIGHT = 0.05;

/** Cap so one enormous recompute cannot pull the whole collection into memory. */
const MAX_TAGS_PER_RUN = 5000;

@Injectable()
export class TagTrendingService {
  constructor(
    @InjectModel(TagSummary.name)
    private readonly TagSummaryModel: Model<TagSummaryDocument>
  ) { }

  private recencyWeight(lastUsageDate?: Date): number {
    if (!lastUsageDate) return STALE_WEIGHT;
    const ageDays = (Date.now() - new Date(lastUsageDate).getTime()) / (1000 * 60 * 60 * 24);
    const match = RECENCY_WEIGHTS.find(entry => ageDays < entry.maxAgeDays);
    return match ? match.weight : STALE_WEIGHT;
  }

  /**
   * Blend of reach and recency.
   *
   * `log1p` keeps a single very popular tag from permanently dominating, and the recency weight is
   * what lets a newer tag overtake an older one with more lifetime usage — the closest thing to
   * "trending" available without search-traffic history.
   */
  private score(summary: Pick<TagSummaryDocument, 'grandTotalUsage' | 'grandTotalUniqueUsers' | 'grandTotalLikes' | 'lastUsageDate'>): number {
    const reach = (summary.grandTotalUsage || 0) * 2
      + (summary.grandTotalUniqueUsers || 0)
      + (summary.grandTotalLikes || 0) * 0.2;
    return Math.log1p(Math.max(0, reach)) * this.recencyWeight(summary.lastUsageDate);
  }

  /**
   * Recompute `trendingScore` for every tag and assign a dense `popularityRank` (1 = hottest).
   *
   * Rank is stored alongside the score rather than derived at query time so ordering stays stable
   * between runs and callers can filter on it directly.
   */
  async recalculateTrending(): Promise<number> {
    const summaries = await this.TagSummaryModel
      .find({})
      .select({
        tag: 1, grandTotalUsage: 1, grandTotalUniqueUsers: 1, grandTotalLikes: 1, lastUsageDate: 1
      })
      .sort({ grandTotalUsage: -1 })
      .limit(MAX_TAGS_PER_RUN)
      .lean();

    if (!summaries.length) return 0;

    const scored = summaries
      .map(summary => ({ tag: summary.tag, trendingScore: this.score(summary as any) }))
      .sort((a, b) => b.trendingScore - a.trendingScore);

    await this.TagSummaryModel.bulkWrite(scored.map((entry, index) => ({
      updateOne: {
        filter: { tag: entry.tag },
        update: {
          $set: {
            trendingScore: Number(entry.trendingScore.toFixed(6)),
            popularityRank: index + 1
          }
        }
      }
    })));

    return scored.length;
  }
}
