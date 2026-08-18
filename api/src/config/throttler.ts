/**
 * Throttler configuration for rate limiting and request throttling
 *
 * Supports both Redis and in-memory storage options:
 * - Redis storage: Recommended for production and distributed systems
 * - Memory storage: Suitable for development and single-instance deployments
 *
 * Configuration is controlled by environment variables:
 * - THROTTLER_STORAGE_TYPE: 'redis' (default) or 'memory'
 *
 * @example Redis Storage (Production)
 * ```
 * THROTTLER_STORAGE_TYPE=redis
 * ```
 *
 * @example Memory Storage (Development)
 * ```
 * THROTTLER_STORAGE_TYPE=memory
 * ```
 */
export default {
  /**
   * Storage type for throttler data
   * - 'redis': Use Redis for distributed rate limiting (recommended for production)
   * - 'memory': Use in-memory storage (suitable for development/single instance)
   * Default: 'redis'
   */
  storageType: process.env.THROTTLER_STORAGE_TYPE || 'redis',

  /**
   * Rate limiting configuration - simplified to avoid multiple throttlers
   * Specific endpoints can override using @Throttle decorator
   */
  throttlers: [
    {
      name: 'default',
      ttl: 60000, // 60 seconds
      limit: 10 // 10 requests per TTL
    }
  ]
};
