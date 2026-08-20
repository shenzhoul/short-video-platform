import {
  IsMongoId, IsOptional, IsString, ValidateIf
} from 'class-validator';
import { IsDateStringOrTimestamp } from 'src/common/validators/date-validators';
import { SearchRequest } from 'src/kernel/common';

/**
 * Message history query for one conversation.
 *
 * The conversation is a route parameter, not a body field, and membership is
 * checked against the authenticated user before anything is read — a client
 * cannot page through a conversation it is not part of by guessing an id.
 */
export class MessageSearchPayload extends SearchRequest {
  @IsOptional()
  @IsString()
  @IsMongoId()
  cursor?: string;

  @IsOptional()
  @IsDateStringOrTimestamp()
  @ValidateIf((o) => !!o.lastCreatedAt)
  lastCreatedAt?: string;
}
