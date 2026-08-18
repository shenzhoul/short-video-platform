import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail, IsIn,
  IsOptional, IsString, Validate,
  ValidateIf
} from 'class-validator';
import { USER_GENDER_VALUES, USER_STATUS_VALUES } from 'src/common/constants';
import { transformToDate } from 'src/common/decorators/utils';
import { IsValidDateString } from 'src/common/decorators/utils/is-valid-date-string';
import { AdvancedUsername } from 'src/common/validators/user';
import { HashedPassword } from 'src/payloads/shared';

/**
 * Admin-only payload for updating user accounts
 * Includes sensitive fields like username, email, password, roles, and status
 * Only administrators should have access to these fields
 */
export class AdminUserUpdatePayload {
  @IsString()
  @IsOptional()
  firstName: string;

  @IsString()
  @IsOptional()
  lastName: string;

  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  @Validate(AdvancedUsername)
  username: string;

  @IsOptional()
  @IsEmail()
  email: string;

  @IsOptional()
  @HashedPassword(8)
  password: string;

  @IsString()
  @IsOptional()
  @IsIn(USER_STATUS_VALUES)
  status: string;

  @IsString()
  @IsOptional()
  @IsIn(USER_GENDER_VALUES)
  gender: string;

  @IsBoolean()
  @IsOptional()
  verifiedEmail: boolean;

  @IsOptional()
  @IsValidDateString()
  @Transform(transformToDate)
  @ValidateIf((o) => !!o.dateOfBirth)
  dateOfBirth: Date;
}
