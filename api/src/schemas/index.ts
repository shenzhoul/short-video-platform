/**
 * Centralized Schema Exports
 *
 * This file provides a single entry point for importing all MongoDB schemas across the application.
 * Schemas are organized by domain for better maintainability and understanding.
 *
 * Domain Organization:
 * - Shared: Cross-cutting schemas (mailer, file, logger)
 * - Identity: User authentication and management schemas
 * - Publishing: Platform-managed content schemas (banners, categories, posts)
 * - Community: User interaction schemas (comments, reactions, messaging, streaming)
 * - Content: Creator-generated content schemas (posts, products, tags)
 * - Finance: Payment processing and financial operation schemas
 * - System: Platform administration and settings schemas
 *
 * Usage:
 * ```typescript
 * // Import specific schemas (recommended)
 * import { UserSchema, CreatorSchema } from 'src/schemas';
 *
 * // Or import from domain-specific files
 * import { UserSchema } from 'src/schemas/identity/user';
 * ```
 */

// Identity schemas
export * from './identity/auth';
export * from './identity/user';

// System schemas
export * from './system/setting';

// Content schemas
export * from './content';

// Community schemas
export * from './community/comment';
export * from './community/notification';
export * from './community/reaction';