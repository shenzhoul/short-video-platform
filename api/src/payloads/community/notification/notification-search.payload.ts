import {
  IsIn, IsMongoId, IsOptional, IsString,
  ValidateIf
} from 'class-validator';
import {
  NOTIFICATION_FILTER_LIST,
  NOTIFICATION_TYPE_LIST,
  NotificationFilter
} from 'src/common/constants/community';
import { IsDateStringOrTimestamp } from 'src/common/validators/date-validators';
import { SearchRequest } from 'src/kernel/common';

/**
 * Notification list query.
 *
 * Intentionally has no recipient field: the backend always derives the recipient
 * from the authenticated user, so notifications cannot be read by passing
 * someone else's id.
 */
export class NotificationSearchRequestPayload extends SearchRequest {
  /** Optional filter for the panel's type tabs. */
  @IsOptional()
  @IsString()
  @IsIn(NOTIFICATION_TYPE_LIST)
  type?: string;

  /** Optional user-facing category containing one or more persisted types. */
  @IsOptional()
  @IsString()
  @IsIn(NOTIFICATION_FILTER_LIST)
  category?: NotificationFilter;

  @IsOptional()
  @IsString()
  @IsMongoId()
  cursor?: string;

  /**
   * The previous page's last `lastActivityAt`.
   *
   * Named `lastCreatedAt` to match the cursor contract every other list endpoint
   * uses; the notification service maps it onto `lastActivityAt`, which is the
   * field it sorts and indexes by.
   */
  @IsOptional()
  @IsDateStringOrTimestamp()
  @ValidateIf((o) => !!o.lastCreatedAt)
  lastCreatedAt?: string;
}
