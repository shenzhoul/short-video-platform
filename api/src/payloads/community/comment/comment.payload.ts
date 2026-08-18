import {
  IsIn,
  IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength, ValidateIf
} from 'class-validator';
import { ObjectId } from 'mongodb';
import { SanitizeHtmlStrict } from 'src/common/decorators/sanitize-html.decorator';

/**
 * Payload for creating comments on content
 * Used for commenting on posts, posts, products, etc.
 */
export class CommentCreatePayload {
  /**
   * Comment content with basic HTML support
   * HTML is sanitized to prevent XSS attacks
   */
  @SanitizeHtmlStrict(1000)
  @IsString()
  @IsNotEmpty()
  @MinLength(1, { message: 'Comment cannot be empty' })
  @MaxLength(1000, { message: 'Comment cannot exceed 1000 characters' })
  content: string;

  /**
   * Type of object being commented on
   * Supported types: post, post, product, video
   */
  @IsString()
  @IsOptional()
  @IsIn(['post', 'post', 'product', 'video'], { message: 'Invalid object type' })
  objectType: string;

  /**
   * ID of the object being commented on
   * Must be a valid MongoDB ObjectId
   */
  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  objectId: string | ObjectId;

  /**
   * The user being answered when replying inside a thread.
   *
   * Client-supplied, so it is only a claim: it is validated against the thread's
   * real participants before it is allowed to route a notification. Constrained
   * to an id shape here so malformed values are rejected at the edge.
   */
  @IsOptional()
  @ValidateIf((o) => !!o.replyToUserId)
  @IsMongoId()
  replyToUserId?: string;

  @IsOptional()
  @IsString()
  replyToName?: string;

  /**
   * Users @-mentioned in the comment.
   *
   * Picked from the composer's autocomplete, so these are real ids rather than
   * parsed handles — but they still arrive as request data and are re-verified
   * against existing accounts before being stored.
   */
  @IsOptional()
  @IsMongoId({ each: true })
  mentionedUserIds?: string[];
}

/**
 * Simplified payload for comment creation requests
 * Used in contexts where object info is provided separately
 */
export class CommentCreateRequestPayload {
  /**
   * Comment content with basic HTML support
   * HTML is sanitized to prevent XSS attacks
   */
  @SanitizeHtmlStrict(1000)
  @IsString()
  @IsNotEmpty()
  @MinLength(1, { message: 'Comment cannot be empty' })
  @MaxLength(1000, { message: 'Comment cannot exceed 1000 characters' })
  content: string;

  /**
   * The user being answered when replying inside a thread.
   *
   * Client-supplied, so it is only a claim: it is validated against the thread's
   * real participants before it is allowed to route a notification. Constrained
   * to an id shape here so malformed values are rejected at the edge.
   */
  @IsOptional()
  @ValidateIf((o) => !!o.replyToUserId)
  @IsMongoId()
  replyToUserId?: string;

  @IsOptional()
  @IsString()
  replyToName?: string;

  /**
   * Users @-mentioned in the comment.
   *
   * Picked from the composer's autocomplete, so these are real ids rather than
   * parsed handles — but they still arrive as request data and are re-verified
   * against existing accounts before being stored.
   */
  @IsOptional()
  @IsMongoId({ each: true })
  mentionedUserIds?: string[];
}

/**
 * Payload for editing existing comments
 * Only the content can be modified after creation
 */
export class CommentEditPayload {
  /**
   * Updated comment content with basic HTML support
   * HTML is sanitized to prevent XSS attacks
   */
  @SanitizeHtmlStrict(1000)
  @IsString()
  @MinLength(1, { message: 'Comment cannot be empty' })
  @MaxLength(1000, { message: 'Comment cannot exceed 1000 characters' })
  @IsNotEmpty()
  content: string;
}
