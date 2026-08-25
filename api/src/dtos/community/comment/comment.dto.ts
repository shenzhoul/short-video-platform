import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';
import { UserDto } from 'src/dtos/identity/user';

export class CommentDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId;

  @Expose()
  objectType: string;

  @Expose()
  @Transform(({ obj }) => obj.objectId)
  objectId: ObjectId;

  @Expose()
  content: string;

  @Expose()
  @Transform(({ obj }) => obj.createdBy)
  createdBy: ObjectId;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  user?: Partial<UserDto>;

  @Expose()
  isLiked?: boolean;

  @Expose()
  totalReply?: number;

  @Expose()
  totalLike?: number;

  @Expose()
  @Transform(({ obj }) => obj.replyToUserId)
  replyToUserId?: ObjectId;

  @Expose()
  replyToName?: string;

  @Expose()
  @Transform(({ obj }) => obj.mentionedUserIds)
  mentionedUserIds?: Array<string | ObjectId>;

  /**
   * The attached image, resolved for rendering.
   *
   * Only what a client needs to draw it: a URL, the intrinsic dimensions so the
   * space can be reserved before it loads, and the type. Deliberately not the
   * storage path — that is a server-side detail and no client has any business
   * knowing where a file sits on disk.
   *
   * Absent on a comment with no image, and absent on one whose file could not be
   * resolved, so a deleted or withdrawn image simply stops rendering rather than
   * leaving a broken box behind.
   */
  @Expose()
  image?: {
    id: string;
    url: string;
    width: number;
    height: number;
    mimeType: string;
  };

  public static fromModel(model) {
    if (!model) return null;

    return plainToInstance(CommentDto, typeof model.toObject === 'function' ? model.toObject() : model, { excludeExtraneousValues: true });
  }

  /**
   * Attach the resolved image, if the comment has one and it still exists.
   *
   * Takes a file-server record rather than an id, so the DTO never reaches for
   * storage itself and a caller that batched its lookups stays batched.
   */
  setImage(file?: {
    _id?: any;
    url?: string;
    width?: number;
    height?: number;
    mimeType?: string;
    thumbnails?: Array<{ url?: string }>;
  } | null) {
    if (!file?.url) return;
    this.image = {
      id: file._id?.toString(),
      url: file.url,
      // Zero rather than a guess when the processor did not report a size: the
      // client reserves space only when it genuinely knows the shape.
      width: file.width || 0,
      height: file.height || 0,
      mimeType: file.mimeType || 'image/*'
    };
  }

  setUser(user: UserDto) {
    if (!user) return;

    this.user = user.toResponse();
  }

  setIsLiked(liked: boolean) {
    this.isLiked = liked;
  }
}
