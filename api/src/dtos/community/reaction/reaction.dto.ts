import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';
import { UserDto } from 'src/dtos/identity/user';

export class ReactionDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId;

  @Expose()
  action: string;

  @Expose()
  @Transform(({ obj }) => obj.objectId)
  objectId: ObjectId;

  @Expose()
  objectType: string;

  @Expose()
  @Transform(({ obj }) => obj.createdBy)
  createdBy: string | ObjectId;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  user: Partial<UserDto>;

  @Expose()
  objectInfo: Record<string, any>;

  public static fromModel(model: any) {
    if (!model) return null;

    return plainToInstance(ReactionDto, typeof model.toObject === 'function' ? model.toObject() : model, { excludeExtraneousValues: true });
  }
}
