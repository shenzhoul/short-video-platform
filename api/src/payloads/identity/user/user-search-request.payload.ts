import { Transform } from 'class-transformer';
import {
  IsOptional, IsString, ValidateIf
} from 'class-validator';
import { transformToBoolean } from 'src/common/decorators/utils';
import { SearchRequest } from 'src/kernel/common';
import { IsDateStringOrTimestamp } from 'src/common/validators/date-validators';

export class UserSearchRequestPayload extends SearchRequest {
  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  q: string;

  @IsOptional()
  @Transform(transformToBoolean)
  isAdmin: boolean;

  @IsString()
  @IsOptional()
  gender: string;

  @IsString()
  @IsOptional()
  status: string;

  /**
   * Cursor-based pagination parameters for infinite scroll
   * These provide better performance than offset-based pagination for large datasets
   */
  @IsString()
  @IsOptional()
  cursor?: string; // Last user's _id for cursor-based pagination

  @IsOptional()
  @IsDateStringOrTimestamp()
  @ValidateIf((o) => !!o.lastCreatedAt)
  lastCreatedAt?: string; // Last user's createdAt - supports ISO string, timestamp string, or number
}
