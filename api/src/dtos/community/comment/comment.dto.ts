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

  public static fromModel(model) {
    if (!model) return null;

    return plainToInstance(CommentDto, typeof model.toObject === 'function' ? model.toObject() : model, { excludeExtraneousValues: true });
  }

  setUser(user: UserDto) {
    if (!user) return;

    this.user = user.toResponse();
  }

  setIsLiked(liked: boolean) {
    this.isLiked = liked;
  }
}
