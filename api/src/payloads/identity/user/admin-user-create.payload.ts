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

  @IsString()
  @IsIn(Object.values(USER_STATUS))
  status: string;
}
