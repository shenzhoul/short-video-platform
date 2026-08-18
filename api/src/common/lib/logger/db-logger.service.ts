import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import * as moment from 'moment';
import { SortOrder } from 'mongoose';
import { PAGINATION_DEFAULTS } from 'src/common/constants/shared';
import { applyCursorPagination } from 'src/common/utils/pagination.util';

import {
  getAuditLogModel,
  getDBLoggerModel,
  getHttpExceptionLogModel,
  getRequestLogModel
} from './logger-mongoose';
import { PageableData } from 'src/kernel/common';
import {
  AuditLogSearchPayload,
  HttpExceptionLogSearchPayload,
  RequestLogSearchPayload,
  SystemLogSearchPayload
} from 'src/payloads/shared/logger/logger-search.payload';

/**
 * Enhanced DB Logger Service with resilient database connection
 *
 * This service provides logging functionality that remains operational even when
 * the logger database is unavailable. It uses a separate MongoDB connection
 * for logging to ensure application resilience.
 *
 * Features:
 * - Separate logger database connection (LOGGER_MONGO_URI)
 * - Fallback to dummy operations when logger DB is down
 * - Automatic retry mechanism for database connections
 * - Silent error handling to prevent application disruption
 * - Complies with NestJS LoggerService interface
 * - Configurable log levels for different environments
 */
@Injectable()
export class DBLoggerService implements LoggerService {
  private readonly enabledLevels: Set<LogLevel>;

  constructor() {
    // Configure log levels based on environment
    this.enabledLevels = this.getEnabledLevels();
  }

  /**
   * Logs an informational message
   * Complies with NestJS LoggerService interface
   *
   * @param message - The message to log
   * @param context - Optional context (service name, module, etc.)
   */
  log(message: any, context?: string): void {
    if (this.isLevelEnabled('log')) {
      this.writeLog(context, 'log', message);
    }
  }

  /**
   * Logs an error message
   * Complies with NestJS LoggerService interface
   *
   * @param message - The error message to log
   * @param trace - Optional stack trace
   * @param context - Optional context (service name, module, etc.)
   */
  error(message: any, trace?: string, context?: string): void {
    if (this.isLevelEnabled('error')) {
      const errorData = trace ? { message, trace } : message;
      this.writeLog(context, 'error', errorData);
    }
  }

  /**
   * Logs a warning message
   * Complies with NestJS LoggerService interface
   *
   * @param message - The warning message to log
   * @param context - Optional context (service name, module, etc.)
   */
  warn(message: any, context?: string): void {
    if (this.isLevelEnabled('warn')) {
      this.writeLog(context, 'warn', message);
    }
  }

  /**
   * Logs a debug message
   * Complies with NestJS LoggerService interface
   *
   * @param message - The debug message to log
   * @param context - Optional context (service name, module, etc.)
   */
  debug(message: any, context?: string): void {
    if (this.isLevelEnabled('debug')) {
      this.writeLog(context, 'debug', message);
    }
  }

  /**
   * Logs a verbose message
   * Complies with NestJS LoggerService interface
   *
   * @param message - The verbose message to log
   * @param context - Optional context (service name, module, etc.)
   */
  verbose(message: any, context?: string): void {
    if (this.isLevelEnabled('verbose')) {
      this.writeLog(context, 'verbose', message);
    }
  }

  /**
   * Retrieves system logs with advanced filtering and pagination
   *
   * @param payload - Search parameters including filters, pagination, and sorting
   * @returns Promise containing paginated system logs
   */
  public async getSystemLogs(payload: SystemLogSearchPayload): Promise<PageableData<any>> {
    try {
      const dbLoggerModel = getDBLoggerModel();
      const query: Record<string, any> = {};

      // Keyword search in message field
      if (payload.q) {
        const regexp = new RegExp(
          payload.q.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, ''),
          'i'
        );
        query.message = { $regex: regexp };
      }

      // Log level filter
      if (payload.level) {
        query.level = payload.level;
      }

      // Context filter
      if (payload.context) {
        const regexp = new RegExp(
          payload.context.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, ''),
          'i'
        );
        query.context = { $regex: regexp };
      }

      // Date range filtering
      if (payload.fromDate && payload.toDate) {
        query.createdAt = {
          $gte: moment(payload.fromDate).startOf('day').toDate(),
          $lte: moment(payload.toDate).endOf('day').toDate()
        };
      }

      // Determine pagination strategy
      const offset = Number(payload.offset) || 0;
      const limit = Number(payload.limit) || 10;
      const hasCursor = Boolean(payload.cursor && payload.lastCreatedAt);
      const forceCursor = offset > PAGINATION_DEFAULTS.MAX_OFFSET;
      const useCursorPagination = hasCursor || forceCursor;

