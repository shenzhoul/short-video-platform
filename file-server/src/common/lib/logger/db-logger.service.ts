import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { SearchRequest } from 'src/kernel';

import { getDBLoggerModel, getHttpExceptionLogModel, getRequestLogModel } from './logger-mongoose';

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
   * Retrieves system logs with pagination
   *
   * @param payload - Search request with pagination parameters
   * @returns Promise containing paginated system logs
   */
  public async getSystemLogs(payload: SearchRequest): Promise<{ data: any[]; total: number }> {
    try {
      const dbLoggerModel = getDBLoggerModel();
      const query: Record<string, any> = {};
      const [data, total] = await Promise.all([
        dbLoggerModel
          .find(query)
          .sort({
            createdAt: -1
          })
          .limit(payload.limit)
          .skip(payload.offset),
        dbLoggerModel.countDocuments(query)
      ]);

      return {
        data: data || [],
        total: total || 0
      };
    } catch {
      // Return empty result if logger DB is unavailable
      return {
        data: [],
        total: 0
      };
    }
  }

  /**
   * Retrieves HTTP exception logs with pagination
   *
   * @param payload - Search request with pagination parameters
   * @returns Promise containing paginated HTTP exception logs
   */
  public async getHttpExceptionLogs(payload: SearchRequest): Promise<{ data: any[]; total: number }> {
    try {
      const query: Record<string, any> = {};
      const HttpExceptionLogModel = getHttpExceptionLogModel();
      const [data, total] = await Promise.all([
        HttpExceptionLogModel
          .find(query)
          .sort({
            createdAt: -1
          })
          .limit(payload.limit)
          .skip(payload.offset),
        HttpExceptionLogModel.countDocuments(query)
      ]);

      return {
        data: data || [],
        total: total || 0
      };
    } catch {
      // Return empty result if logger DB is unavailable
      return {
        data: [],
        total: 0
      };
    }
  }

  /**
   * Retrieves request logs with pagination
   *
   * @param payload - Search request with pagination parameters
   * @returns Promise containing paginated request logs
   */
  public async getRequestLogs(payload: SearchRequest): Promise<{ data: any[]; total: number }> {
    try {
      const requestLogModel = getRequestLogModel();
      const query: Record<string, any> = {};
      const [data, total] = await Promise.all([
        requestLogModel
          .find(query)
          .sort({
            createdAt: -1
          })
          .limit(payload.limit)
          .skip(payload.offset),
        requestLogModel.countDocuments(query)
      ]);

      return {
        data: data || [],
        total: total || 0
      };
    } catch {
      // Return empty result if logger DB is unavailable
      return {
        data: [],
        total: 0
      };
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
