import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Validate,
  ValidateIf
} from 'class-validator';
import { USER_GENDER_VALUES } from 'src/common/constants/identity';
import { transformToDate } from 'src/common/decorators/utils';
import { IsValidDateString } from 'src/common/decorators/utils/is-valid-date-string';
import { AdvancedUsername } from 'src/common/validators/user/advanced-username.validator';

export class UserCreatePayload {
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
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @Validate(AdvancedUsername)
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsIn(USER_GENDER_VALUES)
  @IsOptional()
  gender: string;

  @IsBoolean()
  @IsOptional()
  verifiedEmail: boolean;

  @IsOptional()
  @IsValidDateString()
  @Transform(transformToDate)
  @ValidateIf((o) => !!o.dateOfBirth)
  dateOfBirth: Date;

  constructor(params: Partial<UserCreatePayload>) {
    if (params) {
      this.verifiedEmail = params.verifiedEmail;
      this.firstName = params.firstName;
      this.lastName = params.lastName;
      this.name = params.name;
      this.email = params.email;
      this.username = params.username;
      this.gender = params.gender;
    }
  }
}
