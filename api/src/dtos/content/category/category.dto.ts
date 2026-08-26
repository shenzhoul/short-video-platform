import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';

export class CategoryDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId | string;

  @Expose()
  key: string;

  @Expose()
  name: string;

  @Expose()
  description: string;

  @Expose()
  status: string;

  @Expose()
  ordering: number;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  public static fromModel(model): CategoryDto {
    if (!model) return null;

    return plainToInstance(
      CategoryDto,
      typeof model.toObject === 'function' ? model.toObject() : model,
      { excludeExtraneousValues: true }
    );
  }

  /**
   * Shape the public topic list has always had: `{ key, label }`.
   *
   * Keeping this exact shape is what lets the catalogue move from a TypeScript constant into the
   * database without the web client changing a line. `label` is the admin-managed `name`.
   */
  public toTopicResponse(): { key: string; label: string } {
    return {
      key: this.key,
      label: this.name
    };
  }

  /**
   * Everything an admin manages. Not exposed on any public route — `status`, `description` and
   * `ordering` are operational data, not something a visitor needs.
   */
  public toAdminResponse() {
    return {
      _id: this._id,
      key: this.key,
      name: this.name,
      description: this.description || '',
      status: this.status,
      ordering: this.ordering ?? 0,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}
