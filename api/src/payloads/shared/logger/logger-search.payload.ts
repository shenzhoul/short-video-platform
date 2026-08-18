import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  ValidateIf
} from 'class-validator';
import { IsValidDateString, transformToDate } from 'src/common/decorators/utils';
import { SearchRequest } from 'src/kernel/common';
import { IsDateStringOrTimestamp } from 'src/common/validators/date-validators';

/**
 * Base Logger Search Payload
 * Common search parameters for all logger types
 */
export class BaseLoggerSearchPayload extends SearchRequest {
  /**
   * Date range filtering
   * Filters logs created between fromDate and toDate (inclusive)
   */
  @IsOptional()
  @IsValidDateString()
  @Transform(transformToDate)
  @ValidateIf((o) => !!o.fromDate)
  fromDate?: string | Date;

  @IsOptional()
  @IsValidDateString()
  @Transform(transformToDate)
  @ValidateIf((o) => !!o.toDate)
  toDate?: string | Date;

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

/**
 * System Log Search Payload
 * Search parameters for system logs (application logs)
 */
export class SystemLogSearchPayload extends BaseLoggerSearchPayload {
  /**
   * Log level filter (error, warn, log, debug, verbose)
   */
  @IsOptional()
  @IsString()
  level?: string;

  /**
   * Context filter (service name, module, etc.)
   */
  @IsOptional()
  @IsString()
  context?: string;
}

/**
 * HTTP Exception Log Search Payload
 * Search parameters for HTTP exception logs
 */
export class HttpExceptionLogSearchPayload extends BaseLoggerSearchPayload {
  /**
   * HTTP status code filter
   */
  @IsOptional()
  @IsString()
  httpCode?: string;

  /**
   * Request path filter (supports partial matching)
   */
  @IsOptional()
  @IsString()
  path?: string;

  /**
   * User ID filter
   */
  @IsOptional()
  @IsString()
  userId?: string;
}

/**
 * Request Log Search Payload
 * Search parameters for HTTP request logs
 */
export class RequestLogSearchPayload extends BaseLoggerSearchPayload {
  /**
   * HTTP method filter (GET, POST, PUT, DELETE, etc.)
   */
  @IsOptional()
  @IsString()
  method?: string;

  /**
   * HTTP status code filter
   */
  @IsOptional()
  @IsString()
  statusCode?: string;

  /**
   * Request path filter (supports partial matching)
   */
  @IsOptional()
  @IsString()
  path?: string;

  /**
   * User ID filter
   */
  @IsOptional()
  @IsString()
  userId?: string;
}

/**
 * Audit Log Search Payload
 * Search parameters for audit logs (user actions, system events)
 */
export class AuditLogSearchPayload extends BaseLoggerSearchPayload {
  /**
   * Audit log type filter (auth, content, user, system, etc.)
   */
  @IsOptional()
  @IsString()
  type?: string;

  /**
   * Action filter (login, logout, create, update, delete, etc.)
   */
  @IsOptional()
  @IsString()
  action?: string;

  /**
   * User ID filter
   */
  @IsOptional()
  @IsString()
  userId?: string;
}
