/**
 * Kernel Constants - Core Application Constants
 *
 * This file contains fundamental constants used across the entire application.
 * These are low-level constants that don't belong to any specific domain.
 */

/**
 * Standard CRUD action constants
 * Used for audit logging, permissions, and event tracking
 */
export const ACTION = {
  /** Create/insert operation */
  CREATE: 'create',
  /** Update/modify operation */
  UPDATE: 'update',
  /** Delete/remove operation */
  DELETE: 'delete'
};

/**
 * Standard entity lifecycle event constants
 * Used for event-driven architecture and notifications
 */
export const EVENT = {
  /** Entity creation event */
  CREATED: 'created',
  /** Entity update event */
  UPDATED: 'updated',
  /** Entity deletion event */
  DELETED: 'deleted'
};

/**
 * Standard entity status constants
 * Used for entity state management across all domains
 */
export const STATUS = {
  /** Entity is active and operational */
  ACTIVE: 'active',
  /** Entity is inactive or disabled */
  INACTIVE: 'inactive',
  /** Entity is pending approval or activation */
  PENDING: 'pending'
};
