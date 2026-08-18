import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';

export class AuthDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId;

  @Expose()
  @Transform(({ obj }) => obj.userId)
  userId: ObjectId;

  @Expose()
  type: string;

  @Expose()
  key: string;

  @Expose()
  value: string;

  @Expose()
  salt: string;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  public static fromModel(model) {
    if (!model) return null;

    return plainToInstance(AuthDto, typeof model.toObject === 'function' ? model.toObject() : model, { excludeExtraneousValues: true });
  }
}
