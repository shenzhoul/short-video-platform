import { Document, Schema } from 'mongoose';

/**
 * Interface for Audit Log document
 * Represents audit trail entries for tracking user actions and system events
 */
export interface IAuditLog extends Document {
  /**
   * User ID associated with the audit log entry (MongoDB ObjectId as string)
   */
  userId?: string;

  /** Type of audit event (e.g., 'auth', 'content') */
  type: string;

  /** Specific action performed (e.g., 'login', 'logout', 'create', 'update') */
  action: string;

  /** Additional data related to the audit event */
  data?: Record<string, any>;

  /** Timestamp when the audit log was created */
  createdAt: Date;
}

/**
 * Mongoose schema for Audit Log collection
 * Used for tracking user actions and system events for compliance and debugging
 *
 * Indexing Strategy:
 * - Uses compound indexes instead of single-field indexes for better performance
 * - Compound indexes can serve queries on their prefix fields (e.g., {userId, createdAt} covers userId queries)
 * - This reduces index overhead and improves write performance
 */
export const AuditLogSchema = new Schema<IAuditLog>({
  userId: {
    type: String
  },
  type: {
    type: String,
    required: true
  },
  action: {
    type: String,
    required: true
  },
  data: {
    type: Object
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'audit_logs',
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

/**
 * Compound indexes for efficient querying
 * These compound indexes also cover single-field queries on their prefix fields:
 * - {userId: 1, createdAt: -1} covers: userId queries + userId+createdAt queries
 * - {type: 1, createdAt: -1} covers: type queries + type+createdAt queries
 * - {action: 1, createdAt: -1} covers: action queries + action+createdAt queries
 */
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ type: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
