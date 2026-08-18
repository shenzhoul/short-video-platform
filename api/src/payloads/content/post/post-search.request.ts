import { Transform } from 'class-transformer';
import {
  IsBoolean,
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

  /** Compound creator-list cursor state. Kept optional for backwards-compatible cursors. */
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === true || value === 'true')
  lastIsPinned?: boolean;

  @IsOptional()
  @IsDateStringOrTimestamp()
  @ValidateIf((o) => Boolean(o.lastPinnedAt))
  lastPinnedAt?: string;

  ids?: string[] | ObjectId[];
}
