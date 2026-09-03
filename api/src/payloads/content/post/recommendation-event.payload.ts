import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested
} from 'class-validator';
import { RECOMMENDATION_EVENT_TYPE_LIST, RecommendationEventType } from 'src/schemas/content/recommendation/recommendation-event.schema';
import { RECOMMENDATION_EVENT_POLICY, RecommendationFeedType } from 'src/common/constants/recommendation';

/** Surfaces a recommendation event may be attributed to. */
const RECOMMENDATION_EVENT_SOURCES = ['home', 'for-you', 'post-detail'] as const;

export class RecommendationEventItemPayload {
  @IsMongoId()
  postId: string;

  @IsString()
  sessionId: string;

  @IsEnum(RECOMMENDATION_EVENT_TYPE_LIST)
  eventType: RecommendationEventType;

  @IsIn(RECOMMENDATION_EVENT_SOURCES)
  source: RecommendationFeedType | 'post-detail';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  watchMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  durationMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dwellMs?: number;

  /**
   * Client-generated id naming one *occurrence* of a repeatable event —
   * currently `replay` (a fresh loop of the same video within one exposure).
   * A queue-level retry of the same enqueued event reuses this id, which is
   * what lets the server tell "network retry of the same replay" apart from
   * "the viewer replayed again" (rules/instructions §1.3). Also usable for
   * guest impression dedupe on the client's own retry.
   */
  @IsOptional()
  @IsString()
  clientExposureId?: string;

  /**
   * The id of the comment a `comment` event is claiming credit for. Required
   * for that event type — the server loads the real comment and checks it
   * exists, was written by the authenticated actor, and belongs to this post
   * (directly, or through its parent for a reply) before any signal is
   * applied, and uses it as the per-occurrence dedupe key so a retry cannot
   * double-count (rules/instructions §2).
   */
  @IsOptional()
  @IsMongoId()
  commentId?: string;
}

/**
 * Batch envelope for `/posts/recommendation-events`.
 *
 * A batch rather than one event per request: the frontend already batches and
 * throttles watch/impression telemetry client-side (rules/instructions §9.3 —
 * "Không gửi request theo mỗi timeupdate"), so the network call itself should
 * carry several events, not fan out one HTTP round trip per event.
 */
export class RecommendationEventBatchPayload {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RECOMMENDATION_EVENT_POLICY.maxEventsPerRequest)
  @ValidateNested({ each: true })
  @Type(() => RecommendationEventItemPayload)
  events: RecommendationEventItemPayload[];

  /** Anonymous session id for a guest caller. Ignored for an authenticated request. */
  @IsOptional()
  @IsString()
  anonymousId?: string;
}
