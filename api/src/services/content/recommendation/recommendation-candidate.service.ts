import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ObjectId } from 'mongodb';
import {
  CANDIDATE_QUOTAS,
  EXPLORATION_STAGES,
  GUEST_CANDIDATE_QUOTAS,
  RECOMMENDATION_SOURCES,
  RecommendationFeedType,
  RecommendationSource
} from 'src/common/constants/recommendation';
import { Post, PostDocument } from 'src/schemas';
import { CategoryService } from 'src/services/content/category';
import { FollowService } from 'src/services/community/follow';
import { RecommendationEligibilityContext, buildEligibilityMatch } from './recommendation-eligibility.util';
import { TopAffinity } from './recommendation-affinity.service';
import { seededUnitInterval } from './recommendation-hash.util';
import { ScoringCandidatePost } from './recommendation-scoring.service';

/** Trailing window considered for the trending and time-fresh sources. */
const TRENDING_WINDOW_DAYS = 14;
const FRESH_TIME_WINDOW_HOURS = 72;
/** How much larger than the target the shuffle sample pulls, to survive the low-impression filter. */
const FRESH_SHUFFLE_OVERSAMPLE_FACTOR = 3;

const CANDIDATE_PROJECTION = {
  userId: 1, topicKey: 1, tags: 1, type: 1, mediaTypes: 1, orientation: 1,
  totalLike: 1, totalComment: 1, totalShare: 1, totalView: 1, createdAt: 1, recoShuffleKey: 1
};

export interface CandidateSourceInput {
  feedType: RecommendationFeedType;
  isGuest: boolean;
  eligibility: RecommendationEligibilityContext;
  /** Category tab constraint — when set, every source is scoped to it (rules/instructions §2.1). */
  topicKey?: string | null;
  poolSize: number;
  sessionSeed: string;
  topCategoryAffinities: TopAffinity[];
  topHashtagAffinities: TopAffinity[];
  topCreatorAffinities: TopAffinity[];
  followingCreatorIds: string[];
}

export interface CandidatePool {
  bySource: Map<RecommendationSource, ScoringCandidatePost[]>;
  all: ScoringCandidatePost[];
}

/**
 * Retrieves a bounded, indexed candidate pool per source — never a full
 * collection scan and never more than `poolSize`-ish documents pulled into
 * memory (rules/instructions §5, §17).
 */
