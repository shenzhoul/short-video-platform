/**
 * Resilient Logger Database Connection Module
 *
 * This module provides a robust database connection specifically for logging operations.
 * It ensures that the main application continues to function even when the logger database
 * is unavailable by implementing fallback mechanisms and dummy models.
 *
 * Features:
 * - Separate MongoDB connection for logging (LOGGER_MONGO_URI)
 * - Automatic fallback to dummy models when connection fails
 * - Retry mechanism for database connections
 * - Fast connection timeout to prevent application blocking
 * - Silent error handling to maintain application stability
 *
 * Environment Variables:
 * - LOGGER_MONGO_URI: MongoDB connection string for logger database
 *   If not provided, defaults to 'mongodb://localhost:27017/logger'
 *
 * @since 1.0.0
 * @author ShenZhoul
 */

// Since process.env.LOGGER_MONGO_URI cannot be used in this file, we need to use dotenv to read the environment variables
import mongoose, { Connection, Model } from 'mongoose';

import { AuditLogSchema, IAuditLog } from './models/audit-log.entity';
import { DBLoggerSchema, IDBLogger } from './models/db-logger.entity';
import { HttpExceptionLogSchema, IHttpExceptionLog } from './models/http-exception-log.entity';
import { IRequestLog, RequestLogSchema } from './models/request-log.entity';

require('dotenv').config();

// Read logger database URI from environment variables
// Falls back to localhost if LOGGER_MONGO_URI is not configured
const LOGGER_DB_URI = process.env.LOGGER_MONGO_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/logger';

// Connection management variables
let isConnected = false;
let connection: Connection | null = null;
let retryCount = 0;
let retryTimeout: ReturnType<typeof setTimeout> | null = null;

// Retry configuration
const MAX_RETRIES = 5; // Reduced from 10 to fail faster
const BASE_RETRY_DELAY = 3000; // Base delay in milliseconds
const MAX_RETRY_DELAY = 30000; // Reduced from 60s to 30s for faster recovery

// Model instances - initialized as null and set during connection
let auditLogModel: Model<IAuditLog> | null = null;
let httpExceptionLogModel: Model<IHttpExceptionLog> | null = null;
let dbLoggerModel: Model<IDBLogger> | null = null;
let requestLogModel: Model<IRequestLog> | null = null;

/**
 * Creates a dummy model that performs no-op operations
 * Used as fallback when the logger database is unavailable
 *
 * @template T - The document type for the model
 * @returns A dummy model with no-op create and find methods
 */
function dummyModel<T>() {
  return {
    create: async () => { }, // No-op create operation
    find: async () => [], // Returns empty array for find operations
    findOne: async () => null,
    findById: async () => null,
    updateOne: async () => ({ acknowledged: true, modifiedCount: 0 }),
    deleteOne: async () => ({ acknowledged: true, deletedCount: 0 }),
    countDocuments: async () => 0 // Returns 0 for count operations
  } as unknown as Model<T>;
}

/**
 * Calculate exponential backoff delay with jitter to prevent thundering herd
 */
function calculateRetryDelay(attempt: number): number {
  const exponentialDelay = BASE_RETRY_DELAY * 2 ** (attempt - 1);
  const jitter = Math.random() * 1000; // Add up to 1 second of jitter
  return Math.min(exponentialDelay + jitter, MAX_RETRY_DELAY);
}

/**
 * Clean up existing connection and models
 */
async function cleanupConnection() {
  if (connection) {
    try {
      await connection.close();
      // console.log('MongoDB logger connection closed');
    } catch {
      // console.error('Error closing MongoDB logger connection:', error);
    }
    connection = null;
  }

  auditLogModel = null;
  httpExceptionLogModel = null;
  dbLoggerModel = null;
  requestLogModel = null;
  isConnected = false;
}

/**
 * Set up dummy models when connection fails
 */
function setupDummyModels() {
  auditLogModel = dummyModel<IAuditLog>();
  httpExceptionLogModel = dummyModel<IHttpExceptionLog>();
  dbLoggerModel = dummyModel<IDBLogger>();
  requestLogModel = dummyModel<IRequestLog>();
}

/**
 * Set up connection event handlers for automatic reconnection
 */
function setupConnectionHandlers(conn: Connection) {
  conn.on('connected', () => {
    retryCount = 0; // Reset retry count on successful connection
    isConnected = true;
  });

  conn.on('error', () => {
    isConnected = false;
    // Don't immediately retry on error, let the disconnected handler manage it
  });

  conn.on('disconnected', () => {
    isConnected = false;

    // Only retry if we haven't exceeded max retries
    if (retryCount < MAX_RETRIES) {
      const delay = calculateRetryDelay(retryCount + 1);

      // Clear any existing retry timeout
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }

      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        connectLoggerDb();
      }, delay);
    } else {
      setupDummyModels();
    }
  });

  conn.on('reconnected', () => {
    isConnected = true;
    retryCount = 0;
  });
}

/**
 * Establishes connection to the logger database with resilient error handling
 *
 * This function attempts to connect to the logger database using the configured
 * LOGGER_MONGO_URI. If the connection fails, it sets up dummy models to ensure
 * the application continues functioning and schedules a retry with exponential backoff.
 *
 * Connection Features:
 * - Enhanced MongoDB configuration for better reliability
 * - Limited retry mechanism with exponential backoff and jitter
 * - Automatic reconnection via connection event handlers
 * - Fallback to dummy models on connection failure
 * - Circuit breaker pattern to prevent infinite retries
 * - Graceful connection cleanup
 *
 * @returns Promise<void> - Resolves when connection attempt is complete
 */
