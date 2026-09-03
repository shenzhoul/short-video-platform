import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/** Every event type the recommender consumes. See rules/api.md §9.1. */
export const RECOMMENDATION_EVENT_TYPES = {
  IMPRESSION: 'impression',
  VIEW: 'view',
  WATCH_PROGRESS: 'watch_progress',
  FINAL_WATCH: 'final_watch',
  COMPLETION: 'completion',
  REPLAY: 'replay',
  QUICK_SKIP: 'quick_skip',
  PHOTO_DWELL: 'photo_dwell',
  DETAIL_OPEN: 'detail_open',
  LIKE: 'like',
  COMMENT: 'comment',
  SHARE: 'share',
  FOLLOW_AFTER_VIEW: 'follow_after_view'
} as const;
export type RecommendationEventType = typeof RECOMMENDATION_EVENT_TYPES[keyof typeof RECOMMENDATION_EVENT_TYPES];
export const RECOMMENDATION_EVENT_TYPE_LIST = Object.values(RECOMMENDATION_EVENT_TYPES);

/**
 * Raw recommendation telemetry — an audit/reconciliation log, not a read path.
 *
 * Never queried by the scorer. `RecommendationEventService` writes here for
 * traceability and TTLs the rows out (`expireAfterSeconds: 0` against
 * `expiresAt`, the same absolute-instant pattern as `AuthToken`) while doing
 * its *real* work as small atomic increments against
 * `PostRecommendationStat`/`UserRecommendationAffinity` in the same request.
 * Keeping this collection bounded and disposable is what lets it exist at all
 * under "do not compute heavy statistics against raw transactional
 * collections" (rules/shared.md).
 */
@Schema({
  collection: 'recommendation_events',
  timestamps: { createdAt: true, updatedAt: false }
})
export class RecommendationEvent {
  /** Authenticated user id; null for a guest/anonymous-session event. */
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  userId: ObjectId | null;

  /** Anonymous session id, present when `userId` is null. */
  @Prop({ type: String, default: null })
  anonymousId: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  postId: ObjectId;

  /** The feed/detail recommendation session this exposure belongs to. */
  @Prop({ type: String, required: true })
  sessionId: string;

  @Prop({
    type: String,
    required: true,
    enum: RECOMMENDATION_EVENT_TYPE_LIST
  })
  eventType: RecommendationEventType;

  /** Which surface produced the event — drives per-surface debug/observability breakdowns. */
  @Prop({ type: String, required: true })
  source: string;

  /** Server-clamped watched milliseconds, for watch/completion/replay events. */
  @Prop({ type: Number, default: null })
  watchMs: number | null;

  /** The post's real media duration in ms, as known server-side, for clamping. */
  @Prop({ type: Number, default: null })
  durationMs: number | null;

  /** watchMs / durationMs, clamped to [0,1]. */
  @Prop({ type: Number, default: null })
  watchRatio: number | null;

  /** Dwell milliseconds, for photo_dwell events. */
  @Prop({ type: Number, default: null })
  dwellMs: number | null;

  /**
   * Idempotency key for this exposure — set only on events that must dedupe
   * (impression, completion, detail_open). Left undefined for events that are
   * legitimately repeatable (watch_progress, replay), so the partial index
   * below never has to reason about which "duplicate" is correct.
   */
  @Prop({ type: String, default: undefined })
  dedupeKey?: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export type RecommendationEventDocument = HydratedDocument<RecommendationEvent>;
export const RecommendationEventSchema = SchemaFactory.createForClass(RecommendationEvent);

RecommendationEventSchema.index({ expiresAt: 1 }, { name: 'ttl_recommendation_event', expireAfterSeconds: 0 });
RecommendationEventSchema.index({ sessionId: 1, postId: 1, eventType: 1 }, { name: 'idx_recommendation_event_session_post' });
/**
 * Idempotent replay protection. Partial rather than sparse: per rules/api.md,
 * `default: null` on an indexed field would still index every row, and
 * `sparse` alone would let two explicit `null`s collide. `dedupeKey` is left
 * `undefined` (never `null`) on non-deduped events, so the partial filter
 * cleanly scopes the unique constraint to only the rows that opt in.
 */
RecommendationEventSchema.index(
  { dedupeKey: 1 },
  {
    name: 'uq_recommendation_event_dedupe',
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: 'string' } }
  }
);