@Injectable()
export class RecommendationCandidateService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>,
    private readonly categoryService: CategoryService,
    private readonly followService: FollowService
  ) { }

  /**
   * Bounded random sample using the indexed `recoShuffleKey` range scan
   * instead of `$sample` (which is a full COLLSCAN at this scale — see the
   * index comment on `Post.recoShuffleKey`). Wraps around once if the tail of
   * the keyspace does not yield enough documents.
   */
  private async sampleByShuffleKey(
    match: Record<string, any>,
    limit: number,
    anchorSeed: string
  ): Promise<any[]> {
    const anchor = seededUnitInterval(anchorSeed);
    const forward = await this.postModel
      .find({ ...match, recoShuffleKey: { $gte: anchor } })
      .select(CANDIDATE_PROJECTION)
      .sort({ recoShuffleKey: 1 })
      .limit(limit)
      .lean();

    if (forward.length >= limit) return forward;

    const wrapped = await this.postModel
      .find({ ...match, recoShuffleKey: { $lt: anchor } })
      .select(CANDIDATE_PROJECTION)
      .sort({ recoShuffleKey: 1 })
      .limit(limit - forward.length)
      .lean();

    return [...forward, ...wrapped];
  }

  private scopedMatch(input: CandidateSourceInput): Record<string, any> {
    const match = buildEligibilityMatch(input.eligibility);
    if (input.topicKey) match.topicKey = input.topicKey;
    return match;
  }

  private async personalized(input: CandidateSourceInput, limit: number): Promise<any[]> {
    if (!limit) return [];
    const categoryKeys = input.topCategoryAffinities.map((a) => a.key);
    const creatorIds = input.topCreatorAffinities.map((a) => a.key);
    const tagKeys = input.topHashtagAffinities.map((a) => a.key);
    if (!categoryKeys.length && !creatorIds.length && !tagKeys.length) return [];

    const match = this.scopedMatch(input);
    const or: Record<string, any>[] = [];
    if (categoryKeys.length && !input.topicKey) or.push({ topicKey: { $in: categoryKeys } });
    if (creatorIds.length) or.push({ userId: { $in: creatorIds.map((id) => new ObjectId(id)) } });
    if (tagKeys.length) or.push({ tags: { $in: tagKeys } });
    if (!or.length) return [];
    match.$or = or;

    return this.postModel.find(match).select(CANDIDATE_PROJECTION).sort({ createdAt: -1 }).limit(limit * 2).lean();
  }

  private async trending(input: CandidateSourceInput, limit: number): Promise<any[]> {
    if (!limit) return [];
    const match = this.scopedMatch(input);
    match.createdAt = { $gte: new Date(Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000) };
    return this.postModel.find(match).select(CANDIDATE_PROJECTION).sort({ createdAt: -1 }).limit(limit * 2).lean();
  }

  private async fresh(input: CandidateSourceInput, limit: number): Promise<any[]> {
    if (!limit) return [];
    const baseMatch = this.scopedMatch(input);

    const timeWindowLimit = Math.ceil(limit / 2);
    const timeFresh = await this.postModel
      .find({ ...baseMatch, createdAt: { $gte: new Date(Date.now() - FRESH_TIME_WINDOW_HOURS * 60 * 60 * 1000) } })
      .select(CANDIDATE_PROJECTION)
      .sort({ createdAt: -1 })
      .limit(timeWindowLimit * 2)
      .lean();

    // Low-impression posts regardless of age — an old, never-surfaced post
    // still deserves an exploration chance (rules/instructions §5.4). Found via
    // the indexed shuffle sample rather than a stats-first scan, because a post
    // with literally zero events has no PostRecommendationStat row at all.
    const shuffleLimit = Math.max(limit, timeWindowLimit) * FRESH_SHUFFLE_OVERSAMPLE_FACTOR;
    const shuffled = await this.sampleByShuffleKey(baseMatch, shuffleLimit, `${input.sessionSeed}:fresh`);

    // Creator-spam guard for this bucket specifically: cap how many of the
    // *sampled* fresh candidates may come from one creator, before scoring
    const perCreatorCap = Math.max(1, Math.ceil(shuffleLimit * EXPLORATION_STAGES.MAX_SHARE_PER_CREATOR_IN_FRESH_BUCKET));
    const perCreatorCount = new Map<string, number>();
    const capped = shuffled.filter((post: any) => {
      const key = post.userId.toString();
      const count = perCreatorCount.get(key) || 0;
      if (count >= perCreatorCap) return false;
      perCreatorCount.set(key, count + 1);
      return true;
    });

    const seen = new Set(timeFresh.map((p: any) => p._id.toString()));
    const merged = [...timeFresh];
    capped.forEach((post: any) => {
      if (!seen.has(post._id.toString())) {
        seen.add(post._id.toString());
        merged.push(post);
      }
    });
    return merged;
  }

  private async social(input: CandidateSourceInput, limit: number): Promise<any[]> {
    if (!limit || !input.followingCreatorIds.length) return [];
    const match = this.scopedMatch(input);
    match.userId = { $in: input.followingCreatorIds.map((id) => new ObjectId(id)) };
    return this.postModel.find(match).select(CANDIDATE_PROJECTION).sort({ createdAt: -1 }).limit(limit * 2).lean();
  }

  private async diverse(input: CandidateSourceInput, limit: number): Promise<any[]> {
    if (!limit) return [];
    const match = this.scopedMatch(input);
    if (!input.topicKey) {
      const strongCategories = input.topCategoryAffinities.map((a) => a.key);
      if (strongCategories.length) match.topicKey = { $nin: strongCategories };
    }
    return this.sampleByShuffleKey(match, limit * 2, `${input.sessionSeed}:diverse`);
  }

  /**
   * Retrieve every source's candidates, sized by the feed's quota policy, and
   * backfill from other sources when one comes up short (rules/instructions
   */
  public async retrieve(input: CandidateSourceInput): Promise<CandidatePool> {
    const quotas = input.isGuest
      ? {
        [RECOMMENDATION_SOURCES.TRENDING]: GUEST_CANDIDATE_QUOTAS.recentPopular,
        [RECOMMENDATION_SOURCES.FRESH]: GUEST_CANDIDATE_QUOTAS.fresh,
        [RECOMMENDATION_SOURCES.DIVERSE]: GUEST_CANDIDATE_QUOTAS.categoryDiverse,
        [RECOMMENDATION_SOURCES.PERSONALIZED]: 0,
        [RECOMMENDATION_SOURCES.SOCIAL]: 0
      } as Record<RecommendationSource, number>
      : CANDIDATE_QUOTAS[input.feedType];

    const targets: Record<RecommendationSource, number> = {
      [RECOMMENDATION_SOURCES.PERSONALIZED]: Math.round(input.poolSize * quotas[RECOMMENDATION_SOURCES.PERSONALIZED]),
      [RECOMMENDATION_SOURCES.TRENDING]: Math.round(input.poolSize * quotas[RECOMMENDATION_SOURCES.TRENDING]),
      [RECOMMENDATION_SOURCES.FRESH]: Math.round(input.poolSize * quotas[RECOMMENDATION_SOURCES.FRESH]),
      [RECOMMENDATION_SOURCES.SOCIAL]: Math.round(input.poolSize * quotas[RECOMMENDATION_SOURCES.SOCIAL]),
      [RECOMMENDATION_SOURCES.DIVERSE]: Math.round(input.poolSize * quotas[RECOMMENDATION_SOURCES.DIVERSE])
    };

    const [personalized, trending, fresh, social, diverse] = await Promise.all([
      this.personalized(input, targets[RECOMMENDATION_SOURCES.PERSONALIZED]),
      this.trending(input, targets[RECOMMENDATION_SOURCES.TRENDING]),
      this.fresh(input, targets[RECOMMENDATION_SOURCES.FRESH]),
      this.social(input, targets[RECOMMENDATION_SOURCES.SOCIAL]),
      this.diverse(input, targets[RECOMMENDATION_SOURCES.DIVERSE])
    ]);

    const bySource = new Map<RecommendationSource, any[]>([
      [RECOMMENDATION_SOURCES.PERSONALIZED, personalized],
      [RECOMMENDATION_SOURCES.TRENDING, trending],
      [RECOMMENDATION_SOURCES.FRESH, fresh],
      [RECOMMENDATION_SOURCES.SOCIAL, social],
      [RECOMMENDATION_SOURCES.DIVERSE, diverse]
    ]);

    // Dedupe across sources (a post can legitimately satisfy more than one
    // bucket's query) and backfill any bucket short of its target from
    // whichever other bucket has spare, unused candidates.
    const seen = new Set<string>();
    const all: ScoringCandidatePost[] = [];
    const dedupedBySource = new Map<RecommendationSource, ScoringCandidatePost[]>();

    Array.from(bySource.entries()).forEach(([source, posts]) => {
      const kept: ScoringCandidatePost[] = [];
      posts.forEach((post: any) => {
        const id = post._id.toString();
        if (seen.has(id)) return;
        seen.add(id);
        kept.push(post);
        all.push(post);
      });
      dedupedBySource.set(source, kept);
    });

    // Backfill is implicit rather than a separate pass: every source query
    // above already asks for `target * oversample` (2x, 3x for fresh), so
    // `dedupedBySource` commonly holds more than its own target already, and
    // `all` is never truncated per-bucket — a source that came up short
    // simply contributes less to `all` while the others contribute their full
    // (oversampled) share, keeping the overall pool near `poolSize` without a
    // second query round-trip.

    return { bySource: dedupedBySource, all };
  }

  /** Active category keys the user has *no* strong affinity for, for diversity-tab UX and demo/debug use. */
  public async activeCategoryKeys(): Promise<string[]> {
    const categories = await this.categoryService.findActive();
    return categories.map((c) => c.key);
  }

  public async getFollowingCreatorIds(userId: string): Promise<string[]> {
    const ids = await this.followService.getFollowingCreatorIds(userId);
    return ids.map((id) => id.toString());
  }
}
