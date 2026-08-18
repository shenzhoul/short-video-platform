import { Document, Schema } from 'mongoose';

/**
 * Interface for HTTP Exception Log document
 * Represents HTTP errors and exceptions for monitoring and debugging
 */
export interface IHttpExceptionLog extends Document {
  /** User ID associated with the HTTP exception (if authenticated) */
  userId?: number;

  /** Request path where the exception occurred */
  path: string;

  /** Query string parameters from the request */
  query?: Record<string, string>;

  /** Request payload/body data */
  payload?: Record<string, any>;

  /** HTTP headers from the request */
  headers?: Record<string, any>;

  /** HTTP status code of the response */
  httpCode?: number;

  /** Error details and stack trace */
  error: any;

  /** Timestamp when the exception was logged */
  createdAt: Date;
}

/**
 * Mongoose schema for HTTP Exception Log collection
 * Used for tracking HTTP errors and exceptions for monitoring and debugging
 */
export const HttpExceptionLogSchema = new Schema<IHttpExceptionLog>({
  userId: {
    type: Number,
    index: true // Index for efficient user-based error queries
  },
  path: {
    type: String,
    required: true,
    index: true // Index for efficient path-based error analysis
  },
  query: {
    type: Object
  },
  payload: {
    type: Object
  },
  headers: {
    type: Object
  },
  httpCode: {
    type: Number,
    index: true // Index for efficient HTTP status code filtering
  },
  error: {
    type: Schema.Types.Mixed,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true // Index for efficient time-based queries
  }
}, {
  collection: 'http_exception_logs',
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

// Compound indexes for efficient querying
HttpExceptionLogSchema.index({ httpCode: 1, createdAt: -1 }); // Error code analysis
HttpExceptionLogSchema.index({ path: 1, createdAt: -1 }); // Path-based error tracking
HttpExceptionLogSchema.index({ userId: 1, createdAt: -1 }); // User-specific error tracking
