import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ObjectId } from 'mongodb';
import {
  AFFINITY_EVENT_WEIGHTS,
  ENGAGEMENT_WEIGHTS,
  FOLLOW_AFTER_VIEW_POLICY,
  RECOMMENDATION_EVENT_POLICY,
  WATCH_QUALITY_POLICY
} from 'src/common/constants/recommendation';
import {
  Comment, CommentDocument, Post, PostDocument, PostMedia, PostMediaDocument
} from 'src/schemas';
import {
  PostRecommendationStat,
  PostRecommendationStatDocument,
  RecommendationEvent,
  RecommendationEventDocument,
  RECOMMENDATION_EVENT_TYPES,
  RecommendationEventType
} from 'src/schemas/content/recommendation';
import { RecommendationEventItemPayload } from 'src/payloads/content/post/recommendation-event.payload';
import { FollowService } from 'src/services/community/follow';
import { RecommendationAffinityService } from './recommendation-affinity.service';

/**
 * Name of the unique index that implements replay protection.
 *
 * A collision on *this* index is the dedupe doing its job, not a failure. Any
 * other duplicate key is a real conflict and must still be reported.
 */
const DEDUPE_INDEX = 'uq_recommendation_event_dedupe';

/** One write error out of an unordered bulk insert, in either driver shape. */
export interface BulkWriteErrorLike {
  code?: number;
  keyPattern?: Record<string, unknown>;
  errmsg?: string;
  err?: { code?: number; keyPattern?: Record<string, unknown>; errmsg?: string };
}

/**
 * Whether a write error is the replay-protection index rejecting a duplicate.
 *
 * Checked by `keyPattern.dedupeKey` — and by the index name when the driver
 * supplies only a message — rather than by `code === 11000` alone, so a
 * collision on some *other* unique index is never silently swallowed as an
 * expected no-op. That is the failure mode `.agents/rules/api.md` warns about.
 */
export function isDedupeCollision(error: BulkWriteErrorLike): boolean {
  const detail = error?.err ?? error;
  if (detail?.code !== 11000) return false;
  if (detail.keyPattern && Object.prototype.hasOwnProperty.call(detail.keyPattern, 'dedupeKey')) return true;
  // Older drivers report only the message; fall back to the index name, never
  // to the bare code.
  return typeof detail.errmsg === 'string' && detail.errmsg.includes(DEDUPE_INDEX);
}

/**
 * Split an unordered bulk-write rejection into "the dedupe index refused a
 * replay" and everything else.
 *
 * `insertMany(..., { ordered: false })` rejects if *any* document failed, so a
 * single expected replay used to be reported as "partial failures" at WARN,
 * with the full dedupe key. On a live feed that is one warning per concurrent
 * duplicate — the log in this repo showed several per minute, all of them the
 * system working correctly.
 */
export function partitionWriteErrors(error: any): { deduped: number; other: BulkWriteErrorLike[] } {
  const writeErrors: BulkWriteErrorLike[] = Array.isArray(error?.writeErrors)
    ? error.writeErrors
    : (error?.code === 11000 || error?.err?.code === 11000 ? [error] : []);
  if (!writeErrors.length) return { deduped: 0, other: [error] };

  const other = writeErrors.filter((entry) => !isDedupeCollision(entry));
  return { deduped: writeErrors.length - other.length, other };
}

