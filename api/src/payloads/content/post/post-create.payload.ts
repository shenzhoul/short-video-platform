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
import { POST_CREATE_TYPES, POST_TOPIC_KEYS } from 'src/common/constants';
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
   * Optional content category. Validated against the fixed POST_TOPICS list so a client cannot
   * store an arbitrary key.
   */
  @IsOptional()
  @IsString()
  @IsIn(POST_TOPIC_KEYS)
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
