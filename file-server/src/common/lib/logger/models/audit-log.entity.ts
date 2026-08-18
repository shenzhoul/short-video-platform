import { Document, Schema } from 'mongoose';

/**
 * Interface for Audit Log document
 * Represents audit trail entries for tracking user actions and system events
 */
export interface IAuditLog extends Document {
  /** User ID associated with the audit log entry */
  userId?: number;

  /** Type of audit event (e.g., 'auth', 'payment', 'content') */
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
 */
export const AuditLogSchema = new Schema<IAuditLog>({
  userId: {
    type: Number,
    index: true // Index for efficient user-based queries
  },
  type: {
    type: String,
    required: true,
    index: true // Index for efficient type-based filtering
  },
  action: {
    type: String,
    required: true,
    index: true // Index for efficient action-based filtering
  },
  data: {
    type: Object
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true // Index for efficient time-based queries
  }
}, {
  collection: 'audit_logs',
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

// Compound indexes for efficient querying
AuditLogSchema.index({ userId: 1, createdAt: -1 }); // User audit history
AuditLogSchema.index({ type: 1, createdAt: -1 }); // Type-based audit queries
AuditLogSchema.index({ action: 1, createdAt: -1 }); // Action-based audit queries
