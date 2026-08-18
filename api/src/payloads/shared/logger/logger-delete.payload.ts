import { IsArray, IsNotEmpty, IsString } from 'class-validator';

/**
 * Base Logger Delete Payload
 * Common parameters for deleting logger records
 */
export class BaseLoggerDeletePayload {
  /**
   * IDs of the log records to delete
   * Accepts single ID or array of IDs
   */
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  ids: string[];
}

/**
 * System Log Delete Payload
 * Parameters for deleting system log records
 */
export class SystemLogDeletePayload extends BaseLoggerDeletePayload {}

/**
 * HTTP Exception Log Delete Payload
 * Parameters for deleting HTTP exception log records
 */
export class HttpExceptionLogDeletePayload extends BaseLoggerDeletePayload {}

/**
 * Request Log Delete Payload
 * Parameters for deleting request log records
 */
export class RequestLogDeletePayload extends BaseLoggerDeletePayload {}

/**
 * Audit Log Delete Payload
 * Parameters for deleting audit log records
 */
export class AuditLogDeletePayload extends BaseLoggerDeletePayload {}
