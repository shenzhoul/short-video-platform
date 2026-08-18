import {
  IsMongoId,
  IsOptional, IsString, ValidateIf
} from 'class-validator';
import { IsDateStringOrTimestamp } from 'src/common/validators/date-validators';
import { SearchRequest } from 'src/kernel/common';

export class CommentSearchRequestPayload extends SearchRequest {
  @IsString()
  @IsOptional()
  @IsMongoId()
  @ValidateIf((o) => !!o.objectId)
  objectId: string;

  @IsString()
  @IsOptional()
  objectType: string;

  /**
   * Cursor-based pagination parameters for infinite scroll
   * These provide better performance than offset-based pagination for large datasets
   */
  @IsString()
  @IsOptional()
  @IsMongoId()
  cursor?: string; // Last comment's _id for cursor-based pagination

  @IsOptional()
  @IsDateStringOrTimestamp()
  @ValidateIf((o) => !!o.lastCreatedAt)
  lastCreatedAt?: string; // Last comment's createdAt - supports ISO string, timestamp string, or number
}
