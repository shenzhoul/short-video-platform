import { Expose, plainToInstance, Transform } from 'class-transformer';
import { pick } from 'lodash';
import { ObjectId } from 'mongodb';

export class SettingDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId;

  @Expose()
  key: string;

  @Expose()
  value: any;

  @Expose()
  name: string;

  @Expose()
  description: string;

  @Expose()
  group = 'system';

  @Expose()
  public = false;

  @Expose()
  type = 'text';

  @Expose()
  visible = true;

  @Expose()
  autoload: boolean;

  @Expose()
  meta: any;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  extra: string;

  constructor(data?: Partial<SettingDto>) {
    data && Object.assign(this, pick(data, [
      '_id', 'key', 'value', 'name', 'description', 'type', 'visible', 'public', 'meta', 'createdAt', 'updatedAt', 'extra', 'autoload'
    ]));
  }

  public static fromModel(model) {
    if (!model) return null;

    return plainToInstance(SettingDto, typeof model.toObject === 'function' ? model.toObject() : model, { excludeExtraneousValues: true });
  }

  public getValue() {
    if (this.type === 'text' && !this.value) {
      return '';
    }

    return this.value;
  }
}
