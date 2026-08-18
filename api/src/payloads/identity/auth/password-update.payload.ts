import {
  IsMongoId,
  IsOptional,
  IsString,
  ValidateIf
} from 'class-validator';
import { HashedPassword } from 'src/payloads/shared/validation-utils';

export class PasswordChangePayload {
  @HashedPassword(8)
  password: string;
}

export class PasswordAdminChangePayload {
  @IsOptional()
  @IsString()
  @IsMongoId()
  @ValidateIf((o) => !!o.userId)
  userId: string;

  @HashedPassword(8)
  password: string;
}
