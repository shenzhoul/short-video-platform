import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EXPLORATION_STAGES,
  FRESHNESS_DEFAULT_HALF_LIFE_HOURS,
  FRESHNESS_EVERGREEN_CATEGORY_KEYS,
  FRESHNESS_EVERGREEN_HALF_LIFE_HOURS,
  GLOBAL_ENGAGEMENT_PRIOR,
  RecommendationFeedType,
  RecommendationSource,
  SCORE_WEIGHTS,
  SESSION_JITTER_MAGNITUDE,
  WATCH_QUALITY_POLICY
} from 'src/common/constants/recommendation';
import {
  PostRecommendationStat,
  PostRecommendationStatDocument,
  RecommendationCategoryPrior,
  RecommendationCategoryPriorDocument,
  GLOBAL_ENGAGEMENT_PRIOR_KEY
} from 'src/schemas/content/recommendation';
import { seededJitter } from './recommendation-hash.util';
import { TopAffinity } from './recommendation-affinity.service';

export interface ScoringCandidatePost {
  _id: any;
  userId: any;
  topicKey?: string | null;
  tags?: string[];
  type?: string;
  mediaTypes?: string[];
  totalLike?: number;
  totalComment?: number;
  totalShare?: number;
  createdAt: Date;
}

export interface ScoringContext {
  feedType: RecommendationFeedType;
  sessionSeed: string;
  now: Date;
  topCategoryAffinities: TopAffinity[];
  topHashtagAffinities: TopAffinity[];
  topCreatorAffinities: TopAffinity[];
  formatPreferenceScore: number; // positive favors video, negative favors photo
}

export interface ScoreBreakdown {
  userInterest: number;
  watchQuality: number;
  engagementQuality: number;
  freshness: number;
  explorationBonus: number;
  creatorAffinity: number;
  sessionJitter: number;
}

export interface ScoredCandidate {
  post: ScoringCandidatePost;
  source: RecommendationSource;
  finalScore: number;
  breakdown: ScoreBreakdown;
  explorationStage: 0 | 1 | 2;
}

/** Saturating normalizer: maps [0, ∞) to [0, 1) with diminishing returns past `k`. */
function saturate(value: number, k: number): number {
  if (value <= 0 || k <= 0) return 0;
  return value / (value + k);
}

const AFFINITY_SATURATION_K = 6;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Turns a base match + candidate pool into ranked, explainable scores.
 *
 * Every feature is normalized to a comparable `[0,1]`-ish range before the
 * weighted sum (rules/instructions §6) — nothing here adds a raw
 * `totalLike`/`totalComment` straight into the formula.
 */
@Injectable()
export class RecommendationScoringService {
  constructor(
    @InjectModel(PostRecommendationStat.name)
    private readonly statModel: Model<PostRecommendationStatDocument>,
    @InjectModel(RecommendationCategoryPrior.name)
    private readonly priorModel: Model<RecommendationCategoryPriorDocument>
  ) { }

  /** Batch-load stats for a candidate page — one query, never one per post. */
  public async loadStats(postIds: string[]): Promise<Map<string, PostRecommendationStatDocument>> {
    const map = new Map<string, PostRecommendationStatDocument>();
    if (!postIds.length) return map;
    const rows = await this.statModel.find({ postId: { $in: postIds } }).lean();
    rows.forEach((row: any) => map.set(row.postId.toString(), row));
    return map;
  }

  /** Batch-load the priors needed for a candidate page's category set, plus the global fallback. */
  public async loadPriors(topicKeys: Array<string | null | undefined>): Promise<Map<string, RecommendationCategoryPriorDocument>> {
    const keys = Array.from(new Set([GLOBAL_ENGAGEMENT_PRIOR_KEY, ...topicKeys.filter(Boolean) as string[]]));
    const rows = await this.priorModel.find({ key: { $in: keys } }).lean();
    const map = new Map<string, RecommendationCategoryPriorDocument>();
    rows.forEach((row: any) => map.set(row.key, row));
    return map;
  }

  private freshnessHalfLifeHours(topicKey?: string | null): number {
    if (topicKey && FRESHNESS_EVERGREEN_CATEGORY_KEYS.includes(topicKey)) {
      return FRESHNESS_EVERGREEN_HALF_LIFE_HOURS;
    }
    return FRESHNESS_DEFAULT_HALF_LIFE_HOURS;
  }

  private freshness(post: ScoringCandidatePost, now: Date): number {
    const ageHours = Math.max(0, (now.getTime() - new Date(post.createdAt).getTime()) / MS_PER_HOUR);
    const halfLife = this.freshnessHalfLifeHours(post.topicKey);
    return Math.exp((-Math.LN2 * ageHours) / halfLife);
  }

  private explorationStage(impressions: number): 0 | 1 | 2 {
    if (impressions < EXPLORATION_STAGES.STAGE_0_MAX_IMPRESSIONS) return 0;
    if (impressions < EXPLORATION_STAGES.STAGE_1_MAX_IMPRESSIONS) return 1;
    return 2;
  }

  private explorationBonus(stage: 0 | 1 | 2): number {
    if (stage === 0) return EXPLORATION_STAGES.STAGE_0_BONUS;
    if (stage === 1) return EXPLORATION_STAGES.STAGE_1_BONUS;
    return EXPLORATION_STAGES.STAGE_2_BONUS;
  }

