import { Expose, plainToInstance, Transform } from 'class-transformer';
import { pick } from 'lodash';
import { ObjectId } from 'mongodb';

import { UserDto } from './user';

export abstract class BaseUserDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId;

  @Expose() // implode, should not be a public
  isAdmin: boolean;

  @Expose()
  name: string;

  @Expose()
  firstName: string;

  @Expose()
  lastName: string;

  @Expose()
  email: string;

  @Expose()
  phone: string;

  @Expose()
  phoneCountry: string; // ISO 3166-1 alpha-2 country code

  @Expose()
  @Transform(({ obj }) => obj.avatarId)
  avatarId: string | ObjectId;

  @Expose()
  avatar: string;

  @Expose()
  status: string;

  @Expose()
  username: string;

  @Expose()
  gender: string;

  @Expose()
  country: string; // iso code

  @Expose()
  verifiedEmail: boolean;

  @Expose()
  isOnline: boolean;

  @Expose()
  @Transform(({ obj }) => {
    if (obj.balance < 0) return 0;
    const newVal = parseFloat((obj.balance || 0).toFixed(2));
    return newVal;
  })
  balance: number;

  @Expose()
  dateOfBirth: Date;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  constructor(data: Partial<BaseUserDto>) {
    data
      && Object.assign(
        this,
        pick(data, [
          '_id',
          'isAdmin',
          'name',
          'firstName',
          'lastName',
          'email',
          'phone',
          'phoneCountry',
          'avatarId',
          'avatar',
          'status',
          'username',
          'gender',
          'country',
          'verifiedEmail',
          'isOnline',
          'dateOfBirth',
          'balance',
          'createdAt',
          'updatedAt'
        ])
      );
  }

  public static getName(firstName: string, lastName: string, name?: string) {
    if (name) return name;
    return [firstName || '', lastName || ''].filter(Boolean).join(' ');
  }

  /**
   * Create standardized email template data for user/creator objects
   * Used across all email templates to ensure consistent data structure
   */
  public static toEmailData(model: any): any {
    if (!model) return null;

    return {
      id: model._id?.toString(),
      username: model.username,
      firstName: model.firstName,
      lastName: model.lastName,
      email: model.email,
      name: model.name || model.username || `${model.firstName || ''} ${model.lastName || ''}`.trim(),
      avatar: model.avatar,
      status: model.status,
      isOnline: model.isOnline,
      createdAt: model.createdAt,
      // Creator-specific fields (will be undefined for regular users)
      displayName: model.displayName,
      bio: model.bio,
      isApproved: model.isApproved,
      // User-specific fields
      balance: model.balance,
      verifiedEmail: model.verifiedEmail
    };
  }

  public static fromModel(model: any, DtoClass: any): UserDto {
    if (!model) return null;

    const dto: any = plainToInstance(DtoClass, typeof model.toObject === 'function' ? model.toObject() : model, {
      excludeExtraneousValues: true
    });
    return dto;
  }

  public getName() {
    if (this.name) return this.name;
    return [this.firstName || '', this.lastName || ''].filter(Boolean).join(' ');
  }

  // Abstract methods that must be implemented by subclasses
  abstract toSearchResponse();

  // Abstract methods that must be implemented by subclasses
  abstract toResponse(includePrivateInfo?: boolean, isAdmin?: boolean): any;
}
