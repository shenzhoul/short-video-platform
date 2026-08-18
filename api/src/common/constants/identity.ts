/**
 * Identity Domain Constants
 *
 * This file contains all constants related to user identity management,
 * authentication, authorization, and user relationships.
 *
 * Domains covered:
 * - User account management and statuses
 * - Creator profiles and statuses
 * - Authentication and authorization
 * - User blocking and relationships
 */

// ===== USER CONSTANTS =====

/**
 * User role definitions
 * Defines the different types of users in the system
 */
export const USER_ROLES = {
  /** System administrator with full access */
  ADMIN: 'admin',
  /** Regular user */
  USER: 'user'
} as const;

/**
 * User account status values
 * Tracks the lifecycle and verification status of user accounts
 */
export const USER_STATUS = {
  /** Account active and verified */
  ACTIVE: 'active',
  /** Account deactivated or suspended */
  INACTIVE: 'inactive',
  /** Account under review for chargebacks */
  UNDER_REVIEW: 'under-review',
  /** Account permanently deleted (soft delete) */
  DELETED: 'deleted'
} as const;

/**
 * Creator-related event channels
 * Socket/queue channels for creator events
 */
export const CREATOR_CHANNELS = {
  /** General creator events channel */
  CREATOR: 'CREATOR_CHANNEL'
} as const;

/**
 * User gender options
 * Available gender selections for user profiles
 */
export const USER_GENDER = {
  /** Male gender */
  MALE: 'male',
  /** Female gender */
  FEMALE: 'female'
} as const;

// Array versions for validation
export const USER_STATUS_VALUES = Object.values(USER_STATUS);
export const USER_GENDER_VALUES = Object.values(USER_GENDER);

// ===== TYPE EXPORTS =====

/**
 * Type definitions derived from constants
 * Provides TypeScript type safety for constant values
 */
export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES];
export type UserStatus = typeof USER_STATUS[keyof typeof USER_STATUS];
