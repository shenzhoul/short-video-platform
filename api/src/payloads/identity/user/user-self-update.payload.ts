import { Transform } from "class-transformer";
import { IsIn, IsISO31661Alpha2, IsOptional, IsString, ValidateIf } from "class-validator";
import { COUNTRIES_ISO2_CODE, USER_GENDER_VALUES } from "src/common/constants";
import { IsValidDateString, transformToDate } from "src/common/decorators/utils";
import { HashedPassword } from "src/payloads/shared";

/**
 * Creator self-update payload
 * Excludes sensitive fields like username and email (admin-only)
 * Creators can change their own passwords for security access
 */
export class CreatorSelfUpdatePayload {
  @IsString()
  @IsOptional()
  name: string;

  @IsOptional()
  @HashedPassword(8)
  password: string;

  @IsString()
  @IsOptional()
  bio: string;

  @IsString()
  @IsOptional()
  @IsIn(USER_GENDER_VALUES)
  gender: string;

  @IsString()
  @IsOptional()
  @IsISO31661Alpha2()
  @ValidateIf((o) => ![undefined, ''].includes(o.country) && !COUNTRIES_ISO2_CODE.includes(o.country))
  country: string;

  @IsOptional()
  @IsValidDateString()
  @Transform(transformToDate)
  @ValidateIf((o) => !!o.dateOfBirth)
  dateOfBirth: Date;
}