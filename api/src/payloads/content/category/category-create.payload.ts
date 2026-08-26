import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min
} from 'class-validator';
import {
  POST_CATEGORY_DESCRIPTION_MAX_LENGTH,
  POST_CATEGORY_KEY_MAX_LENGTH,
  POST_CATEGORY_KEY_PATTERN,
  POST_CATEGORY_MAX_ORDERING,
  POST_CATEGORY_NAME_MAX_LENGTH,
  POST_CATEGORY_STATUSES
} from 'src/common/constants';
import { SanitizeHtmlPlainText } from 'src/common/decorators';

/**
 * Body for creating a post category from the admin app.
 *
 * `key` is required rather than derived from `name`. Two different names can slugify to the same
 * key, and silently appending a random suffix would mint an identifier nobody chose and nobody can
 * predict — one that then lives on every post filed under it. The admin app pre-fills the field from
 * the name so the common case is still one keystroke, and a genuine collision surfaces as a 409 the
 * admin resolves by picking a key.
 */
export class CategoryCreatePayload {
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_CATEGORY_KEY_MAX_LENGTH)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(POST_CATEGORY_KEY_PATTERN, {
    message: 'Category key must be lowercase letters, digits and single hyphens'
  })
  key: string;

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
