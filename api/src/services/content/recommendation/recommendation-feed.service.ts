import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ObjectId } from 'mongodb';
import {
  CHAIN_POLICY,
  DETAIL_SESSION_POLICY,
  RECOMMENDATION_FEED_TYPES,
  RECOMMENDATION_SOURCES,
  RecommendationFeedType,
  SESSION_OUTPUT_POLICY
} from 'src/common/constants/recommendation';
import { Post, PostDocument } from 'src/schemas';
import { STATUS } from 'src/kernel/constants';
import { UserRelationshipService } from 'src/services/community/relationship/user-relationship.service';
import { pickWeightedByRank, seededUnitInterval } from './recommendation-hash.util';
import { RecommendationAffinityService } from './recommendation-affinity.service';
import { RecommendationCandidateService } from './recommendation-candidate.service';
import { RecommendationScoringService, ScoredCandidate } from './recommendation-scoring.service';
import { RecommendationDiversityService } from './recommendation-diversity.service';
import { RecommendationSelectionService } from './recommendation-selection.service';
import { RecommendationSessionService, FeedSessionItem } from './recommendation-session.service';
import { BrowsingChainState, RecommendationChainService } from './recommendation-chain.service';
import { PostDetailRecommendationSessionService } from './post-detail-recommendation-session.service';
import { buildEligibilityMatch } from './recommendation-eligibility.util';

