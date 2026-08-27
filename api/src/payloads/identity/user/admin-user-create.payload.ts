import {
  IsEmail, IsIn,
  IsOptional, IsString
} from 'class-validator';
import { USER_STATUS } from 'src/common/constants/identity';
import { UserCreatePayload } from 'src/payloads/identity/user/user-create.payload';
import { HashedPassword } from 'src/payloads/shared/validation-utils';

/**
 * Admin-only payload for creating user accounts
 * Includes sensitive fields like roles and status
 * Only administrators should have access to these fields
 * Note: Balance is set via dedicated balance adjustment endpoint
 */
export class AdminUserCreatePayload extends UserCreatePayload {
  @IsString()
  @IsEmail()
  email: string;

  @IsOptional()
  @HashedPassword(8)
  password: string;

  /**
   * Account status, chosen by the administrator.
   *
   * Optional so that omitting it means "the safe default" rather than a
   * validation error — the service assigns `USER_STATUS.ACTIVE` when no intent
   * is stated. Still validated against the enum when present: an unrecognised
   * status is a rejected request, never a silently corrected one.
   *
   * The controller forwards this as *intent*; `createNewUserAccount` ignores any
   * status left in the request body. See `CreateAccountIntent`.
   */
  @IsOptional()
  @IsString()
  @IsIn(Object.values(USER_STATUS))
  status: string;
}
