import {
  IsIn,
  IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength, Validate,
  ValidateIf, ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface
} from 'class-validator';
import { ObjectId } from 'mongodb';
import { SanitizeHtmlStrict } from 'src/common/decorators/sanitize-html.decorator';

/**
 * Payload for creating comments on content
 * Used for commenting on posts, posts, products, etc.
 */
/**
 * A comment has to say something.
 *
 * Text and image are each optional on their own and the pair is not: a comment
 * with neither is an empty row that renders as nothing. Expressed as a
 * class-level rule because no single field can decide it.
 */
@ValidatorConstraint({ name: 'commentHasContent', async: false })
class CommentHasContentConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const payload = args.object as { content?: string; imageId?: string };
    return Boolean((payload.content || '').trim()) || Boolean(payload.imageId);
  }

  defaultMessage(): string {
    return 'A comment needs text or an image.';
  }
}

export class CommentCreatePayload {
  /**
   * Not a field anybody sends — the anchor the class-level rule hangs off.
   *
   * Optional so callers constructing the payload as an object literal do not
   * have to supply a property that exists only to be validated.
   */
  @Validate(CommentHasContentConstraint)
  hasContent?: never;

  /**
   * Comment content with basic HTML support
   * HTML is sanitized to prevent XSS attacks
   */
  @SanitizeHtmlStrict(1000)
  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Comment cannot exceed 1000 characters' })
  content?: string;

  /**
   * One image attached to the comment.
   *
   * A reference, never the bytes: the image lives on the file server and this
   * records which one. A single optional id rather than an array, because the
   * product allows exactly one — an array would invite a second, and the
   * "at most one" rule would then have to be defended everywhere it is read.
   *
   * Only a claim at this point. Ownership, upload type and whether the file is
   * still an unattached draft are all checked server-side before it is stored.
   */
  @IsOptional()
  @ValidateIf((o) => !!o.imageId)
  @IsMongoId()
  imageId?: string;

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
   * Not a field anybody sends — the anchor the "text or image" rule hangs off.
   *
   * Declared on this class as well as the internal one because this is what a
   * request is actually validated against; the other is assembled server-side.
   */
  @Validate(CommentHasContentConstraint)
  hasContent?: never;

  /**
   * Comment content with basic HTML support
   * HTML is sanitized to prevent XSS attacks
   */
  @SanitizeHtmlStrict(1000)
  @IsString()
  @IsOptional()
  @MaxLength(1000, { message: 'Comment cannot exceed 1000 characters' })
  content?: string;

  /**
   * One image attached to the comment.
   *
   * A reference, never the bytes: the image lives on the file server and this
   * records which one. A single optional id rather than an array, because the
   * product allows exactly one — an array would invite a second, and the
   * "at most one" rule would then have to be defended everywhere it is read.
   *
   * Only a claim at this point. Ownership, upload type and whether the file is
   * still an unattached draft are all checked server-side before it is stored.
   */
  @IsOptional()
  @ValidateIf((o) => !!o.imageId)
  @IsMongoId()
  imageId?: string;

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