      // Handle cursor-based pagination
      if (hasCursor) {
        const cursorQuery = applyCursorPagination(query, payload.cursor as string, payload.lastCreatedAt, 'createdAt');
        Object.assign(query, cursorQuery);
      }

      // Sorting configuration
      let sort: Record<string, SortOrder> = {
        createdAt: -1,
        _id: -1 // Ensure consistent ordering for cursor pagination
      };

      if (payload.sort && payload.sortBy) {
        sort = {
          [payload.sortBy]: payload.sort,
          _id: -1 // Always include _id for cursor consistency
        };
      }

      // Execute search with pagination
      const [rawData, total] = await Promise.all([
        dbLoggerModel
          .find(query)
          .sort(sort)
          .limit(limit + 1)
          .skip(useCursorPagination ? 0 : offset),
        useCursorPagination ? Promise.resolve(undefined) : dbLoggerModel.countDocuments(query)
      ]);

      // Determine if there are more results and slice data accordingly
      const hasMore = rawData.length > limit;
      const data = hasMore ? rawData.slice(0, limit) : rawData;

      // Always provide pagination guidance to client
      const paginationInfo = {
        maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
        cursorPaginationAvailable: true
      };

      if (!data.length) {
        return {
          data: [],
          total: useCursorPagination ? undefined : total,
          hasMore: useCursorPagination ? false : undefined,
          nextCursor: useCursorPagination ? null : undefined,
          paginationInfo
        };
      }

      // Prepare response with cursor information
      let nextCursor = null;
      //  && (useCursorPagination || offset >= PAGINATION_DEFAULTS.MAX_OFFSET)
      if (hasMore) {
        const lastItem = data[data.length - 1];
        nextCursor = {
          id: lastItem._id.toString(),
          createdAt: lastItem.createdAt.getTime()
        };
      }

