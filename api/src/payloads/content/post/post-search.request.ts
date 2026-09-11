import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateIf
} from 'class-validator';
import { ObjectId } from 'mongodb';
import { transformToDate } from 'src/common/decorators/utils';
import { IsValidDateString } from 'src/common/decorators/utils/is-valid-date-string';
import { IsDateStringOrTimestamp } from 'src/common/validators/date-validators';
import { SearchRequest } from 'src/kernel/common';

export class PostSearchRequest extends SearchRequest {
  @IsString()
  @IsOptional()
  q: string;

  @IsOptional()
  @IsString()
  sortBy = 'createdAt';

  @IsString()
  @IsOptional()
  @IsMongoId()
  @ValidateIf((o) => !!o.userId)
  userId: string;

  @IsString()
  @IsOptional()
  type: string;

  /**
   * How a single-creator listing (`userId` set) is ordered.
   *
   * `pinned` (the default, and what an absent value means) is the creator's own
   * order: pinned posts first, then newest. `latest` is plain newest-first, used
   * by the account menu's "My work" preview, where an old pinned post must not
   * displace the creator's most recent posts.
   *
   * A string enum rather than a boolean on purpose: the global pipe runs with
   * implicit conversion, which turns the query string `'false'` into `true`
   * before a transform ever sees it (see `lastIsPinned` below).
   */
  @IsOptional()
  @IsIn(['pinned', 'latest'])
  creatorOrder?: 'pinned' | 'latest';

  /**
   * Exact hashtag to match against Post.tags.
   *
   * Set when the searcher's intent is unambiguously a hashtag (a `#tag` query). Unlike `q`, this
   * matches the indexed tag value exactly rather than searching free text.
   */
  @IsString()
  @IsOptional()
  tag?: string;

  /** Filter to a single content category, used by the home category bar. */
  @IsString()
  @IsOptional()
  topicKey?: string;

  @IsString()
  @IsOptional()
  orientation: string;

  /**
   * Media types filter for photo/video/audio posts
   * Can be 'photo', 'video', 'audio', or any combination
   */
  @IsOptional()
  mediaTypes?: string[];

  @IsOptional()
  @IsValidDateString()
  @Transform(transformToDate)
  @ValidateIf((o) => !!o.fromDate)
  fromDate: string | Date;

  @IsOptional()
  @IsValidDateString()
  @Transform(transformToDate)
  @ValidateIf((o) => !!o.toDate)
  toDate: string | Date;

  /**
   * Cursor-based pagination parameters for infinite scroll
   * These provide better performance than offset-based pagination for large datasets
  */

  @IsString()
  @IsOptional()
  @IsMongoId()
  cursor?: string; // Last item's _id for cursor-based pagination

  @IsOptional()
  @IsDateStringOrTimestamp()
  @ValidateIf((o) => !!o.lastCreatedAt)
  lastCreatedAt?: string; // Last item's createdAt - supports ISO string, timestamp string, or number

  /**
   * Compound creator-list cursor state. Kept optional for backwards-compatible
   * cursors.
   *
   * Read from `obj` -- the raw query object -- and **not** from `value`.
   *
   * The global pipe in `main.ts` runs with
   * `transformOptions: { enableImplicitConversion: true }`, so class-transformer
   * coerces the query string to this property's reflected type *before* a custom
   * `@Transform` sees it. For a boolean that coercion is `Boolean(string)`, and
   * `Boolean('false')` is `true`. The transform below then received `true` and
   * dutifully returned `true`, so `lastIsPinned` was **always** true whenever the
   * parameter was present at all.
   *
   * That sent every creator page down the "still inside the pinned block" branch
   * of `applyCreatorPinnedCursor`, whose second arm matches every unpinned post
   * with no `createdAt` bound -- so each page returned the same rows and
   * `hasMore` never went false. Paging a creator's posts looped forever,
   * replaying the same window: measured on a 10-post creator, 8 pages returned
   * 32 rows containing 6 distinct posts.
   *
   * `obj` is the untouched source object, so reading the raw value there is
   * immune to whatever implicit conversion decides.
   */
  @IsOptional()
  @IsBoolean()
  @Transform(({ obj }) => obj?.lastIsPinned === true || obj?.lastIsPinned === 'true')
  lastIsPinned?: boolean;

  @IsOptional()
  @IsDateStringOrTimestamp()
  @ValidateIf((o) => Boolean(o.lastPinnedAt))
  lastPinnedAt?: string;

  ids?: string[] | ObjectId[];
}
