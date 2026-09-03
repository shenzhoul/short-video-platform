import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsOptional, IsString, Length, Matches
} from 'class-validator';
import { SearchRequest } from 'src/kernel/common';

/**
 * Request shape for `/posts/recommended` (For You) and `/posts/home-posts`
 * (Home) once both moved off `PostSearchService`'s plain `createdAt` sort and
 * onto `RecommendationFeedService`.
 *
 * `cursor` here is an **opaque page offset into a Redis-stored session
 * ordering**, not a Mongo id — a full redesign from the single-aggregation
 * engine this replaced, whose cursor paired a post id with its computed
 * score. Passing `sessionId` + `cursor` continues that session's stable
 * pagination; omitting both starts a new session (reload semantics — see
 * `RecommendationFeedService.getFeed`).
 */
export class PostRecommendationRequest extends SearchRequest {
  /** Continues an existing recommendation session for stable load-more pagination. */
  @IsOptional()
  @IsString()
  sessionId?: string;

  /** Opaque offset cursor returned as `nextCursor` by the previous page of the same session. */
  @IsOptional()
  @IsString()
  cursor?: string;

  /** Home category tab — scopes every candidate source to this category (rules/instructions §2.1). */
  @IsOptional()
  @IsString()
  topicKey?: string;

  /**
   * Anonymous session id for guest-session learning.
   *
   * Never a device fingerprint — an opaque token the app issues to itself and
   * the client sends back. Bounded and shape-checked because it becomes a Redis
   * key segment and the *owner* of a feed session: an unbounded or punctuated
   * value would be both a key-injection surface and a way to make session
   * ownership ambiguous. A value outside this shape is rejected by validation
   * rather than silently used, and a request with none at all still gets a feed
   * (see `RecommendationFeedService.getFeed`).
   */
  @IsOptional()
  @IsString()
  @Length(8, 64)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'anonymousId must be an opaque token' })
  anonymousId?: string;

  /**
   * Requests per-candidate score-breakdown debug info. Honored only outside
   * production (see the controller) — rules/instructions §19.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  @Transform(({ obj }) => obj?.debug === true || obj?.debug === 'true')
  debug?: boolean;
}
