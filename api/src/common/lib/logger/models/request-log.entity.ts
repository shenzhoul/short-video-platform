import { Document, Schema } from 'mongoose';

/**
 * Interface for Request Log document
 * Represents HTTP request logs for monitoring and debugging
 */
export interface IRequestLog extends Document {
  /** Request path/URL */
  path: string;

  /** HTTP method (GET, POST, etc.) */
  method?: string;

  /** HTTP status code */
  statusCode?: number;

  /** Request headers */
  headers?: Record<string, any>;

  /** Query string parameters */
  query?: Record<string, any>;

  /** Request body/payload */
  body?: Record<string, any>;

  /** Authentication data extracted from token */
  authData?: Record<string, any>;

  /** User ID if authenticated */
  userId?: number;

  /** User agent string */
  userAgent?: string;

  /** Client IP address */
  ip?: string;

  /** Response time in milliseconds */
  responseTime?: number;

  /** Timestamp when the request was logged */
  createdAt: Date;
}

/**
 * Mongoose schema for Request Log collection
 * Used for tracking HTTP requests for monitoring and debugging
 */
export const RequestLogSchema = new Schema<IRequestLog>({
  path: {
    type: String,
    required: true
  },
  method: {
    type: String
  },
  statusCode: {
    type: Number
  },
  headers: {
    type: Object
  },
  query: {
    type: Object
  },
  body: {
    type: Object
  },
  authData: {
    type: Object
  },
  userId: {
    type: Number
  },
  userAgent: {
    type: String
  },
  ip: {
    type: String
  },
  responseTime: {
    type: Number
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'request_logs',
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

// Optimized indexes based on actual query patterns
// Primary index for time-based queries and pagination (most common use case)
RequestLogSchema.index({ createdAt: -1 });

// Compound index for user-specific request tracking (if userId filtering is needed)
RequestLogSchema.index({ userId: 1, createdAt: -1 });

// Compound index for method-based filtering with time sorting (admin interface)
RequestLogSchema.index({ method: 1, createdAt: -1 });
