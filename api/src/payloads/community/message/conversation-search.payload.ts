import {
  IsMongoId, IsOptional, IsString, ValidateIf
} from 'class-validator';
import { IsDateStringOrTimestamp } from 'src/common/validators/date-validators';
import { SearchRequest } from 'src/kernel/common';

/**
 * Conversation list query.
 *
 * Has no participant or owner field on purpose: the reader is always taken from
 * the authenticated request, so no one can list somebody else's conversations by
 * passing their id.
 */
export class ConversationSearchPayload extends SearchRequest {
  @IsOptional()
  @IsString()
  @IsMongoId()
  cursor?: string;

  /**
   * The previous page's last activity time.
   *
   * Named `lastCreatedAt` to match the cursor contract shared by every other
   * list endpoint; the service maps it onto `lastMessageAt`, which is the field
   * it sorts and indexes by.
   */
  @IsOptional()
  @IsDateStringOrTimestamp()
  @ValidateIf((o) => !!o.lastCreatedAt)
  lastCreatedAt?: string;
}