/** A short, stable, non-reversible tag for a value that must never be logged. */
export function shortHash(value: string | null | undefined): string {
  if (!value) return 'none';
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

/**
 * Metadata for one prepared insert, held at exactly the index the document
 * occupies in the `insertMany` array.
 *
 * This is the whole point: Mongo reports a rejection as `writeErrors[].index`
 * into the array we submitted, so the only reliable way back to *what* was
 * rejected is an array we built alongside it. Recovering it from the error
 * instead does not work — `keyValue` is populated by some driver paths and not
 * others, which is why every collision in the review log read as `#unknown`
 * despite the event type being known.
 */
export interface PreparedInsertMeta {
  operationIndex: number;
  eventType: string;
  dedupeKeyHash: string;
  sessionIdHash: string;
  postId: string;
  exposureIdHash: string;
  batchId: string;
  requestId: string;
  path: 'insert' | 'update';
}

/**
 * A short, non-sensitive description of which events collided.
 *
 * Every field is either an id that is already public (the post) or a hash, so
 * a subject id, a token or a whole dedupe key is never written. `index` maps
 * into `meta`, which was built beside `insertDocs`; the error's own `keyValue`
 * is only a fallback for the case where Mongo rejected something we did not
 * prepare, which would itself be a bug worth seeing.
 */
function summariseDedupeCollisions(error: any, meta: PreparedInsertMeta[]): string {
  const writeErrors: any[] = Array.isArray(error?.writeErrors) ? error.writeErrors : [error];
  const parts = writeErrors.slice(0, 5).map((entry) => {
    const detail = entry?.err ?? entry;
    const index = typeof detail?.index === 'number' ? detail.index : null;
    const row = index !== null ? meta[index] : null;
    if (row) {
      return `${row.eventType}#${row.dedupeKeyHash}`
        + ` op=${row.operationIndex} post=${row.postId} session=${row.sessionIdHash}`
        + ` exposure=${row.exposureIdHash} batch=${row.batchId} req=${row.requestId} path=${row.path}`;
    }
    // No prepared row for this index: say so explicitly rather than printing
    // `unknown`, which reads like a missing event type rather than a missing
    // mapping.
    const fallbackKey = detail?.keyValue?.dedupeKey;
    return `unmapped-operation#${shortHash(fallbackKey)} op=${index === null ? 'none' : index}`;
  });
  return parts.length ? `[${parts.join(' | ')}]` : '';
}

/** Event types deduped per (session, post, type) — one exposure, one count, retries are no-ops. */
const DEDUPED_EVENT_TYPES = new Set<RecommendationEventType>([
  RECOMMENDATION_EVENT_TYPES.IMPRESSION,
  RECOMMENDATION_EVENT_TYPES.VIEW,
  RECOMMENDATION_EVENT_TYPES.FINAL_WATCH,
  RECOMMENDATION_EVENT_TYPES.COMPLETION,
  RECOMMENDATION_EVENT_TYPES.REPLAY,
  RECOMMENDATION_EVENT_TYPES.QUICK_SKIP,
  RECOMMENDATION_EVENT_TYPES.PHOTO_DWELL,
  RECOMMENDATION_EVENT_TYPES.DETAIL_OPEN,
  RECOMMENDATION_EVENT_TYPES.LIKE,
  RECOMMENDATION_EVENT_TYPES.COMMENT,
  RECOMMENDATION_EVENT_TYPES.SHARE,
  RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW
]);

/**
 * Deduped event types whose *later* flush for the same exposure legitimately
 * carries more information than the earlier one, and must correct it rather
 * than be silently dropped.
 *
 * A viewer who pauses at 2s (an early `final_watch` flush trigger), then
 * resumes and watches to completion before finally leaving, produces two
 * `final_watch` events with the same `(subject, session, post, eventType)`
 * dedupe key. Treating the second as a plain duplicate — the original
 * behavior here — permanently locks in the *smaller* of the two watch
 * measurements, silently under-reporting exactly the engaged viewers this
 * signal exists to reward. These two event types are instead "upserted": a
 * repeat flush replaces the stored watch/dwell value and applies the
 * *delta* to `PostRecommendationStat` (not a second full increment, which
 * would double count), and corrects `quickSkips`/affinity if the improved
 * number crosses the quick-skip threshold the other way.
 */
const UPDATABLE_EVENT_TYPES = new Set<RecommendationEventType>([
  RECOMMENDATION_EVENT_TYPES.FINAL_WATCH,
  RECOMMENDATION_EVENT_TYPES.PHOTO_DWELL
]);

interface ExistingEventRecord {
  _id: any;
  watchMs: number | null;
  durationMs: number | null;
  watchRatio: number | null;
  dwellMs: number | null;
}

export interface RecommendationEventActor {
  userId?: string;
  anonymousId?: string;
}

export interface IngestResult {
  accepted: number;
  deduped: number;
  rejected: number;
}

interface PostLookup {
  userId: ObjectId;
  topicKey: string | null;
  tags: string[];
  isPhoto: boolean;
  isVideo: boolean;
  /**
   * Server-authoritative duration of the post's primary (`ordering: 0`)
   * video item, in ms — `null` when the post is not a video, or predates
   * `PostMediaService`'s duration capture and has not been backfilled (see
   * `scripts/backfill-post-media-duration.js`). Never a client-reported
   * value. A post with more than one video (a carousel) is tracked as a
   * single watch signal against its first item, matching the frontend,
   * which likewise mounts and tracks only one `<video>` per post.
   */
  canonicalDurationMs: number | null;
}

/**
 * Ingests recommendation telemetry: validates, clamps, dedupes, and turns it
 * into (a) a disposable raw audit row and (b) small atomic increments against
 * `PostRecommendationStat` / `UserRecommendationAffinity`.
 *
 * All twelve event types the frontend can send funnel through here — including
 * `like`/`comment`/`share`/`follow_after_view`. Those are *not* how the
 * platform's real counters (`Post.totalLike`, etc.) are maintained — that
 * stays owned by `ReactionService`/`CommentService`/`PostShareService`,
 * unchanged. This is a second, recommendation-scoped signal the client fires
 * alongside the real action, carrying context (`sessionId`, `source`) the
 * generic reaction pub/sub events do not — which is also why this service
 * never subscribes to `REACTION_CHANNELS`/`COMMENT_CHANNELS`/`SHARE_CHANNELS`
 * itself: `SHARE_CHANNELS.SHARE` in particular only publishes on a *retry*
 * path (see `PostShareRecordListener`), not on every share, so it cannot be
 * used as a complete engagement source.
 */
@Injectable()
export class RecommendationEventService {
  private readonly logger = new Logger(RecommendationEventService.name);

  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>,
    @InjectModel(PostMedia.name) private readonly postMediaModel: Model<PostMediaDocument>,
    @InjectModel(PostRecommendationStat.name) private readonly statModel: Model<PostRecommendationStatDocument>,
    @InjectModel(RecommendationEvent.name) private readonly eventModel: Model<RecommendationEventDocument>,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    private readonly affinityService: RecommendationAffinityService,
    private readonly followService: FollowService
  ) { }

  private dedupeKeyFor(subjectId: string, item: RecommendationEventItemPayload, creatorId?: string): string | undefined {
    if (!DEDUPED_EVENT_TYPES.has(item.eventType)) return undefined;
    if (item.eventType === RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW) {
      // Deliberately *not* session/post-scoped: a follow is attributed to a
      // recommendation exposure at most once, ever, per (subject, creator) —
      // otherwise unfollowing and refollowing the same creator in a fresh
      // session would re-earn the signal every time. See
      // `validateFollowAfterView` and rules/instructions §3.
      return `${subjectId}:${creatorId}:${item.eventType}`;
    }
    if (item.eventType === RECOMMENDATION_EVENT_TYPES.REPLAY) {
      // Replay is legitimately repeatable within one exposure, so it cannot
      // use the plain "one per (subject, session, post, type)" key every
      // other deduped type uses — that would collapse every real replay
      // into the first one. Instead the key is scoped to one *occurrence*
      // (`clientExposureId`, generated once per detected replay crossing on
      // the client and reused on any queue-level retry of that same event),
      // so a retry of occurrence #2 dedupes while occurrence #3 is new.
      // Without a `clientExposureId` (older client) there is nothing to key
      // an occurrence on, so dedup is skipped for that item rather than
      // guessed at — `maxReplaysCountedPerExposure` below still bounds its
      // scoring impact.
      if (!item.clientExposureId) return undefined;
      return `${subjectId}:${item.sessionId}:${item.postId}:${item.eventType}:${item.clientExposureId}`;
    }
    if (item.eventType === RECOMMENDATION_EVENT_TYPES.COMMENT) {
      // Keyed on the *real, server-verified* comment id rather than the
      // session: one comment is one signal, forever. A retry of the same
      // submission carries the same `commentId` and dedupes; a genuinely
      // second comment on the same post in the same session is a second
      // signal (bounded by `maxCommentsCountedPerPost`). Deliberately not
      // session-scoped — reopening the post in a new session and resending
      // the same comment id must not re-earn it.
      return `${subjectId}:${item.postId}:${item.eventType}:${item.commentId}`;
    }
    return `${subjectId}:${item.sessionId}:${item.postId}:${item.eventType}`;
  }

  /**
   * Verifies a client-claimed `comment` signal against the real comment
   * (rules/instructions §2) — the event type and a post id are never enough
   * on their own, or any client could mint comment-weighted affinity for any
   * post without ever writing one.
   *
   * - `commentId` must be present and must resolve to a comment that exists.
   * - It must have been written by this exact authenticated actor
   *   (`createdBy`), not merely be *some* comment on the post.
   * - It must belong to this post: directly for a root comment
   *   (`objectType: 'post'`), or through its parent for a reply
   *   (`objectType: 'comment'` -> that comment's own `objectId`). A reply is
   *   therefore attributed to the post exactly once, as one comment signal —
   *   never as a root comment *and* a reply.
   */
  private async validateComment(
    actor: RecommendationEventActor,
    item: RecommendationEventItemPayload
  ): Promise<boolean> {
    if (!actor.userId || !item.commentId) return false;

    const comment: any = await this.commentModel
      .findById(item.commentId)
      .select({ createdBy: 1, objectId: 1, objectType: 1 })
      .lean();
    if (!comment) return false;
    if (comment.createdBy?.toString() !== actor.userId) return false;

    if (comment.objectType === 'post') return comment.objectId?.toString() === item.postId;

    if (comment.objectType === 'comment') {
      const parent: any = await this.commentModel
        .findById(comment.objectId)
        .select({ objectId: 1, objectType: 1 })
        .lean();
      return parent?.objectType === 'post' && parent?.objectId?.toString() === item.postId;
    }

    return false;
  }

  /**
   * Verifies a client-claimed `follow_after_view` against the real
   * relationship and a real prior exposure, rather than trusting the event
   * type outright (rules/instructions §3). Returns the follow's own
   * timestamp when the signal is legitimate, `null` otherwise.
   *
   * - The follow must actually exist right now (`FollowService.getFollowedAt`
   *   — not merely claimed).
   * - It must target the post's own creator (implicit: `post.userId` is what
   *   is checked, not anything the client sends).
   * - A recommendation exposure (impression, view, or a detail open) for
   *   this exact post, by this exact subject, must have happened within
   *   `attributionWindowMs` *before* the follow.
   */
  private async validateFollowAfterView(
    actor: RecommendationEventActor,
    item: RecommendationEventItemPayload,
    post: PostLookup
  ): Promise<Date | null> {
    if (!actor.userId) return null; // Guests cannot follow; nothing to attribute.
    if (actor.userId === post.userId.toString()) return null; // Cannot follow yourself.

    const followedAt = await this.followService.getFollowedAt(actor.userId, post.userId);
    if (!followedAt) return null;

    const windowStart = new Date(followedAt.getTime() - FOLLOW_AFTER_VIEW_POLICY.attributionWindowMs);
    const priorExposure = await this.eventModel.exists({
      userId: new ObjectId(actor.userId),
      postId: new ObjectId(item.postId),
      eventType: {
        $in: [RECOMMENDATION_EVENT_TYPES.IMPRESSION, RECOMMENDATION_EVENT_TYPES.VIEW, RECOMMENDATION_EVENT_TYPES.DETAIL_OPEN]
      },
      createdAt: { $gte: windowStart, $lte: followedAt }
    });

    return priorExposure ? followedAt : null;
  }

  /**
   * Clamps and rates a reported watch. `canonicalDurationMs` — from
   * `PostMedia.durationMs`, ffprobe-derived at file-server, never from the
   * request — is the only duration ever used to compute `watchRatio`; the
   * client's own `item.durationMs` is not read here at all.
   *
   * A post with no canonical duration yet (predates the backfill — see
   * `PostLookup.canonicalDurationMs`'s doc) falls back to the policy in
   * rules/instructions §2.3: the clamped raw `watchMs` is still kept (for
   * `watchQuality`'s cold, low-confidence signal and for the raw audit log,
   * which a future backfill run can reprocess), clamped to a safe absolute
   * ceiling instead of a per-video duration since none is trusted — but no
   * `watchRatio` is produced, which is what excludes the sample from
   * completion/quick-skip classification in `finalWatchEffects`.
   */
  private clampWatch(
    item: RecommendationEventItemPayload,
    canonicalDurationMs: number | null
  ): { watchMs: number | null; durationMs: number | null; watchRatio: number | null } {
    if (item.watchMs === undefined) return { watchMs: null, durationMs: null, watchRatio: null };
    const floored = Math.max(0, item.watchMs);

    if (canonicalDurationMs && canonicalDurationMs > 0) {
      const ceiling = canonicalDurationMs + RECOMMENDATION_EVENT_POLICY.maxWatchMsOverDurationSlackMs;
      const clamped = Math.min(floored, ceiling);
      return { watchMs: clamped, durationMs: canonicalDurationMs, watchRatio: Math.min(1, clamped / canonicalDurationMs) };
    }

    return {
      watchMs: Math.min(floored, RECOMMENDATION_EVENT_POLICY.legacyMaxWatchMsWithoutCanonicalDuration),
      durationMs: null,
      watchRatio: null
    };
  }

  private isVideoQuickSkip(ratio: number, watchMs: number): boolean {
    return ratio < WATCH_QUALITY_POLICY.video.quickSkipMaxRatio && watchMs < WATCH_QUALITY_POLICY.video.quickSkipMaxMs;
  }

  private isPhotoQuickSkip(dwellMs: number): boolean {
    return dwellMs < WATCH_QUALITY_POLICY.photo.quickSkipMaxMs;
  }

  /**
   * `final_watch` effects, aware of a possible earlier flush for the same
   * exposure (see `UPDATABLE_EVENT_TYPES`). A fresh exposure gets the usual
   * full increment; a repeat flush applies only the *delta* against the
   * previously stored value, and corrects `quickSkips`/affinity if the
   * improved number crosses the quick-skip line the other way. A flush
   * reporting *less* watch than already on record (clock skew, an
   * out-of-order retry) is treated as a no-op rather than allowed to regress
   * a real number — the higher-watermark data point already stored wins.
   */
  private finalWatchEffects(
    watchMs: number | null,
    watchRatio: number | null,
    existing: ExistingEventRecord | null
  ): { inc: Record<string, number>; affinityWeight: number; skip: boolean } {
    if (watchRatio === null) return { inc: {}, affinityWeight: 0, skip: true };

    if (!existing) {
      const quickSkip = this.isVideoQuickSkip(watchRatio, watchMs ?? 0);
      return {
        inc: { watchRatioSum: watchRatio, watchSampleCount: 1, ...(quickSkip ? { quickSkips: 1 } : {}) },
        affinityWeight: quickSkip ? AFFINITY_EVENT_WEIGHTS.quickSkip : AFFINITY_EVENT_WEIGHTS.watchQuality * watchRatio,
        skip: false
      };
    }

    const oldRatio = existing.watchRatio ?? 0;
    if (watchRatio <= oldRatio) return { inc: {}, affinityWeight: 0, skip: true };

    const oldQuickSkip = this.isVideoQuickSkip(oldRatio, existing.watchMs ?? 0);
    const newQuickSkip = this.isVideoQuickSkip(watchRatio, watchMs ?? 0);
    const inc: Record<string, number> = { watchRatioSum: watchRatio - oldRatio };
    if (oldQuickSkip !== newQuickSkip) inc.quickSkips = newQuickSkip ? 1 : -1;

    const oldWeight = oldQuickSkip ? AFFINITY_EVENT_WEIGHTS.quickSkip : AFFINITY_EVENT_WEIGHTS.watchQuality * oldRatio;
    const newWeight = newQuickSkip ? AFFINITY_EVENT_WEIGHTS.quickSkip : AFFINITY_EVENT_WEIGHTS.watchQuality * watchRatio;

    return { inc, affinityWeight: newWeight - oldWeight, skip: false };
  }

  /** `photo_dwell` effects — same delta-on-repeat-flush shape as `finalWatchEffects`, see its doc. */
  private photoDwellEffects(
    dwellMsRaw: number,
    existing: ExistingEventRecord | null
  ): { inc: Record<string, number>; affinityWeight: number; skip: boolean } {
    const dwellMs = Math.max(0, Math.min(dwellMsRaw, 5 * 60 * 1000));

    if (!existing) {
      const quickSkip = this.isPhotoQuickSkip(dwellMs);
      const ratio = Math.min(1, dwellMs / WATCH_QUALITY_POLICY.photo.strongDwellMs);
      return {
        inc: { dwellMsSum: dwellMs, dwellSampleCount: 1, ...(quickSkip ? { quickSkips: 1 } : {}) },
        affinityWeight: quickSkip ? AFFINITY_EVENT_WEIGHTS.quickSkip : AFFINITY_EVENT_WEIGHTS.photoDwell * ratio,
        skip: false
      };
    }

    const oldDwell = existing.dwellMs ?? 0;
    if (dwellMs <= oldDwell) return { inc: {}, affinityWeight: 0, skip: true };

    const oldQuickSkip = this.isPhotoQuickSkip(oldDwell);
    const newQuickSkip = this.isPhotoQuickSkip(dwellMs);
    const inc: Record<string, number> = { dwellMsSum: dwellMs - oldDwell };
    if (oldQuickSkip !== newQuickSkip) inc.quickSkips = newQuickSkip ? 1 : -1;

    const oldRatio = Math.min(1, oldDwell / WATCH_QUALITY_POLICY.photo.strongDwellMs);
    const newRatio = Math.min(1, dwellMs / WATCH_QUALITY_POLICY.photo.strongDwellMs);
    const oldWeight = oldQuickSkip ? AFFINITY_EVENT_WEIGHTS.quickSkip : AFFINITY_EVENT_WEIGHTS.photoDwell * oldRatio;
    const newWeight = newQuickSkip ? AFFINITY_EVENT_WEIGHTS.quickSkip : AFFINITY_EVENT_WEIGHTS.photoDwell * newRatio;

    return { inc, affinityWeight: newWeight - oldWeight, skip: false };
  }

  public async ingest(items: RecommendationEventItemPayload[], actor: RecommendationEventActor): Promise<IngestResult> {
    const subjectId = actor.userId || actor.anonymousId;
    if (!subjectId || !items.length) return { accepted: 0, deduped: 0, rejected: items.length };

    const postIds = Array.from(new Set(items.map((item) => item.postId)));
    const [posts, primaryVideoMedia] = await Promise.all([
      this.postModel
        .find({ _id: { $in: postIds } })
        .select({ userId: 1, topicKey: 1, tags: 1, type: 1, mediaTypes: 1 })
        .lean(),
      this.postMediaModel
        .find({ postId: { $in: postIds.map((id) => new ObjectId(id)) }, mediaType: 'VIDEO', ordering: 0 })
        .select({ postId: 1, durationMs: 1 })
        .lean()
    ]);

    const canonicalDurationByPostId = new Map<string, number | null>(
      primaryVideoMedia.map((media: any) => [media.postId.toString(), media.durationMs ?? null])
    );

    const postMap = new Map<string, PostLookup>();
    posts.forEach((post: any) => postMap.set(post._id.toString(), {
      userId: post.userId,
      topicKey: post.topicKey || null,
      tags: post.tags || [],
      isPhoto: post.type === 'photo' || (post.mediaTypes || []).includes('photo'),
      isVideo: post.type === 'video' || (post.mediaTypes || []).includes('video'),
      canonicalDurationMs: canonicalDurationByPostId.get(post._id.toString()) ?? null
    }));

    // `follow_after_view` cannot be trusted at face value — verify each claim
    // against the real relationship and a real prior exposure before it is
    // allowed anywhere near the dedupe/stat pipeline (rules/instructions §3).
    const followAfterViewValidation = new Map<number, boolean>();
    // Same treatment for `comment`: the claim is checked against the real
    // comment row (author, post, root-vs-reply) before it reaches the
    // dedupe/stat pipeline (rules/instructions §2).
    const commentValidation = new Map<number, boolean>();
    await Promise.all(items.map(async (item, index) => {
      const post = postMap.get(item.postId);
      if (!post) return;
      if (item.eventType === RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW) {
        const followedAt = await this.validateFollowAfterView(actor, item, post);
        followAfterViewValidation.set(index, Boolean(followedAt));
        return;
      }
      if (item.eventType === RECOMMENDATION_EVENT_TYPES.COMMENT) {
        commentValidation.set(index, await this.validateComment(actor, item));
      }
    }));

    const withDedupeKeys = items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => {
        if (!postMap.has(item.postId)) return false;
        if (item.eventType === RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW) return followAfterViewValidation.get(index) === true;
        if (item.eventType === RECOMMENDATION_EVENT_TYPES.COMMENT) return commentValidation.get(index) === true;
        return true;
      })
      .map(({ item }) => {
        const post = postMap.get(item.postId)!;
        const creatorId = item.eventType === RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW ? post.userId.toString() : undefined;
        return { item, dedupeKey: this.dedupeKeyFor(subjectId, item, creatorId) };
      });
    const rejected = items.length - withDedupeKeys.length;

    /*
     * One identity, one write — decided before anything is prepared.
     *
     * `existingByKey` below answers "is this already stored", which says
     * nothing about two copies arriving together in *this* request. Both then
     * passed the pre-check, both became inserts, and the unique index rejected
     * the second: that is the whole of the duplicate traffic observed on the
     * review API, across `photo_dwell`, `final_watch` and `detail_open`.
     *
     * For an updatable type the *last* copy is kept, because these are
     * monotonic corrections — a `final_watch` at 8s supersedes the same
     * exposure's 5s, and the server still clamps and merges it afterwards. For
     * every other type the first is kept and later copies are no-ops, which is
     * what "a retry keeps the same identity" means.
     */
    const withinBatchDuplicates = new Map<string, number>();
    const collapsed: typeof withDedupeKeys = [];
    const positionByKey = new Map<string, number>();
    withDedupeKeys.forEach((entry) => {
      const { dedupeKey, item } = entry;
      if (!dedupeKey) {
        collapsed.push(entry);
        return;
      }
      const seenAt = positionByKey.get(dedupeKey);
      if (seenAt === undefined) {
        positionByKey.set(dedupeKey, collapsed.length);
        collapsed.push(entry);
        return;
      }
      withinBatchDuplicates.set(dedupeKey, (withinBatchDuplicates.get(dedupeKey) || 0) + 1);
      if (UPDATABLE_EVENT_TYPES.has(item.eventType)) collapsed[seenAt] = entry;
    });

    const withinBatchCollapsed = Array.from(withinBatchDuplicates.values()).reduce((a, b) => a + b, 0);
    if (withinBatchDuplicates.size) {
      const collapsedCount = withinBatchCollapsed;
      const sample = Array.from(withinBatchDuplicates.keys()).slice(0, 5).map((key) => {
        const owner = withDedupeKeys.find((e) => e.dedupeKey === key)!;
        return `${owner.item.eventType}#${shortHash(key)} post=${owner.item.postId} session=${shortHash(owner.item.sessionId)}`;
      });
      this.logger.debug(
        `Recommendation events collapsed ${collapsedCount} duplicate(s) within one request `
        + `[${sample.join(' | ')}]`
      );
    }

    const candidateKeys = collapsed.map((e) => e.dedupeKey).filter(Boolean) as string[];
    const existingByKey = candidateKeys.length
      ? new Map((await this.eventModel
        .find({ dedupeKey: { $in: candidateKeys } })
        .select({
          dedupeKey: 1, watchMs: 1, durationMs: 1, watchRatio: 1, dwellMs: 1
        })
        .lean())
        .map((row: any) => [row.dedupeKey, row as ExistingEventRecord]))
      : new Map<string, ExistingEventRecord>();

    // Seeds the replay anti-spam cap from *persisted* history (not just this
    // batch), grouped by (session, post), so splitting seek-spam across
    // several requests cannot get around `maxReplaysCountedPerExposure`
    // (rules/instructions §1.3). `\u0000` is used as the join separator
    // since `sessionId` is an opaque client/Redis-generated string that is
    // not guaranteed free of `:`.
    const replayKeyFor = (sessionId: string, postId: string): string => `${sessionId}\u0000${postId}`;
    const replayCounts = new Map<string, number>();
    const replayPairs = new Map<string, { sessionId: string; postId: ObjectId }>();
    collapsed.forEach(({ item }) => {
      if (item.eventType !== RECOMMENDATION_EVENT_TYPES.REPLAY) return;
      replayPairs.set(replayKeyFor(item.sessionId, item.postId), { sessionId: item.sessionId, postId: new ObjectId(item.postId) });
    });
    if (replayPairs.size) {
      const subjectFilter = actor.userId ? { userId: new ObjectId(actor.userId) } : { anonymousId: actor.anonymousId };
      const existingReplayCounts = await this.eventModel.aggregate([
        {
          $match: {
            ...subjectFilter,
            eventType: RECOMMENDATION_EVENT_TYPES.REPLAY,
            $or: Array.from(replayPairs.values())
          }
        },
        { $group: { _id: { sessionId: '$sessionId', postId: '$postId' }, count: { $sum: 1 } } }
      ]);
      existingReplayCounts.forEach((row: any) => {
        replayCounts.set(replayKeyFor(row._id.sessionId, row._id.postId.toString()), row.count);
      });
    }

    // Same shape for the per-(subject, post) comment cap, but keyed on the
    // post alone — comments are attributed across sessions, not within one
    // (see `dedupeKeyFor`'s COMMENT branch).
    const commentCounts = new Map<string, number>();
    const commentPostIds = Array.from(new Set(
      collapsed
        .filter(({ item }) => item.eventType === RECOMMENDATION_EVENT_TYPES.COMMENT)
        .map(({ item }) => item.postId)
    ));
    if (commentPostIds.length) {
      const subjectFilter = actor.userId ? { userId: new ObjectId(actor.userId) } : { anonymousId: actor.anonymousId };
      const existingCommentCounts = await this.eventModel.aggregate([
        {
          $match: {
            ...subjectFilter,
            eventType: RECOMMENDATION_EVENT_TYPES.COMMENT,
            postId: { $in: commentPostIds.map((id) => new ObjectId(id)) }
          }
        },
        { $group: { _id: '$postId', count: { $sum: 1 } } }
      ]);
      existingCommentCounts.forEach((row: any) => {
        commentCounts.set(row._id.toString(), row.count);
      });
    }

    const statOps: any[] = [];
    const affinityWrites: Promise<void>[] = [];
    const insertDocs: Partial<RecommendationEvent>[] = [];
    /*
     * Built in lockstep with `insertDocs`, so `writeErrors[].index` resolves to
     * the event that was actually rejected. Nothing here is recoverable from
     * the Mongo error: `keyValue` is populated on some driver paths and not
     * others, which is exactly why every collision in the review log printed
     * `#unknown` while the event type was known all along.
     */
    const insertMeta: PreparedInsertMeta[] = [];
    /*
     * One id for this request and one for this batch. They are the same value
     * today — a request carries one batch — but they are reported separately
     * because a future chunked flush would make them differ, and a trace that
     * cannot tell them apart is not a trace.
     */
    const requestId = randomUUID().slice(0, 8);
    const batchId = requestId;
    const updateOps: any[] = [];
    const seenPostIds: string[] = [];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RECOMMENDATION_EVENT_POLICY.rawEventTtlDays * 24 * 60 * 60 * 1000);
    let deduped = withinBatchCollapsed;
    let accepted = 0;

    collapsed.forEach(({ item, dedupeKey }) => {
      const post = postMap.get(item.postId)!;
      const { watchMs, durationMs, watchRatio } = this.clampWatch(item, post.canonicalDurationMs);
      const existing = dedupeKey ? existingByKey.get(dedupeKey) || null : null;
      const isUpdate = Boolean(existing) && UPDATABLE_EVENT_TYPES.has(item.eventType);

      // A dedupe hit on a non-updatable type (or a regressed update — see
      // `finalWatchEffects`/`photoDwellEffects`) is a pure no-op: nothing
      // about this exposure's stats/affinity changes, and the raw event row
      // is left exactly as it was.
      if (existing && !isUpdate) {
        deduped += 1;
        return;
      }

      let inc: Record<string, number> = {};
      let affinityWeight = 0;
      let skip = false;

      switch (item.eventType) {
        case RECOMMENDATION_EVENT_TYPES.IMPRESSION:
          inc.impressions = 1;
          seenPostIds.push(item.postId);
          break;
        case RECOMMENDATION_EVENT_TYPES.VIEW:
          affinityWeight = AFFINITY_EVENT_WEIGHTS.view;
          break;
        case RECOMMENDATION_EVENT_TYPES.WATCH_PROGRESS:
          // Heartbeat only — the throttled checkpoint on pause/unmount/end is
          // what `final_watch` reports, and that is what feeds the aggregate.
          break;
        case RECOMMENDATION_EVENT_TYPES.FINAL_WATCH: {
          const effects = this.finalWatchEffects(watchMs, watchRatio, existing);
          inc = effects.inc;
          affinityWeight = effects.affinityWeight;
          skip = effects.skip;
          break;
        }
        case RECOMMENDATION_EVENT_TYPES.COMPLETION: {
          // Never trust the event *type* alone — `completion` is only ever
          // accepted when the same canonical-duration-derived ratio this
          // event's own `watchMs` produces actually clears the threshold.
          // A legacy post with no canonical duration (`watchRatio === null`)
          // can never satisfy this, matching rules/instructions §1.2's
          if (watchRatio === null || watchRatio < WATCH_QUALITY_POLICY.video.completionMinRatio) {
            skip = true;
            break;
          }
          inc.completions = 1;
          affinityWeight = AFFINITY_EVENT_WEIGHTS.watchQuality;
          break;
        }
        case RECOMMENDATION_EVENT_TYPES.REPLAY: {
          const replayKey = replayKeyFor(item.sessionId, item.postId);
          const countSoFar = replayCounts.get(replayKey) || 0;
          if (countSoFar >= RECOMMENDATION_EVENT_POLICY.maxReplaysCountedPerExposure) {
            // Beyond the cap: still a real, accepted occurrence (raw event
            // recorded for audit — see `insertDocs` below), just no further
            // scoring impact. This is what keeps a client from inflating the
            // signal by seeking start<->end repeatedly, without having to
            // reject/error on the request itself.
            skip = true;
            break;
          }
          replayCounts.set(replayKey, countSoFar + 1);
          inc.replays = 1;
          affinityWeight = AFFINITY_EVENT_WEIGHTS.watchQuality * 0.5;
          break;
        }
        case RECOMMENDATION_EVENT_TYPES.QUICK_SKIP:
          inc.quickSkips = 1;
          affinityWeight = AFFINITY_EVENT_WEIGHTS.quickSkip;
          break;
        case RECOMMENDATION_EVENT_TYPES.PHOTO_DWELL: {
          const effects = this.photoDwellEffects(item.dwellMs || 0, existing);
          inc = effects.inc;
          affinityWeight = effects.affinityWeight;
          skip = effects.skip;
          break;
        }
        case RECOMMENDATION_EVENT_TYPES.DETAIL_OPEN:
          inc.detailOpens = 1;
          affinityWeight = AFFINITY_EVENT_WEIGHTS.view;
          break;
        case RECOMMENDATION_EVENT_TYPES.LIKE:
          inc.weightedEngagement = ENGAGEMENT_WEIGHTS.like;
          affinityWeight = AFFINITY_EVENT_WEIGHTS.like;
          break;
        case RECOMMENDATION_EVENT_TYPES.COMMENT: {
          // Reaching here already means `validateComment` matched a real
          // comment this actor genuinely wrote on this post. The cap below
          // is the separate anti-inflation bound (comment/delete/repeat).
          const countSoFar = commentCounts.get(item.postId) || 0;
          if (countSoFar >= RECOMMENDATION_EVENT_POLICY.maxCommentsCountedPerPost) {
            skip = true;
            break;
          }
          commentCounts.set(item.postId, countSoFar + 1);
          inc.weightedEngagement = ENGAGEMENT_WEIGHTS.comment;
          affinityWeight = AFFINITY_EVENT_WEIGHTS.comment;
          break;
        }
        case RECOMMENDATION_EVENT_TYPES.SHARE:
          inc.weightedEngagement = ENGAGEMENT_WEIGHTS.share;
          affinityWeight = AFFINITY_EVENT_WEIGHTS.share;
          break;
        case RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW:
          inc.weightedEngagement = ENGAGEMENT_WEIGHTS.followAfterView;
          affinityWeight = AFFINITY_EVENT_WEIGHTS.followAfterView;
          break;
        default:
          break;
      }

      // A regressed/no-signal update (e.g. `final_watch` reporting less than
      // what is already on record) is a no-op, not an error.
      if (isUpdate && skip) {
        deduped += 1;
        return;
      }

      accepted += 1;

      if (Object.keys(inc).length) {
        const postObjectId = new ObjectId(item.postId);
        statOps.push({
          updateOne: {
            filter: { postId: postObjectId },
            update: {
              $inc: inc,
              $set: {
                updatedAt: now,
                creatorId: post.userId,
                topicKey: post.topicKey,
                ...(item.eventType === RECOMMENDATION_EVENT_TYPES.IMPRESSION ? { lastImpressionAt: now } : {})
              },
              $setOnInsert: { postId: postObjectId }
            },
            upsert: true
          }
        });
      }

      if (affinityWeight) {
        affinityWrites.push(this.affinityService.applyEvent({
          subjectId,
          isAuthenticatedUser: Boolean(actor.userId),
          topicKey: post.topicKey,
          tags: post.tags,
          creatorId: post.userId.toString(),
          weight: affinityWeight,
          isPhoto: post.isPhoto,
          isVideo: post.isVideo
        }));
      }

      const eventFields = {
        watchMs,
        // The server-authoritative duration actually used for `watchRatio`
        // (or `null` when none was available) — never the client's claim.
        durationMs,
        watchRatio,
        dwellMs: item.dwellMs ?? null
      };

      if (isUpdate && existing) {
        // Corrects the stored exposure's numbers in place — this is *not* a
        // new row, so it must never be counted again as a fresh sample.
        updateOps.push({
          updateOne: {
            filter: { _id: existing._id },
            update: { $set: { ...eventFields, expiresAt } }
          }
        });
      } else {
        insertMeta.push({
          operationIndex: insertDocs.length,
          eventType: item.eventType,
          dedupeKeyHash: shortHash(dedupeKey),
          // Never the session id itself: it is a Redis key segment.
          sessionIdHash: shortHash(item.sessionId),
          // A post id is already public in every URL, so it is logged plainly.
          postId: item.postId,
          exposureIdHash: shortHash(dedupeKey ? `${item.sessionId}:${item.postId}` : null),
          batchId,
          requestId,
          path: 'insert'
        });
        insertDocs.push({
          userId: actor.userId ? new ObjectId(actor.userId) : null,
          anonymousId: actor.userId ? null : actor.anonymousId || null,
          postId: new ObjectId(item.postId),
          sessionId: item.sessionId,
          eventType: item.eventType,
          source: item.source,
          ...eventFields,
          dedupeKey,
          expiresAt,
          createdAt: now
        });
      }
    });

    if (!accepted) return { accepted: 0, deduped, rejected };

    const writes: Promise<any>[] = [];
    if (statOps.length) writes.push(this.statModel.bulkWrite(statOps, { ordered: false }));
    if (seenPostIds.length) writes.push(this.affinityService.markSeen(subjectId, seenPostIds, Boolean(actor.userId)));
    writes.push(...affinityWrites);
    if (updateOps.length) {
      writes.push(this.eventModel.bulkWrite(updateOps, { ordered: false }).catch((error: any) => {
        const { deduped: replays, other } = partitionWriteErrors(error);
        if (replays) {
          this.logger.debug(`Recommendation event correction skipped ${replays} duplicate(s) (replay protection)`);
        }
        if (other.length) {
          this.logger.warn(
            `Recommendation event correction had ${other.length} unexpected failure(s): `
            + `${other.map((entry) => entry?.err?.errmsg || entry?.errmsg || (entry as any)?.message).join('; ')}`
          );
        }
      }));
    }
    if (insertDocs.length) {
      writes.push(
        this.eventModel.insertMany(insertDocs, { ordered: false }).catch((error: any) => {
          /*
           * A race against another concurrent insert of the same event throws
           * here even though the dedupe pre-check passed. That is the unique
           * index doing exactly what it exists for, so it is not a warning —
           * it is the expected outcome of two requests arriving together, and
           * the row that won is the one we wanted. The stat/affinity effects
           * above were already decided from the pre-check and are not rolled
           * back; this collection is an audit trail, not the source of truth
           * for the aggregates.
           *
           * Anything that is *not* a dedupe collision is still a real failure
           * and keeps its warning.
           */
          const { deduped: replays, other } = partitionWriteErrors(error);
          if (replays) {
            /*
             * Bounded diagnostic: enough identity to classify a collision
             * without logging the dedupe key itself.
             *
             * The key is `<subject>:<session>:<post>:<eventType>` and the
             * subject half is an account or guest id, so it is hashed. The
             * event types and the count are what say whether a repeat is a
             * `final_watch` correction, a retried batch, or two collectors
             * emitting one exposure — which a bare "skipped N duplicates"
             * could never distinguish.
             */
            const detail = summariseDedupeCollisions(error, insertMeta);
            this.logger.debug(
              `Recommendation raw event insert skipped ${replays} duplicate${replays === 1 ? '' : 's'} `
              + `(replay protection)${detail ? ` ${detail}` : ''}`
            );
          }
          if (other.length) {
            this.logger.warn(
              `Recommendation raw event insert had ${other.length} unexpected failure(s): `
              + `${other.map((entry) => entry?.err?.errmsg || entry?.errmsg || (entry as any)?.message).join('; ')}`
            );
          }
        })
      );
    }

    await Promise.all(writes);

    return { accepted, deduped, rejected };
  }
}