/** Order-preserving de-duplication, for building an exclusion list from several sources. */
function unique(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

export interface RecommendationSubject {
  viewerId?: string;
  anonymousId?: string;
}

export interface RecommendationFeedResult {
  sessionId: string;
  data: any[]; // Lean Post documents, in ranked order — ContentService populates these.
  hasMore: boolean;
  nextCursor: string | null;
  /** The browsing chain this session belongs to, echoed so the client keeps sending it. */
  chainId: string | null;
  /**
   * This browse has served every eligible post. The client stops here and shows
   * its end state; starting over is the viewer's decision, and both ways of
   * doing it ("Refresh recommendations", a reload) mint a new chain.
   */
  chainExhausted: boolean;
  debug?: Array<{ postId: string; source: string; finalScore: number; breakdown: ScoredCandidate['breakdown'] }>;
}

/**
 * Below this many candidates, an **unchained** caller's seen-suppression is
 * dropped rather than allowed to starve the feed. Deliberately well under a
 * full page: the point is to rescue a viewer who would otherwise see nothing,
 * not to stop suppressing at the first sign of a small pool.
 *
 * A chained caller does not use this threshold at all — see the staged
 * exclusion in `createSession`, where the chain itself guarantees no repeat
 * inside the browse and the trigger can therefore be far more generous.
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
    private readonly userRelationshipService: UserRelationshipService,
    private readonly chainService: RecommendationChainService
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
   * Build a brand-new ranked session.
   *
   * ## Staged exclusion — why there is no "minimum pool" cliff any more
   *
   * `deploy-2026-09-06g` excluded the union of the chain's served posts and the
   * subject's `recentlySeenPostIds`, and dropped the whole suppression only
   * once fewer than ten candidates survived. Two production failures came
   * straight out of that, on a 160-post corpus:
   *
   * - Home stopped at 89. Session 1 served 70; session 2's pool was
   *   160 − (71 already in `recentlySeenPostIds` from earlier browsing ∪ 70 in
   *   the chain) = 19, so it served 19; session 3 relaxed to the whole corpus
   *   and returned only posts already on screen, which the client discarded as
   *   duplicates and reported as exhaustion.
   * - A reload then stopped at 11. `recentlySeenPostIds` held ~149 distinct ids
   *   by then, so the very first session of a brand-new chain had a pool of 11
   *   — and 11 is *not* below the threshold of 10, so nothing relaxed.
   *
   * The mistake was treating a soft, cross-session, impression-driven memory as
   * a hard constraint on a fresh browse. So exclusion is now staged, and each
   * stage is a weaker preference rather than a cliff:
   *
   * 1. **chain ∪ recently-seen** — the strongest preference. Used whenever it
   *    can still fill a session.
   * 2. **chain only** — `recentlySeenPostIds` is what the subject saw *some
   *    time ago*; it must never starve the browse happening now. This stage is
   *    also what returns a genuinely short final batch instead of declaring the
   *    feed finished.
   * 3. **exhausted** — when the chain has served every eligible post the browse
   *    is finished, and says so. It does **not** recycle and hand the same
   *    catalogue out again: that shipped in `deploy-2026-09-06h` and, because a
   *    recycled post carried a per-cycle render key, the client appended it as
   *    new — Home reached **410 cards** on a 160-post corpus.
   *
   * Without a chain (an older client, or Redis down) stage 1 falls back to the
   * pre-chain behaviour: prefer unseen, and relax completely rather than serve
   * nothing.
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
    /** The browsing chain, already resolved and subject-checked. */
    chain: BrowsingChainState | null;
  }): Promise<{ sessionId: string; ranked: ScoredCandidate[]; chainExhausted: boolean }> {
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

    const sessionLimit = params.feedType === RECOMMENDATION_FEED_TYPES.FOR_YOU
      ? SESSION_OUTPUT_POLICY.forYouInitialSessionLimit
      : SESSION_OUTPUT_POLICY.homeSessionItemLimit;

    const seenAcrossHistory = (affinity?.recentlySeenPostIds || []).map((id: any) => id.toString());
    const chain = params.chain;
    const seenInChain = chain ? chain.seenPostIds : [];

    // Stage 1 — the strongest preference.
    let pool = await retrieveWith(unique([...seenInChain, ...seenAcrossHistory]));

    /*
     * Stage 2 — the cross-session memory is a preference, never a constraint on
     * the browse happening now. This is also the stage that returns a short
     * final batch rather than nothing.
     *
     * Gated on having a chain, because without one it *is* the blanket
     * relaxation, and dropping the suppression as soon as the pool dips below a
     * session's worth would throw away cross-session variety for every
     * unchained caller. Chained callers get the generous trigger precisely
     * because the chain still guarantees they never see a repeat inside this
     * browse.
     */
    if (chain && pool.all.length < sessionLimit && seenAcrossHistory.length) {
      const chainOnly = await retrieveWith(seenInChain);
      if (chainOnly.all.length > pool.all.length) pool = chainOnly;
    }

    /*
     * Stage 3 — the chain has served everything eligible, so this browse is
     * over. Reported, not papered over: recycling here is what produced a Home
     * feed of 410 cards on a 160-post corpus.
     */
    const chainExhausted = Boolean(chain) && !pool.all.length && seenInChain.length > 0;
    if (chainExhausted) {
      this.logger.log(
        `Browsing chain exhausted (${params.feedType}): ${seenInChain.length} posts served`
      );
    }
    // A chain that has served more than the ceiling is treated the same way —
    // bounding Redis, and by then the viewer has seen more than enough.
    const chainAtCeiling = Boolean(chain) && seenInChain.length >= CHAIN_POLICY.maxSeenIds;

    /*
     * Seen-suppression must never be able to empty the feed.
     *
     * This is the unchained fallback — an older client, or Redis unavailable so
     * `chain` is null. `recentlySeenPostIds` is a ring buffer of the last 200
     * posts served, and an engaged viewer on a small catalogue can be shown
     * *everything*: measured at 140 distinct seen posts out of 160 active, of
     * which 10 were the viewer's own, leaving nothing eligible and rendering
     * "Your Feed is Empty" to somebody whose only crime was using the product a
     * lot. Repeating a post is a much smaller failure than showing none.
     */
    if (pool.all.length < RELAXED_SUPPRESSION_MIN_POOL && !chain && seenAcrossHistory.length) {
      const relaxed = await retrieveWith([]);
      if (relaxed.all.length > pool.all.length) {
        this.logger.log(
          `Relaxed seen-suppression (${params.subject.viewerId ? 'account' : 'guest'}, unchained): `
          + `${pool.all.length} candidates with ${seenAcrossHistory.length} suppressed, `
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
     *
     * A session shorter than `sessionLimit` is a normal outcome, not a fault:
     * it means the chain has nearly run out of unseen posts, and those few are
     * exactly what should be served next.
     */
    const ranked = this.diversityService.rerank(candidateOrder, {
      lead: hero, limit: sessionLimit, preserveOrder: true
    });

    const heroId = hero?.post._id.toString();
    if (heroId && this.isPersistentSubject(params.subject)) {
      await this.selectionService.rememberHero(params.feedType, subjectId, heroId);
    }

    const { sessionId, postIds } = await this.sessionService.create({
      subjectId,
      feedType: params.feedType,
      topicKey: params.topicKey,
      sessionSeed,
      ranked,
      chainId: chain?.chainId
    });

    if (chain && postIds.length) {
      // Recorded when the order is fixed, not when the client reports an
      // impression: telemetry is best-effort and lands late, and a rollover
      // racing it would re-rank the page still on screen.
      await this.chainService.recordServed(params.feedType, chain.chainId, postIds);
    }

    return { sessionId, ranked, chainExhausted: chainExhausted || chainAtCeiling };
  }

  /**
   * Get a feed page.
   *
   * - `sessionId` + `cursor` continues an existing session (stable pagination).
   * - No `sessionId` starts a brand-new ranked session. With a `chainId` it
   *   joins that browse; without one it is unchained.
   * - `sessionId` + `rollover` starts a *successor* session: a new ranking, a
   *   new mix, and everything the chain has already served excluded. This is
   *   what makes an infinite scroll continue past one session's end without
   *   either repeating itself or turning the session into the whole catalogue.
   *
   * The chain id comes from the **client**, one per page load per surface, so a
   * reload is a fresh browse and two tabs never consume each other's catalogue.
   * It is deliberately neither the subject nor a session id.
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
    /** Client-minted browsing chain id — one per page load per surface. */
    chainId?: string;
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
     * A rollover skips the page read entirely. Reading the exhausted session
     * first would answer with its last page again, which is precisely the
     * repeat this exists to avoid.
     */
    if (params.sessionId && !params.rollover) {
      const page = await this.sessionService.getPage(params.sessionId, subjectId, params.cursor || null, params.limit);
      if (page) {
        const data = await this.reorderByIds(page.items.map((item: FeedSessionItem) => item.postId));
        return {
          sessionId: page.sessionId,
          data,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          chainId: page.chainId,
          chainExhausted: false
        };
      }
      // Session missing/expired/mismatched — degrade to a fresh session rather than erroring.
    }

    // Resolved once per request, and bound to this subject: a chain id naming
    // somebody else's browse resolves to null, so a guessed id can never reveal
    // what another viewer was shown.
    const chain = await this.chainService.resolve(params.chainId, subjectId, params.feedType);

    const { sessionId, ranked, chainExhausted } = await this.createSession({
      feedType: params.feedType, subject: params.subject, topicKey: params.topicKey, subjectId, chain
    });
    const page = await this.sessionService.getPage(sessionId, subjectId, null, params.limit);
    const data = await this.reorderByIds((page?.items || []).map((item) => item.postId));

    const result: RecommendationFeedResult = {
      sessionId,
      data,
      hasMore: Boolean(page?.hasMore),
      nextCursor: page?.nextCursor ?? null,
      chainId: chain?.chainId ?? null,
      chainExhausted
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
      .limit(DETAIL_SESSION_POLICY.candidatePoolSize)
      .lean();

    // Nothing eligible left: the session is exhausted. The caller reports this
    // as "no next", which is what disables the control — never a wrap to the
    // beginning, which would silently re-serve posts already in `state.items`.
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

    /*
     * Choose from the top of the ranking, seeded by the session — not `scored[0]`.
     *
     * `scored[0]` is a *deterministic* function of the catalogue and the
     * viewer's affinities. The per-session seed only reaches the score through
     * `sessionJitter`, worth at most 0.03, which is far too little to reorder
     * the head — so every popup session on the same catalogue served the same
     * post, then the same second post, and so on. Two unrelated sessions
     * replayed an identical A-B-C, which is the defect being fixed.
     *
     * The seed is `sessionSeed:step`, so:
     *   - a given session is fully reproducible (the same seed replays the same
     *     sequence — required for history, pagination and debugging);
     *   - two sessions diverge from the first step;
     *   - nothing calls `Math.random()`, which could not be replayed at all.
     *
     * The window is the top `selectionWindow` candidates, so the choice is
     * always among posts the ranking already rated highest. Scoring,
     * eligibility, blocked creators, already-served exclusion and the video-only
     * filter are all applied before this point and are unaffected.
     */
    const window = scored.slice(0, DETAIL_SESSION_POLICY.selectionWindow);
    const step = state.items.length;
    const best = window[pickWeightedByRank(
      window.length,
      seededUnitInterval(`${state.sessionSeed}:${step}`),
      DETAIL_SESSION_POLICY.selectionRankDecay
    )];

    const updated = await this.detailSessionService.appendAndAdvance(sessionId, subjectId, {
      postId: best.post._id.toString(), source: best.source
    });
    if (!updated) return null;
    return { postId: updated.items[updated.cursorIndex].postId };
  }
}
