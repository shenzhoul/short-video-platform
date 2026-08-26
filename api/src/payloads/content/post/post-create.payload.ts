import {
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { POST_CATEGORY_KEY_MAX_LENGTH, POST_CREATE_TYPES } from 'src/common/constants';
import { SanitizeHtmlBasic, SanitizeHtmlPlainText } from 'src/common/decorators';

export class PostCreatePayload {
  @IsString()
  @IsNotEmpty()
  @IsIn(POST_CREATE_TYPES)
  type: string;

  @SanitizeHtmlPlainText(200)
  @IsString()
  @IsOptional()
  title: string;

  @IsString()
  @IsOptional()
  @IsMongoId()
  @ValidateIf((o) => !!o.userId)
  userId: string;

  @SanitizeHtmlBasic(5000)
  @IsString()
  @IsNotEmpty()
  text: string;

  @SanitizeHtmlPlainText(500)
  @IsString()
  @IsOptional()
  tagline: string;

  /**
   * Optional content category, referenced by its stable key.
   *
   * Only the shape is checked here — whether the key names a category that exists and is still
   * active is decided in PostCrudService against the `categories` collection, because the catalogue
   * is admin-managed data rather than a compile-time constant.
   */
  @IsOptional()
  @IsString()
  @MaxLength(POST_CATEGORY_KEY_MAX_LENGTH)
  @ValidateIf((o) => o.topicKey !== null && o.topicKey !== undefined && o.topicKey !== '')
  topicKey?: string | null;

  /** Users @-mentioned in the text. Existence is verified server-side before saving. */
  @IsOptional()
  @IsMongoId({ each: true })
  mentionedUserIds?: string[];

  /** Trending hashtag this post is associated with. Verified to exist server-side. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  associatedTag?: string | null;

  @IsOptional()
  @IsString({ each: true })
  @IsMongoId({ each: true })
  fileIds: string[];

  @IsOptional()
  @IsMongoId()
  @ValidateIf((o) => !!o.thumbnailId && o.thumbnailId !== null)
  thumbnailId: string | null;

  @IsOptional()
  @IsMongoId()
  @ValidateIf((o) => !!o.cover4x3Id && o.cover4x3Id !== null)
  cover4x3Id: string | null;

  @IsOptional()
  @IsMongoId()
  @ValidateIf((o) => !!o.cover3x4Id && o.cover3x4Id !== null)
  cover3x4Id: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  coverThumbnailIndex: number;

  @IsOptional()
  @IsIn(['4:3', '3:4'])
  coverDisplayRatio: '4:3' | '3:4';

  @IsOptional()
  @IsMongoId()
  @ValidateIf((o) => !!o.teaserId && o.teaserId !== null)
  teaserId: string | null;

  @IsString()
  @IsOptional()
  status: string;
}
