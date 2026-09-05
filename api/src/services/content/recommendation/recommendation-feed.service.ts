import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ObjectId } from 'mongodb';
import {
  FEED_SESSION_POLICY,
  RECOMMENDATION_FEED_TYPES,
  RECOMMENDATION_SOURCES,
  RecommendationFeedType,
  SESSION_OUTPUT_POLICY
} from 'src/common/constants/recommendation';
import { Post, PostDocument } from 'src/schemas';
import { STATUS } from 'src/kernel/constants';
import { UserRelationshipService } from 'src/services/community/relationship/user-relationship.service';
import { RecommendationAffinityService } from './recommendation-affinity.service';
import { RecommendationCandidateService } from './recommendation-candidate.service';
import { RecommendationScoringService, ScoredCandidate } from './recommendation-scoring.service';
import { RecommendationDiversityService } from './recommendation-diversity.service';
import { RecommendationSelectionService } from './recommendation-selection.service';
import { RecommendationSessionService, FeedSessionItem } from './recommendation-session.service';
import { PostDetailRecommendationSessionService } from './post-detail-recommendation-session.service';
import { buildEligibilityMatch } from './recommendation-eligibility.util';

export interface RecommendationSubject {
  viewerId?: string;
  anonymousId?: string;
}

export interface RecommendationFeedResult {
  sessionId: string;
  data: any[]; // Lean Post documents, in ranked order — ContentService populates these.
  hasMore: boolean;
  nextCursor: string | null;
  debug?: Array<{ postId: string; source: string; finalScore: number; breakdown: ScoredCandidate['breakdown'] }>;
}

/**
 * Below this many candidates, seen-suppression is dropped rather than allowed
 * to starve the feed. Deliberately well under a full page: the point is to
 * rescue a viewer who would otherwise see nothing, not to stop suppressing at
 * the first sign of a small pool.
 */
const RELAXED_SUPPRESSION_MIN_POOL = 10;

const TOP_AFFINITY_COUNT = 8;

/**
 * The single orchestrator tying eligibility → candidates → scoring →
 * diversity → session together for both Home and For You (rules/instructions
 * §3). Controllers/`ContentService` call this; it never talks to Mongoose
 * models it does not own directly (Post, for hydration) — everything else is
 * delegated to the focused services above.
 */
