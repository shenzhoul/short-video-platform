/**
 * Shared Constants Index
 *
 * This file exports all shared constants from the shared domain
 * including countries, phone codes, languages, and other utilities.
 */

// Country and region data
export * from './countries';

// ===== PAGINATION CONSTANTS =====

/**
 * Pagination defaults and limits
 * Default values and constraints for paginated API responses
 */
export const PAGINATION_DEFAULTS = {
  /** Default page size */
  PAGE_SIZE: 10,
  /** Maximum page size */
  MAX_PAGE_SIZE: 100,
  /** Default page number */
  PAGE: 1,
  /** Maximum offset allowed for traditional pagination before requiring cursor-based pagination */
  MAX_OFFSET: 2000,
  /** Default limit for queries */
  DEFAULT_LIMIT: 10,
  /** Maximum limit for queries */
  MAX_LIMIT: 50
} as const;