async function connectLoggerDb(): Promise<void> {
  // If already connected, return early
  if (isConnected && connection) return;

  // If we've exceeded max retries, use dummy models permanently
  if (retryCount >= MAX_RETRIES) {
    setupDummyModels();
    return;
  }

  try {
    retryCount += 1;

    // Clean up any existing connection first
    await cleanupConnection();

    // Create new connection with enhanced configuration
    connection = await mongoose.createConnection(LOGGER_DB_URI, {
      serverSelectionTimeoutMS: 5000, // Increased timeout for better reliability
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      bufferCommands: false, // Don't buffer commands when disconnected
      family: 4, // Use IPv4
      maxPoolSize: 5, // Limit connection pool size for logger
      minPoolSize: 1,
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      heartbeatFrequencyMS: 10000 // Check connection health every 10 seconds
    }).asPromise();

    // Set up event handlers for automatic reconnection
    setupConnectionHandlers(connection);

    // Initialize all logger models with the dedicated connection
    auditLogModel = connection.model<IAuditLog>('AuditLog', AuditLogSchema, 'audit_logs');
    httpExceptionLogModel = connection.model<IHttpExceptionLog>('HttpExceptionLog', HttpExceptionLogSchema, 'http_exception_logs');
    dbLoggerModel = connection.model<IDBLogger>('DBLogger', DBLoggerSchema, 'system_logs');
    requestLogModel = connection.model<IRequestLog>('RequestLog', RequestLogSchema, 'request_logs');

    isConnected = true;

    // Clear any existing retry timeout
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
  } catch {
    isConnected = false;

    // Set up dummy models for immediate use
    setupDummyModels();

    // Schedule retry if we haven't exceeded max attempts
    if (retryCount < MAX_RETRIES) {
      const delay = calculateRetryDelay(retryCount);

      // Clear any existing retry timeout
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }

      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        connectLoggerDb();
      }, delay);
    } else {
      // console.error('MongoDB logger max retries exceeded, will use dummy models permanently');
    }
  }
}

/**
 * Get connection health status for monitoring
 */
export function getConnectionHealth() {
  return {
    isConnected,
    retryCount,
    maxRetries: MAX_RETRIES,
    hasConnection: !!connection,
    connectionState: connection?.readyState || 0,
    lastAttempt: new Date().toISOString()
  };
}

/**
 * Force reconnection (useful for health checks or manual recovery)
 */
export async function forceReconnect() {
  retryCount = 0; // Reset retry count
  await cleanupConnection();
  await connectLoggerDb();
}

/**
 * Graceful shutdown - close connection properly
 */
export async function gracefulShutdown() {
  // Clear any pending retry timeouts
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }

  await cleanupConnection();
}

// Immediately attempt to connect, but do not block application startup
connectLoggerDb();

// Set up graceful shutdown handlers
process.on('SIGINT', async () => {
  await gracefulShutdown();
});

process.on('SIGTERM', async () => {
  await gracefulShutdown();
});

// Handle uncaught exceptions to prevent connection leaks
process.on('uncaughtException', async () => {
  await gracefulShutdown();
});

// process.on('unhandledRejection', async (reason, promise) => {
//   // console.error('Unhandled rejection at:', promise, 'reason:', reason);
//   // Don't shutdown on unhandled rejection, just log it
// });

/**
 * Retrieves the Audit Log model instance
 *
 * Returns the connected model if available, otherwise returns a dummy model
 * that performs no-op operations to ensure application stability.
 *
 * @returns Model<IAuditLog> - Audit log model instance or dummy model
 */
export function getAuditLogModel(): Model<IAuditLog> {
  return auditLogModel || dummyModel<IAuditLog>();
}

/**
 * Retrieves the System Log model instance
 *
 * Returns the connected model if available, otherwise returns a dummy model
 * that performs no-op operations to ensure application stability.
 *
 * @returns Model<ISystemLog> - System log model instance or dummy model
 */
export function getSystemLogModel(): Model<any> {
  return dbLoggerModel || dummyModel<IDBLogger>();
}

/**
 * Retrieves the HTTP Exception Log model instance
 *
 * Returns the connected model if available, otherwise returns a dummy model
 * that performs no-op operations to ensure application stability.
 *
 * @returns Model<IHttpExceptionLog> - HTTP exception log model instance or dummy model
 */
export function getHttpExceptionLogModel(): Model<IHttpExceptionLog> {
  return httpExceptionLogModel || dummyModel<IHttpExceptionLog>();
}

/**
 * Retrieves the DB Logger model instance
 *
 * Returns the connected model if available, otherwise returns a dummy model
 * that performs no-op operations to ensure application stability.
 *
 * @returns Model<IDBLogger> - DB logger model instance or dummy model
 */
export function getDBLoggerModel(): Model<IDBLogger> {
  return dbLoggerModel || dummyModel<IDBLogger>();
}

/**
 * Retrieves the Request Log model instance
 *
 * Returns the connected model if available, otherwise returns a dummy model
 * that performs no-op operations to ensure application stability.
 *
 * @returns Model<IRequestLog> - Request log model instance or dummy model
 */
export function getRequestLogModel(): Model<IRequestLog> {
  return requestLogModel || dummyModel<IRequestLog>();
}