@Injectable()
export class RecommendationFeedService {
  private readonly logger = new Logger(RecommendationFeedService.name);

  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>,
    private readonly candidateService: RecommendationCandidateService,
    private readonly scoringService: RecommendationScoringService,
    private readonly diversityService: RecommendationDiversityService,
    private readonly selectionService: RecommendationSelectionService,
    private readonly sessionService: RecommendationSessionService,
    private readonly affinityService: RecommendationAffinityService,
    private readonly detailSessionService: PostDetailRecommendationSessionService,
    private readonly userRelationshipService: UserRelationshipService
  ) { }

  private subjectId(subject: RecommendationSubject): string | undefined {
    return subject.viewerId || subject.anonymousId;
  }

  /**
   * True when this subject is a stable identity worth reading history for.
   * An ephemeral guest key names nobody, so looking it up is a guaranteed
   * miss and writing to it would create a row nothing can ever read again.
   */
  private isPersistentSubject(subject: RecommendationSubject): boolean {
    return Boolean(subject.viewerId || subject.anonymousId);
  }

  private async reorderByIds(ids: string[]): Promise<any[]> {
    if (!ids.length) return [];
    const posts = await this.postModel.find({ _id: { $in: ids.map((id) => new ObjectId(id)) } }).lean();
    const byId = new Map(posts.map((post: any) => [post._id.toString(), post]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  /**
   * Build a brand-new ranked session (called on first load and on every
   * reload — a caller with no `sessionId` always gets a new mix/order, per
   * rules/instructions §8.1).
   */
  private async createSession(params: {
    feedType: RecommendationFeedType;
    subject: RecommendationSubject;
    topicKey?: string | null;
    /**
     * The resolved owner of the session. Passed in rather than recomputed so
     * an ephemeral guest's session is registered under the same key
     * `getFeed` will read pages back with — recomputing it here would have
     * produced `undefined` and a session nobody could page.
     */
    subjectId: string;
    /**
     * The chain this session continues. Absent on a first load; set on a
     * rollover so the successor is ranked over what the chain has not shown.
     */
    chainId?: string | null;
  }): Promise<{ sessionId: string; ranked: ScoredCandidate[] }> {
    const { subjectId } = params;
    // Only a stable identity has history worth reading; an ephemeral guest
    // key names nobody, so the lookup is skipped rather than guaranteed to miss.
    const affinity = this.isPersistentSubject(params.subject)
      ? await this.affinityService.getRaw(subjectId)
      : null;

    const topCategoryAffinities = this.affinityService.topAffinities(affinity?.categoryScores, TOP_AFFINITY_COUNT);
    const topHashtagAffinities = this.affinityService.topAffinities(affinity?.hashtagScores, TOP_AFFINITY_COUNT);
    const topCreatorAffinities = this.affinityService.topAffinities(affinity?.creatorScores, TOP_AFFINITY_COUNT);
    const formatPreferenceScore = this.affinityService.formatPreferenceScore(affinity);
    const hasHistory = Boolean(topCategoryAffinities.length || topCreatorAffinities.length || topHashtagAffinities.length);

    const excludedCreatorIds = params.subject.viewerId
      ? await this.userRelationshipService.getBlockedEitherDirectionIds(params.subject.viewerId)
      : [];
    const seenAcrossHistory = (affinity?.recentlySeenPostIds || []).map((id: any) => id.toString());
    /*
     * What this scroll has already shown, as opposed to what this subject has
     * seen at some point in the past.
     *
     * `recentlySeenPostIds` is written from impression telemetry, which is
     * best-effort and lands after the fact — good enough to stop a session
     * repeating last week, useless for stopping the *next page* repeating the
     * page still on screen. The chain set is written when the order is fixed,
     * so a rollover is ranked over the genuinely unseen remainder.
     */
    let seenInChain = params.chainId ? await this.sessionService.getChainSeenIds(params.chainId) : [];
    if (seenInChain.length >= FEED_SESSION_POLICY.maxChainSeenIds) {
      // A scroll long enough to reach this has outlived any useful memory of
      // itself, and the set must not grow further. Recycling here is the same
      // decision the exhaustion branch below makes, taken on size instead.
      this.logger.log(`Feed chain seen-set hit its ceiling (${seenInChain.length}); recycling`);
      await this.sessionService.resetChainSeen(params.chainId as string);
      seenInChain = [];
    }
    const excludedPostIds = Array.from(new Set([...seenAcrossHistory, ...seenInChain]));

    const followingCreatorIds = params.subject.viewerId
      ? await this.candidateService.getFollowingCreatorIds(params.subject.viewerId)
      : [];

    const sessionSeed = this.sessionService.newSessionSeed();

    const retrieveWith = (postIdsToExclude: string[]) => this.candidateService.retrieve({
      feedType: params.feedType,
      isGuest: !params.subject.viewerId || !hasHistory,
      eligibility: {
        viewerId: params.subject.viewerId,
        excludedCreatorIds,
        excludedPostIds: postIdsToExclude
      },
      topicKey: params.topicKey,
      // Recall stays wide; what the session *shows* is bounded further down.
      poolSize: SESSION_OUTPUT_POLICY.candidatePoolLimit,
      sessionSeed,
      topCategoryAffinities,
      topHashtagAffinities,
      topCreatorAffinities,
      followingCreatorIds
    });

    let pool = await retrieveWith(excludedPostIds);

    /*
     * Recycle the chain before relaxing anything else.
     *
     * A chain that has served every eligible post is the *expected* end state
     * of a long scroll, not a fault: on this catalogue it takes three Home
     * sessions. When it happens the chain's memory is cleared and retrieval is
     * repeated over the whole corpus, so the scroll continues with a fresh
     * ranking instead of stopping — and the clear is persisted, so the next
     * rollover starts a new cycle rather than re-running this branch on every
     * page.
     *
     * Ordered before the blanket relaxation below on purpose: dropping only the
     * chain keeps the older cross-session suppression in force, so the recycled
     * sessions still prefer what the subject has not seen recently.
     */
    if (pool.all.length < RELAXED_SUPPRESSION_MIN_POOL && seenInChain.length) {
      const recycled = await retrieveWith(seenAcrossHistory);
      if (recycled.all.length > pool.all.length) {
        this.logger.log(
          `Recycled feed chain (${params.feedType}): ${seenInChain.length} posts served across the chain, `
          + `${pool.all.length} candidates left, ${recycled.all.length} after recycling`
        );
        await this.sessionService.resetChainSeen(params.chainId as string);
        pool = recycled;
        // The chain restarts empty, so the successor session must not re-add
        // the ids it just forgot.
        seenInChain = [];
      }
    }

    /*
     * Seen-suppression must never be able to empty the feed.
     *
     * `recentlySeenPostIds` is a ring buffer of the last 200 posts served, and
     * excluding them keeps a session from repeating itself. But an engaged
     * viewer on a small catalogue can be shown *everything*: measured here at
     * 140 distinct seen posts out of 160 active, of which 10 were the viewer's
     * own — leaving nothing eligible and rendering "Your Feed is Empty" to
     * somebody whose only crime was using the product a lot.
     *
     * Repeating a post someone has already seen is a much smaller failure than
     * showing them nothing, so suppression is relaxed rather than enforced to
     * the point of starvation. It is dropped only when it is the thing causing
     * the shortfall — every other eligibility rule (blocked creators, the
     * viewer's own posts, inactive content) still applies.
     */
    if (pool.all.length < RELAXED_SUPPRESSION_MIN_POOL && excludedPostIds.length) {
      const relaxed = await retrieveWith([]);
      if (relaxed.all.length > pool.all.length) {
        this.logger.log(
          // The subject is not logged. For a guest it is the anonymous session
          // id, and there is nothing this line needs it for — the numbers are
          // the diagnosis.
          `Relaxed seen-suppression (${params.subject.viewerId ? 'account' : 'guest'}): `
          + `${pool.all.length} candidates with ${excludedPostIds.length} suppressed, `
          + `${relaxed.all.length} without`
        );
        pool = relaxed;
      }
    }

    const [stats, priors] = await Promise.all([
      this.scoringService.loadStats(pool.all.map((p) => p._id.toString())),
      this.scoringService.loadPriors(pool.all.map((p) => p.topicKey))
    ]);

    const scoringContext = {
      feedType: params.feedType,
      sessionSeed,
      now: new Date(),
      topCategoryAffinities,
      topHashtagAffinities,
      topCreatorAffinities,
      formatPreferenceScore
    };

    const scored: ScoredCandidate[] = [];
    const bySourceEntries = Array.from(pool.bySource.entries());
    const scoredIds = new Set<string>();
    bySourceEntries.forEach(([source, posts]) => {
      posts.forEach((post) => {
        const id = post._id.toString();
        if (scoredIds.has(id)) return;
        scoredIds.add(id);
        scored.push(this.scoringService.score(post, source, scoringContext, stats, priors));
      });
    });

    /*
     * The session shows a bounded, seeded sample of the pool — not the pool.
     *
     * Retrieval stays wide (recall is cheap and useful); what changes is that a
     * session no longer *is* the catalogue. Before this, a 160-candidate pool
     * produced a 160-item session in score order, so reloading could only
     * re-sort one fixed set and the highest-scoring post led every single time.
     */
    const sessionLimit = params.feedType === RECOMMENDATION_FEED_TYPES.FOR_YOU
      ? SESSION_OUTPUT_POLICY.forYouInitialSessionLimit
      : SESSION_OUTPUT_POLICY.homeSessionItemLimit;

    const recentHeroIds = this.isPersistentSubject(params.subject)
      ? await this.selectionService.getRecentHeroes(params.feedType, subjectId)
      : [];

    const { candidateOrder, hero } = this.selectionService.select({
      scored, sessionSeed, recentHeroIds
    });

    /*
     * Selection and diversity are one step, not two.
     *
     * The whole seeded, weighted candidate order goes in and the re-ranker
     * takes the best candidate that *fits*, stopping at the session limit. Two
     * earlier arrangements were both wrong for the same reason — the order the
     * viewer sees was not the order any rule had checked. Splicing the lead on
     * top of a finished list meant the feed could open with two posts by the
     * same creator; truncating the sample *before* re-ranking meant a session
     * could be composed so badly that no re-ordering could fix it, while
     * compliant candidates sat unselected in the pool.
     */
    const ranked = this.diversityService.rerank(candidateOrder, {
      lead: hero, limit: sessionLimit, preserveOrder: true
    });

    const heroId = hero?.post._id.toString();
    if (heroId && this.isPersistentSubject(params.subject)) {
      await this.selectionService.rememberHero(params.feedType, subjectId, heroId);
    }

    const { sessionId } = await this.sessionService.create({
      subjectId,
      feedType: params.feedType,
      topicKey: params.topicKey,
      sessionSeed,
      ranked,
      chainId: params.chainId
    });

    return { sessionId, ranked };
  }

  /**
   * Get a feed page.
   *
   * - `sessionId` + `cursor` continues an existing session (stable pagination).
   * - No `sessionId` starts a brand-new session under a brand-new chain — the
   *   reload/refresh semantics.
   * - `sessionId` + `rollover` starts a *successor* session in the same chain:
   *   a new ranking, a new mix, and the chain's already-served posts excluded.
   *   This is what makes an infinite scroll continue past one session's end
   *   without either repeating itself or turning the session into the whole
   *   catalogue.
   */
  public async getFeed(params: {
    feedType: RecommendationFeedType;
    subject: RecommendationSubject;
    topicKey?: string | null;
    sessionId?: string;
    cursor?: string | null;
    limit: number;
    debug?: boolean;
    /** Continue the scroll in a new session of the same chain (see above). */
    rollover?: boolean;
  }): Promise<RecommendationFeedResult> {
    /*
     * A guest who sends no `anonymousId` still gets a feed.
     *
     * This used to throw, which the global filter turned into an unhandled
     * 500 — and the caller it hit hardest was the most ordinary one there is:
     * a first-time visitor, before the client has generated and stored an id.
     * Home simply failed to load for them.
     *
     * The subject exists only to key affinity and session ownership, so an
     * anonymous caller with nothing to key on gets a per-request identity.
     * They have no stored history to look up and nothing is written back
     * under it, which is exactly the documented guest contract: a mix drawn
     * from recent-popular, fresh and diverse, with no cross-session memory.
     */
    const subjectId = this.subjectId(params.subject) || `ephemeral:${randomUUID()}`;

    /*
     * A rollover inherits the chain and skips the page read entirely. Reading
     * the exhausted session first would answer with its last page again, which
     * is precisely the repeat this exists to avoid.
     *
     * The chain id is resolved through the session, and `getChainId` checks the
     * subject — so a rollover cannot be pointed at somebody else's chain to
     * learn what they were shown.
     */
    let chainId: string | null = null;
    if (params.sessionId && params.rollover) {
      chainId = await this.sessionService.getChainId(params.sessionId, subjectId);
    } else if (params.sessionId) {
      const page = await this.sessionService.getPage(params.sessionId, subjectId, params.cursor || null, params.limit);
      if (page) {
        const data = await this.reorderByIds(page.items.map((item: FeedSessionItem) => item.postId));
        return {
          sessionId: page.sessionId, data, hasMore: page.hasMore, nextCursor: page.nextCursor
        };
      }
      // Session missing/expired/mismatched — degrade to a fresh session rather than erroring.
    }

    const { sessionId, ranked } = await this.createSession({
      feedType: params.feedType, subject: params.subject, topicKey: params.topicKey, subjectId, chainId
    });
    const page = await this.sessionService.getPage(sessionId, subjectId, null, params.limit);
    const data = await this.reorderByIds((page?.items || []).map((item) => item.postId));

    const result: RecommendationFeedResult = {
      sessionId,
      data,
      hasMore: Boolean(page?.hasMore),
      nextCursor: page?.nextCursor ?? null
    };

    if (params.debug) {
      result.debug = ranked.slice(0, params.limit).map((c) => ({
        postId: c.post._id.toString(), source: c.source, finalScore: c.finalScore, breakdown: c.breakdown
      }));
    }

    return result;
  }

  // ---- Post Detail sequencing (Home / notification / message / direct-link anchors) ----

  public async openDetailSession(anchorPostId: string, subject: RecommendationSubject): Promise<{ sessionId: string; postId: string }> {
    const subjectId = this.subjectId(subject);
    if (!subjectId) throw new Error('Post Detail recommendation session requires a subject');
    const state = await this.detailSessionService.create(subjectId, anchorPostId);
    return { sessionId: state.sessionId, postId: state.items[state.cursorIndex].postId };
  }

  public async detailPrevious(sessionId: string, subject: RecommendationSubject): Promise<{ postId: string } | null> {
    const subjectId = this.subjectId(subject);
    if (!subjectId) return null;
    const state = await this.detailSessionService.stepBack(sessionId, subjectId);
    if (!state) return null;
    return { postId: state.items[state.cursorIndex].postId };
  }

  /**
   * Advance to the next post. If the session already has one appended
   * (the viewer stepped back and is now stepping forward again), replay it
   * exactly rather than recomputing — otherwise compute exactly one new
   * candidate from the same eligibility/scoring pipeline as the feed engine,
   * anchored to exclude everything already shown in this session.
   */
  public async detailNext(
    sessionId: string,
    subject: RecommendationSubject,
    feedTypeForScoring: RecommendationFeedType = RECOMMENDATION_FEED_TYPES.HOME,
    /**
     * Restrict candidates to posts that carry a video.
     *
     * Set by the picture-in-picture window, which has nothing to draw a photo
     * post with — it is a `<video>` element and a transport bar. Filtering here
     * rather than in the client is what keeps "next" one round trip: a client
     * that discarded photo posts itself would have to ask again, and each ask
     * appends the rejected post to the session for good.
     */
    videoOnly = false
  ): Promise<{ postId: string } | null> {
    const subjectId = this.subjectId(subject);
    if (!subjectId) return null;

    const existing = await this.detailSessionService.stepForwardIfExists(sessionId, subjectId);
    if (existing) {
      const replayPostId = existing.items[existing.cursorIndex].postId;
      // A post appended to this session earlier can have been deleted or
      // deactivated since — replaying it would hand the viewer a dead post
      // instead of skipping to the next one (rules/instructions §5.5: "Post
      // bị xóa giữa session → skip và lấy item tiếp"). The cursor already
      // advanced past it in `stepForwardIfExists`, so falling through here
      // regenerates *from that position* rather than replaying the ghost —
      // the dead entry stays in history for `previous` (a tombstone the
      // frontend skips over), but `next` never lands on it again.
      const isAlive = await this.postModel.exists({
        _id: new ObjectId(replayPostId), status: STATUS.ACTIVE, isCreatorDeleted: { $ne: true }
      });
      if (isAlive) return { postId: replayPostId };
    }

    const state = await this.detailSessionService.getState(sessionId, subjectId);
    if (!state) return null;

    const affinity = await this.affinityService.getRaw(subjectId);
    const topCategoryAffinities = this.affinityService.topAffinities(affinity?.categoryScores, TOP_AFFINITY_COUNT);
    const topHashtagAffinities = this.affinityService.topAffinities(affinity?.hashtagScores, TOP_AFFINITY_COUNT);
    const topCreatorAffinities = this.affinityService.topAffinities(affinity?.creatorScores, TOP_AFFINITY_COUNT);
    const formatPreferenceScore = this.affinityService.formatPreferenceScore(affinity);
    const excludedCreatorIds = subject.viewerId
      ? await this.userRelationshipService.getBlockedEitherDirectionIds(subject.viewerId)
      : [];
    const excludedPostIds = state.items.map((item) => item.postId);

    const match = buildEligibilityMatch({ viewerId: subject.viewerId, excludedCreatorIds, excludedPostIds });
    if (videoOnly) {
      /*
       * Both fields are checked because they disagree in stored data: `type` is
       * the post's declared kind and `mediaTypes` is what its attachments
       * actually are. A post that carries a video is playable whichever field
       * says so, and requiring both would silently exclude real videos.
       *
       * Appended to `$and` rather than assigned, because `buildEligibilityMatch`
       * already owns that key — overwriting it would drop the blocked-creator
       * and already-seen exclusions.
       */
      match.$and = [...(match.$and || []), { $or: [{ type: 'video' }, { mediaTypes: 'video' }] }];
    }
    const candidates = await this.postModel
      .find(match)
      .select({
        userId: 1, topicKey: 1, tags: 1, type: 1, mediaTypes: 1, totalLike: 1, totalComment: 1, totalShare: 1, createdAt: 1
      })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    if (!candidates.length) return null;

    const [stats, priors] = await Promise.all([
      this.scoringService.loadStats(candidates.map((c: any) => c._id.toString())),
      this.scoringService.loadPriors(candidates.map((c: any) => c.topicKey))
    ]);

    const scored = candidates.map((post: any) => this.scoringService.score(post, RECOMMENDATION_SOURCES.PERSONALIZED, {
      feedType: feedTypeForScoring,
      sessionSeed: state.sessionSeed,
      now: new Date(),
      topCategoryAffinities,
      topHashtagAffinities,
      topCreatorAffinities,
      formatPreferenceScore
    }, stats, priors)).sort((a, b) => b.finalScore - a.finalScore);

    const best = scored[0];
    const updated = await this.detailSessionService.appendAndAdvance(sessionId, subjectId, {
      postId: best.post._id.toString(), source: best.source
    });
    if (!updated) return null;
    return { postId: updated.items[updated.cursorIndex].postId };
  }
}
