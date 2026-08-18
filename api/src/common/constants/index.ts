/**
 * Constants Index
 *
 * Centralized export for all domain constants.
 * This file provides a single entry point for importing constants across the application.
 *
 * Domain Organization:
 * - identity: User & authentication management
 * - content: Creator-generated content (videos, photos)
 * - publishing: Platform-managed content (posts, categories)
 * - community: User interactions (messaging, comments, reactions, notifications, reports)
 * - system: Platform administration (settings, contact, statistics)
 * - shared: Cross-cutting concerns and utilities
 *
 * Usage Examples:
 * ```typescript
 * // Import specific domain constants (recommended)
 * import { USER_ROLES, USER_STATUS } from 'src/constants/identity';
 *
 * // Import from main index (for convenience)
 * import { USER_ROLES } from 'src/constants';
 * ```
 */

// ===== DOMAIN EXPORTS =====

// Identity Domain - User & authentication management
export * from './identity';

// Content Domain - User-generated content
export * from './content';

// Community Domain - User interactions & social features
export * from './community';

// Shared Domain - Cross-cutting concerns
export * from './shared';

// System Domain - Settings and platform configuration
export * from './system';

// Username constants
export * from './username.constants';
