import {
  IsIn, IsMongoId, IsOptional, IsString,
  ValidateIf
} from 'class-validator';
import { ObjectId } from 'mongodb';
import { REACTION_TARGET_TYPES, REACTION_TYPES } from 'src/common/constants/community';
import { IsDateStringOrTimestamp } from 'src/common/validators/date-validators';
import { SearchRequest } from 'src/kernel/common';

export class ReactionSearchRequestPayload extends SearchRequest {
  @IsOptional()
  @IsString()
  @IsMongoId()
  objectId: string | ObjectId;

  @IsOptional()
  @IsString()
  @IsIn([
    REACTION_TYPES.LIKE
  ])
  action: string;

  @IsOptional()
  @IsString()
  @IsIn([
    REACTION_TARGET_TYPES.COMMENT,
    REACTION_TARGET_TYPES.POST,
    REACTION_TARGET_TYPES.CREATOR
  ])
  objectType: string;

  @IsOptional()
  @IsString()
  @IsMongoId()
  createdBy: string | ObjectId;

  /**
   * Cursor-based pagination parameters for infinite scroll
   * These provide better performance than offset-based pagination for large datasets
   */
  @IsString()
  @IsOptional()
  @IsMongoId()
  cursor?: string; // Last reaction's _id for cursor-based pagination

  @IsOptional()
  @IsDateStringOrTimestamp()
  @ValidateIf((o) => !!o.lastCreatedAt)
  lastCreatedAt?: string; // Last reaction's createdAt - supports ISO string, timestamp string, or number
}
