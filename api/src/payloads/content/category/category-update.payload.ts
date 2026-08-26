import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator';
import {
  POST_CATEGORY_DESCRIPTION_MAX_LENGTH,
  POST_CATEGORY_MAX_ORDERING,
  POST_CATEGORY_NAME_MAX_LENGTH,
  POST_CATEGORY_STATUSES
} from 'src/common/constants';
import { SanitizeHtmlPlainText } from 'src/common/decorators';

/**
 * Body for updating a post category.
 *
 * Deliberately does NOT extend the create payload: `key` is immutable, and inheriting it would let
 * a `whitelist: true` pipe pass a new key straight through to the service. Every post filed under a
 * category stores that key, so changing it would orphan them all.
 */
export class CategoryUpdatePayload {
  @SanitizeHtmlPlainText(POST_CATEGORY_NAME_MAX_LENGTH)
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_CATEGORY_NAME_MAX_LENGTH)
  name: string;

  @SanitizeHtmlPlainText(POST_CATEGORY_DESCRIPTION_MAX_LENGTH)
  @IsString()
  @IsOptional()
  @MaxLength(POST_CATEGORY_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsString()
  @IsOptional()
  @IsIn(POST_CATEGORY_STATUSES)
  status?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  @Max(POST_CATEGORY_MAX_ORDERING)
  ordering?: number;
}