  private watchQuality(post: ScoringCandidatePost, stat: PostRecommendationStatDocument | undefined): number {
    const isPhoto = post.type === 'photo' || (post.mediaTypes || []).includes('photo');
    const impressions = stat?.impressions || 0;
    const quickSkipRate = impressions > 0 ? Math.min(1, (stat?.quickSkips || 0) / impressions) : 0;

    if (isPhoto) {
      const dwellSamples = stat?.dwellSampleCount || 0;
      const avgDwellMs = dwellSamples > 0 ? (stat?.dwellMsSum || 0) / dwellSamples : 0;
      const dwellNorm = Math.min(1, avgDwellMs / WATCH_QUALITY_POLICY.photo.strongDwellMs);
      if (dwellSamples === 0) return 0.3; // Cold-start-safe neutral default — never zero, never a free win.
      return dwellNorm * 0.7 + (1 - quickSkipRate) * 0.3;
    }

    const watchSamples = stat?.watchSampleCount || 0;
    if (watchSamples === 0) return 0.3;
    const avgWatchRatio = Math.min(1, (stat?.watchRatioSum || 0) / watchSamples);
    const completionRate = Math.min(1, (stat?.completions || 0) / watchSamples);
    return avgWatchRatio * 0.5 + completionRate * 0.3 + (1 - quickSkipRate) * 0.2;
  }

  /**
   * Bayesian-smoothed, normalized engagement quality — the core defense
   * against "1 like / 1 impression" beating a well-sampled post, and against a
   * stale viral post permanently outranking everything (freshness handles the
   * time-decay half; this handles the sample-size half).
   */
  private engagementQuality(
    stat: PostRecommendationStatDocument | undefined,
    priors: Map<string, RecommendationCategoryPriorDocument>,
    topicKey?: string | null
  ): number {
    const prior = (topicKey && priors.get(topicKey)) || priors.get(GLOBAL_ENGAGEMENT_PRIOR_KEY);
    const priorMean = prior?.priorMean ?? GLOBAL_ENGAGEMENT_PRIOR.priorMean;
    const priorStrength = prior?.priorStrength ?? GLOBAL_ENGAGEMENT_PRIOR.priorStrength;

    const impressions = stat?.impressions || 0;
    const weightedEngagement = stat?.weightedEngagement || 0;
    const smoothedRate = (weightedEngagement + priorMean * priorStrength) / (impressions + priorStrength);

    // Saturating normalization around the prior mean: a post at ~10x the
    // platform-average rate is already close to the ceiling.
    return saturate(smoothedRate, priorMean * 10 || 0.01);
  }

  private userInterest(post: ScoringCandidatePost, ctx: ScoringContext): number {
    const categoryHit = post.topicKey
      ? ctx.topCategoryAffinities.find((a) => a.key === post.topicKey)?.decayedScore || 0
      : 0;
    const hashtagHit = (post.tags || [])
      .reduce((sum, tag) => sum + (ctx.topHashtagAffinities.find((a) => a.key === tag)?.decayedScore || 0), 0);

    const isVideo = post.type === 'video' || (post.mediaTypes || []).includes('video');
    const formatMatch = isVideo
      ? Math.max(0, ctx.formatPreferenceScore)
      : Math.max(0, -ctx.formatPreferenceScore);

    const categoryNorm = saturate(categoryHit, AFFINITY_SATURATION_K);
    const hashtagNorm = saturate(hashtagHit, AFFINITY_SATURATION_K);
    const formatNorm = saturate(formatMatch, AFFINITY_SATURATION_K);

    return categoryNorm * 0.55 + hashtagNorm * 0.3 + formatNorm * 0.15;
  }

  private creatorAffinity(post: ScoringCandidatePost, ctx: ScoringContext): number {
    const hit = ctx.topCreatorAffinities.find((a) => a.key === post.userId.toString())?.decayedScore || 0;
    return saturate(hit, AFFINITY_SATURATION_K);
  }

  /**
   * Score one candidate. Batch-load `stats`/`priors` first with
   * `loadStats`/`loadPriors` — this method takes them as maps so scoring a
   * whole candidate page never issues one query per post.
   */
  public score(
    post: ScoringCandidatePost,
    source: RecommendationSource,
    ctx: ScoringContext,
    stats: Map<string, PostRecommendationStatDocument>,
    priors: Map<string, RecommendationCategoryPriorDocument>
  ): ScoredCandidate {
    const stat = stats.get(post._id.toString());
    const weights = SCORE_WEIGHTS[ctx.feedType];
    const stage = this.explorationStage(stat?.impressions || 0);

    const breakdown: ScoreBreakdown = {
      userInterest: this.userInterest(post, ctx),
      watchQuality: this.watchQuality(post, stat),
      engagementQuality: this.engagementQuality(stat, priors, post.topicKey),
      freshness: this.freshness(post, ctx.now),
      explorationBonus: this.explorationBonus(stage),
      creatorAffinity: this.creatorAffinity(post, ctx),
      sessionJitter: seededJitter(`${ctx.sessionSeed}:${post._id.toString()}`, SESSION_JITTER_MAGNITUDE)
    };

    const finalScore = weights.userInterest * breakdown.userInterest
      + weights.watchQuality * breakdown.watchQuality
      + weights.engagementQuality * breakdown.engagementQuality
      + weights.freshness * breakdown.freshness
      + weights.explorationBonus * breakdown.explorationBonus
      + weights.creatorAffinity * breakdown.creatorAffinity
      + breakdown.sessionJitter;

    return {
      post, source, finalScore, breakdown, explorationStage: stage
    };
  }
}
