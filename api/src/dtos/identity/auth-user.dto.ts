import { ObjectId } from 'mongodb';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import { UserDto } from './user';

export class AuthUserDto {
  _id: string | ObjectId;

  username: string;

  isAdmin: boolean;

  status: string;

  constructor(data?: Partial<AuthUserDto>) {
    Object.assign(this, data);
    if (this._id) {
      this._id = toObjectId(this._id as string);
    }
  }

  static fromUser(user: UserDto): AuthUserDto {
    return new AuthUserDto({
      _id: user._id,
      username: user.username,
      isAdmin: user.isAdmin,
      status: user.status
    });
  }

  public toResponse() {
    return {
      _id: this._id,
      username: this.username,
      isAdmin: this.isAdmin,
      status: this.status
    };
  }
}
