import { Expose, plainToInstance, Transform } from 'class-transformer';
import { pick } from 'lodash';
import { ObjectId } from 'mongodb';
import { BaseUserDto } from '../base-user.dto';
import { FileServerInfoDto } from 'src/dtos/shared/file-server/file-server.dto';

/**
 * Compute age in full years from a date of birth.
 * Returns undefined if dob is falsy.
 */
function computeAge(dob: Date | string | undefined): number | undefined {
  if (!dob) return undefined;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

export interface ICreatorStats {
  followers?: number;
  followings?: number;
  totalPosts: number;
  totalLikes?: number;
}

export class UserDto extends BaseUserDto {
  @Expose()
  stats: ICreatorStats;

  @Expose()
  @Transform(({ obj }) => obj.coverId)
  coverId: ObjectId

  @Expose()
  cover: string;

  @Expose()
  coverBgColor: string;

  @Expose()
  bio: string;

  @Expose()
  isFollowed: boolean;

  constructor(data: Partial<UserDto>) {
    super(data);
    data
      && Object.assign(
        this,
        pick(data, [
          'isAdmin',
        ])
      );
  }

  public static fromModel(model: any): UserDto {
    if (!model) return null;

    return plainToInstance(UserDto, typeof model.toObject === 'function' ? model.toObject() : model, {
      excludeExtraneousValues: true
    });
  }

  toResponse(includePrivateInfo = false, isAdmin = false): Partial<UserDto> {
    const publicInfo = {
      _id: this._id,
      avatar: this.avatar,
      cover: this.cover,
      coverBgColor: this.coverBgColor,
      name: this.getName() || this.username,
      stats: this.getResponseStats(),
      username: this.username,
      isOnline: this.isOnline,
      gender: this.gender,
      isAdmin: this.isAdmin || undefined, // hide isAdmin if false,
      isFollowed: this.isFollowed,
      age: computeAge(this.dateOfBirth),
      createdAt: this.createdAt
    };

    const privateInfo = {
      firstName: this.firstName,
      lastName: this.lastName,
      name: this.getName(),
      email: this.email,
      stats: this.getResponseStats(),
      bio: this.bio,
      status: this.status,
      verifiedEmail: this.verifiedEmail,
      balance: this.balance,
      dateOfBirth: this.dateOfBirth,
      updatedAt: this.updatedAt
    };

    if (isAdmin) {
      return {
        ...publicInfo,
        ...privateInfo
      };
    }

    if (!includePrivateInfo) {
      return publicInfo;
    }

    return {
      ...publicInfo,
      ...privateInfo
    };
  }

  toSearchResponse(includePrivateInfo = false): Partial<UserDto> {
    const response: Record<string, any> = {
      _id: this._id,
      avatar: this.avatar,
      username: this.username,
      name: this.getName(),
      bio: this.bio,
      isOnline: this.isOnline,
      gender: this.gender,
      country: this.country,
      stats: this.getResponseStats(),
      isFollowed: this.isFollowed,
      age: computeAge(this.dateOfBirth),
      createdAt: this.createdAt
    };
    if (includePrivateInfo) {
      response.email = this.email;
      response.dateOfBirth = this.dateOfBirth;
    }
    return response;
  }

  toPublicDetailsResponse() {
    return {
      _id: this._id,
      name: this.getName(),
      avatar: this.avatar,
      cover: this.cover,
      coverBgColor: this.coverBgColor,
      username: this.username,
      status: this.status,
      gender: this.gender,
      country: this.country,
      bio: this.bio,
      age: computeAge(this.dateOfBirth),
      stats: this.getResponseStats(),
      isCreator: true,
      isOnline: this.isOnline,
      isFollowed: this.isFollowed
    };
  }

  /**
   * Minimal identity for embedding as the actor of an interaction.
   *
   * Deliberately narrower than `toSearchResponse`, which carries stats, bio, age
   * and follow state. A notification row only needs to show and link a person,
   * and these payloads are also pushed over the socket, so the smaller shape is
   * both a privacy boundary and a bandwidth choice.
   */
  toActorResponse(): Partial<UserDto> {
    return {
      _id: this._id,
      username: this.username,
      name: this.getName() || this.username,
      avatar: this.avatar
    };
  }

  private getResponseStats(): ICreatorStats {
    const stats = this.stats || ({} as Record<string, any>);

    // Only the fields below are part of the contract. Documents written before `likes`/`views` were
    // dropped may still carry them, so build the response explicitly rather than spreading `stats`.
    return {
      totalLikes: Number(stats.totalLikes || 0),
      followings: Number(stats.followings || 0),
      totalPosts: Number(stats.totalPosts || 0),
      followers: Number(stats.followers || 0)
    };
  }

  public async setAvatar(file: FileServerInfoDto) {
    if (!file) return;
    this.avatar = await file.getUrl(true);
  }

  public async setCover(file: FileServerInfoDto) {
    if (!file) return;
    this.cover = await file.getUrl(true);
  }
}