      return {
        data: data || [],
        total: useCursorPagination ? undefined : total,
        hasMore,
        nextCursor,
        paginationInfo
      };
    } catch {
      // Return empty result if logger DB is unavailable
      return {
        data: [],
        total: undefined,
        hasMore: false,
        nextCursor: null,
        paginationInfo: {
          maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
          cursorPaginationAvailable: true
        }
      };
    }
  }

  /**
   * Retrieves HTTP exception logs with advanced filtering and pagination
   *
   * @param payload - Search request with pagination and filter parameters
   * @returns Promise containing paginated HTTP exception logs
   */
  public async getHttpExceptionLogs(payload: HttpExceptionLogSearchPayload): Promise<PageableData<any>> {
    try {
      const query: Record<string, any> = {};

      // Keyword search in error field
      if (payload.q) {
        const regexp = new RegExp(
          payload.q.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, ''),
          'i'
        );
        query.$or = [
          { 'error.message': { $regex: regexp } },
          { path: { $regex: regexp } }
        ];
      }

      // HTTP status code filter
      if (payload.httpCode) {
        query.httpCode = parseInt(payload.httpCode, 10);
      }

      // Path filter
      if (payload.path) {
        const regexp = new RegExp(
          payload.path.toLowerCase().replace(/[^a-zA-Z0-9/ ]/g, ''),
          'i'
        );
        query.path = { $regex: regexp };
      }

      // User ID filter
      if (payload.userId) {
        query.userId = parseInt(payload.userId, 10);
      }

      // Date range filtering
      if (payload.fromDate && payload.toDate) {
        query.createdAt = {
          $gte: moment(payload.fromDate).startOf('day').toDate(),
          $lte: moment(payload.toDate).endOf('day').toDate()
        };
      }

      // Determine pagination strategy
      const offset = Number(payload.offset) || 0;
      const limit = Number(payload.limit) || 10;
      const hasCursor = Boolean(payload.cursor && payload.lastCreatedAt);
      const forceCursor = offset > PAGINATION_DEFAULTS.MAX_OFFSET;
      const useCursorPagination = hasCursor || forceCursor;

      // Handle cursor-based pagination
      if (hasCursor) {
        const cursorQuery = applyCursorPagination(query, payload.cursor as string, payload.lastCreatedAt, 'createdAt');
        Object.assign(query, cursorQuery);
      }

      // Sorting configuration
      let sort: Record<string, SortOrder> = {
        createdAt: -1,
        _id: -1 // Ensure consistent ordering for cursor pagination
      };

      if (payload.sort && payload.sortBy) {
        sort = {
          [payload.sortBy]: payload.sort,
          _id: -1 // Always include _id for cursor consistency
        };
      }

      const HttpExceptionLogModel = getHttpExceptionLogModel();
      const [rawData, total] = await Promise.all([
        HttpExceptionLogModel
          .find(query)
          .sort(sort)
          .limit(limit + 1)
          .skip(useCursorPagination ? 0 : offset),
        useCursorPagination ? Promise.resolve(undefined) : HttpExceptionLogModel.countDocuments(query)
      ]);

      // Determine if there are more results and slice data accordingly
      const hasMore = rawData.length > limit;
      const data = hasMore ? rawData.slice(0, limit) : rawData;

      // Always provide pagination guidance to client
      const paginationInfo = {
        maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
        cursorPaginationAvailable: true
      };

      if (!data.length) {
        return {
          data: [],
          total: useCursorPagination ? undefined : total,
          hasMore: useCursorPagination ? false : undefined,
          nextCursor: useCursorPagination ? null : undefined,
          paginationInfo
        };
      }

      // Prepare response with cursor information
      let nextCursor = null;
      //  && (useCursorPagination || offset >= PAGINATION_DEFAULTS.MAX_OFFSET)
      if (hasMore) {
        const lastItem = data[data.length - 1];
        nextCursor = {
          id: lastItem._id.toString(),
          createdAt: lastItem.createdAt.getTime()
        };
      }

      return {
        data: data || [],
        total: useCursorPagination ? undefined : total,
        hasMore,
        nextCursor,
        paginationInfo
      };
    } catch {
      // Return empty result if logger DB is unavailable
      return {
        data: [],
        total: undefined,
        hasMore: false,
        nextCursor: null,
        paginationInfo: {
          maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
          cursorPaginationAvailable: true
        }
      };
    }
  }

  /**
   * Retrieves request logs with pagination and filtering
   *
   * @param payload - Search request with pagination and filter parameters
   * @returns Promise containing paginated request logs
   */
  public async getRequestLogs(payload: RequestLogSearchPayload): Promise<PageableData<any>> {
    try {
      const requestLogModel = getRequestLogModel();
      const query: Record<string, any> = {};

      // Keyword search in path field
      if (payload.q) {
        const regexp = new RegExp(
          payload.q.toLowerCase().replace(/[^a-zA-Z0-9/ ]/g, ''),
          'i'
        );
        query.path = { $regex: regexp };
      }

      // HTTP method filter
      if (payload.method) {
        query.method = payload.method.toUpperCase();
      }

      // HTTP status code filter
      if (payload.statusCode) {
        query.statusCode = parseInt(payload.statusCode, 10);
      }

      // Path filter
      if (payload.path) {
        const regexp = new RegExp(
          payload.path.toLowerCase().replace(/[^a-zA-Z0-9/ ]/g, ''),
          'i'
        );
        query.path = { $regex: regexp };
      }

      // User ID filter
      if (payload.userId) {
        query.userId = parseInt(payload.userId, 10);
      }

      // Date range filtering
      if (payload.fromDate && payload.toDate) {
        query.createdAt = {
          $gte: moment(payload.fromDate).startOf('day').toDate(),
          $lte: moment(payload.toDate).endOf('day').toDate()
        };
      }

      // Determine pagination strategy
      const offset = Number(payload.offset) || 0;
      const limit = Number(payload.limit) || 10;
      const hasCursor = Boolean(payload.cursor && payload.lastCreatedAt);
      const forceCursor = offset > PAGINATION_DEFAULTS.MAX_OFFSET;
      const useCursorPagination = hasCursor || forceCursor;

      // Handle cursor-based pagination
      if (hasCursor) {
        const cursorQuery = applyCursorPagination(query, payload.cursor as string, payload.lastCreatedAt, 'createdAt');
        Object.assign(query, cursorQuery);
      }

      // Sorting configuration
      let sort: Record<string, SortOrder> = {
        createdAt: -1,
        _id: -1 // Ensure consistent ordering for cursor pagination
      };

      if (payload.sort && payload.sortBy) {
        sort = {
          [payload.sortBy]: payload.sort,
          _id: -1 // Always include _id for cursor consistency
        };
      }

      const [rawData, total] = await Promise.all([
        requestLogModel
          .find(query)
          .sort(sort)
          .limit(limit + 1)
          .skip(useCursorPagination ? 0 : offset),
        useCursorPagination ? Promise.resolve(undefined) : requestLogModel.countDocuments(query)
      ]);

      // Determine if there are more results and slice data accordingly
      const hasMore = rawData.length > limit;
      const data = hasMore ? rawData.slice(0, limit) : rawData;

      // Always provide pagination guidance to client
      const paginationInfo = {
        maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
        cursorPaginationAvailable: true
      };

      if (!data.length) {
        return {
          data: [],
          total: useCursorPagination ? undefined : total,
          hasMore: useCursorPagination ? false : undefined,
          nextCursor: useCursorPagination ? null : undefined,
          paginationInfo
        };
      }

      // Prepare response with cursor information
      let nextCursor = null;
      //  && (useCursorPagination || offset >= PAGINATION_DEFAULTS.MAX_OFFSET)
      if (hasMore) {
        const lastItem = data[data.length - 1];
        nextCursor = {
          id: lastItem._id.toString(),
          createdAt: lastItem.createdAt.getTime()
        };
      }

      return {
        data: data || [],
        total: useCursorPagination ? undefined : total,
        hasMore,
        nextCursor,
        paginationInfo
      };
    } catch {
      // Return empty result if logger DB is unavailable
      return {
        data: [],
        total: undefined,
        hasMore: false,
        nextCursor: null,
        paginationInfo: {
          maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
          cursorPaginationAvailable: true
        }
      };
    }
  }

  /**
   * Retrieves audit logs with pagination and filtering
   *
   * @param payload - Search request with pagination and filter parameters
   * @returns Promise containing paginated audit logs
   */
  public async getAuditLogs(payload: AuditLogSearchPayload): Promise<PageableData<any>> {
    try {
      const auditLogModel = getAuditLogModel();
      const query: Record<string, any> = {};

      // Keyword search in data field
      if (payload.q) {
        const regexp = new RegExp(
          payload.q.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, ''),
          'i'
        );
        query.$or = [
          { action: { $regex: regexp } },
          { type: { $regex: regexp } },
          { userId: { $regex: regexp } }
        ];
      }

      // Type filter
      if (payload.type) {
        query.type = payload.type;
      }

      // Action filter
      if (payload.action) {
        const regexp = new RegExp(
          payload.action.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, ''),
          'i'
        );
        query.action = { $regex: regexp };
      }

      // User ID filter
      if (payload.userId) {
        query.userId = payload.userId;
      }

      // Date range filtering
      if (payload.fromDate && payload.toDate) {
        query.createdAt = {
          $gte: moment(payload.fromDate).startOf('day').toDate(),
          $lte: moment(payload.toDate).endOf('day').toDate()
        };
      }

      // Determine pagination strategy
      const offset = Number(payload.offset) || 0;
      const limit = Number(payload.limit) || 10;
      const hasCursor = Boolean(payload.cursor && payload.lastCreatedAt);
      const forceCursor = offset > PAGINATION_DEFAULTS.MAX_OFFSET;
      const useCursorPagination = hasCursor || forceCursor;

      // Handle cursor-based pagination
      if (hasCursor) {
        const cursorQuery = applyCursorPagination(query, payload.cursor as string, payload.lastCreatedAt, 'createdAt');
        Object.assign(query, cursorQuery);
      }

      // Sorting configuration
      let sort: Record<string, SortOrder> = {
        createdAt: -1,
        _id: -1 // Ensure consistent ordering for cursor pagination
      };

      if (payload.sort && payload.sortBy) {
        sort = {
          [payload.sortBy]: payload.sort,
          _id: -1 // Always include _id for cursor consistency
        };
      }

      const [rawData, total] = await Promise.all([
        auditLogModel
          .find(query)
          .sort(sort)
          .limit(limit + 1)
          .skip(useCursorPagination ? 0 : offset),
        useCursorPagination ? Promise.resolve(undefined) : auditLogModel.countDocuments(query)
      ]);

      // Determine if there are more results and slice data accordingly
      const hasMore = rawData.length > limit;
      const data = hasMore ? rawData.slice(0, limit) : rawData;

      // Always provide pagination guidance to client
      const paginationInfo = {
        maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
        cursorPaginationAvailable: true
      };

      if (!data.length) {
        return {
          data: [],
          total: useCursorPagination ? undefined : total,
          hasMore: useCursorPagination ? false : undefined,
          nextCursor: useCursorPagination ? null : undefined,
          paginationInfo
        };
      }

      // Prepare response with cursor information
      let nextCursor = null;
      //  && (useCursorPagination || offset >= PAGINATION_DEFAULTS.MAX_OFFSET)
      if (hasMore) {
        const lastItem = data[data.length - 1];
        nextCursor = {
          id: lastItem._id.toString(),
          createdAt: lastItem.createdAt.getTime()
        };
      }

      return {
        data: data || [],
        total: useCursorPagination ? undefined : total,
        hasMore,
        nextCursor,
        paginationInfo
      };
    } catch {
      // Return empty result if logger DB is unavailable
      return {
        data: [],
        total: undefined,
        hasMore: false,
        nextCursor: null,
        paginationInfo: {
          maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
          cursorPaginationAvailable: true
        }
      };
    }
  }

  /**
   * Deletes system log records by IDs
   *
   * @param ids - Array of log record IDs to delete
   * @returns Promise containing deletion result
   */
  public async deleteSystemLogs(ids: string[]): Promise<{ deletedCount: number }> {
    try {
      const dbLoggerModel = getDBLoggerModel();
      const result = await dbLoggerModel.deleteMany({ _id: { $in: ids } });
      return { deletedCount: result.deletedCount || 0 };
    } catch {
      // Return zero deletions if logger DB is unavailable
      return { deletedCount: 0 };
    }
  }

  /**
   * Deletes HTTP exception log records by IDs
   *
   * @param ids - Array of log record IDs to delete
   * @returns Promise containing deletion result
   */
  public async deleteHttpExceptionLogs(ids: string[]): Promise<{ deletedCount: number }> {
    try {
      const httpExceptionLogModel = getHttpExceptionLogModel();
      const result = await httpExceptionLogModel.deleteMany({ _id: { $in: ids } });
      return { deletedCount: result.deletedCount || 0 };
    } catch {
      // Return zero deletions if logger DB is unavailable
      return { deletedCount: 0 };
    }
  }

  /**
   * Deletes request log records by IDs
   *
   * @param ids - Array of log record IDs to delete
   * @returns Promise containing deletion result
   */
  public async deleteRequestLogs(ids: string[]): Promise<{ deletedCount: number }> {
    try {
      const requestLogModel = getRequestLogModel();
      const result = await requestLogModel.deleteMany({ _id: { $in: ids } });
      return { deletedCount: result.deletedCount || 0 };
    } catch {
      // Return zero deletions if logger DB is unavailable
      return { deletedCount: 0 };
    }
  }

  /**
   * Deletes audit log records by IDs
   *
   * @param ids - Array of log record IDs to delete
   * @returns Promise containing deletion result
   */
  public async deleteAuditLogs(ids: string[]): Promise<{ deletedCount: number }> {
    try {
      const auditLogModel = getAuditLogModel();
      const result = await auditLogModel.deleteMany({ _id: { $in: ids } });
      return { deletedCount: result.deletedCount || 0 };
    } catch {
      // Return zero deletions if logger DB is unavailable
      return { deletedCount: 0 };
    }
  }

  /**
   * Gets the enabled log levels based on environment configuration
   *
   * @returns Set of enabled log levels
   */
  private getEnabledLevels(): Set<LogLevel> {
    // Get log levels from environment variable or use defaults
    const logLevelsEnv = process.env.LOG_LEVELS;

    if (logLevelsEnv) {
      // Parse comma-separated log levels from environment
      const levels = logLevelsEnv.split(',').map((level) => level.trim() as LogLevel);
      return new Set(levels);
    }

    // Default log levels based on environment
    if (process.env.NODE_ENV === 'production') {
      // Production: Only log and error levels
      return new Set<LogLevel>(['log', 'error']);
    } if (process.env.NODE_ENV === 'test') {
      // Test: Minimal logging
      return new Set<LogLevel>(['error']);
    }
    // Development: All levels
    return new Set<LogLevel>(['error', 'warn', 'log', 'debug', 'verbose']);
  }

  /**
   * Checks if a specific log level is enabled
   *
   * @param level - The log level to check
   * @returns True if the level is enabled
   */
  private isLevelEnabled(level: LogLevel): boolean {
    return this.enabledLevels.has(level);
  }

  /**
   * Writes a log entry to the database with resilient error handling
   * Uses fire-and-forget pattern to avoid blocking the main application
   *
   * @param context - The context or source of the log (e.g., service name, module)
   * @param level - The log level (e.g., 'log', 'error', 'warn', 'debug')
   * @param message - The log message content (can be any serializable data)
   */
  private writeLog(context: string | undefined, level: string, message: any): void {
    // Use fire-and-forget pattern to avoid blocking
    setImmediate(async () => {
      try {
        const dbLoggerModel = getDBLoggerModel();
        await dbLoggerModel.create({
          context,
          level,
          message
        });
      } catch {
        // Silently ignore logging errors to prevent application disruption
        // The dummy model will handle this gracefully when DB is down
      }
    });
  }
}
