import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';

/**
 * A credential record, minus the credential.
 *
 * `value` (the scrypt hash) and `salt` (the retired legacy column) are
 * deliberately **not** exposed. Nothing outside `AuthService` has any use for
 * them — verification reads the raw model, never this — and a DTO is the
 * response privacy boundary in this codebase, so a hash reachable from one is a
 * hash one careless `DataResponse.ok(...)` away from a response body.
 *
 * Verified by `verify-password-change.js`, which serialises what the credential
 * write returns and asserts no hash, salt or plaintext appears in it.
 */
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
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  public static fromModel(model) {
    if (!model) return null;

    return plainToInstance(AuthDto, typeof model.toObject === 'function' ? model.toObject() : model, { excludeExtraneousValues: true });
  }
}
