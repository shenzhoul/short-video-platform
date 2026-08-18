import { Document, Schema } from 'mongoose';

/**
 * Interface for DB Logger document
 * Represents system log entries for application logging and debugging
 */
export interface IDBLogger extends Document {
  /** Context or source of the log entry (e.g., service name, module) */
  context?: string;

  /** Log level (e.g., 'log', 'error', 'warn', 'debug') */
  level: string;

  /** Log message content (can be string, object, or any serializable data) */
  message: any;

  /** Timestamp when the log entry was created */
  createdAt: Date;
}

/**
 * Mongoose schema for DB Logger collection
 * Used for storing application logs in a separate database for resilience
 */
export const DBLoggerSchema = new Schema<IDBLogger>({
  context: {
    type: String,
    index: true // Index for efficient context-based log filtering
  },
  level: {
    type: String,
    required: true,
    index: true // Index for efficient log level filtering
  },
  message: {
    type: Schema.Types.Mixed,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true // Index for efficient time-based queries
  }
}, {
  collection: 'system_logs',
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

// Compound indexes for efficient querying
DBLoggerSchema.index({ level: 1, createdAt: -1 }); // Log level filtering with time
DBLoggerSchema.index({ context: 1, createdAt: -1 }); // Context-based log analysis
DBLoggerSchema.index({ createdAt: -1 }); // Chronological log retrieval
