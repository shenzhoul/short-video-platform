/**
 * Redis configuration for caching, sessions, and real-time Socket.IO features
 *
 * Supports both single instance and cluster configurations:
 * - Single instance: Default mode for most applications (development, small-scale production)
 * - Cluster mode: For high availability and horizontal scaling (large-scale production)
 *
 * Configuration is automatically detected based on environment variables:
 * - REDIS_SERVER_TYPE: 'single' (default) or 'cluster'
 * - REDIS_CLUSTER_NODES: Comma-separated list of cluster nodes (auto-enables cluster mode)
 *
 * @example Single Instance
 * ```
 * REDIS_SERVER_TYPE=single
 * REDIS_HOST=127.0.0.1
 * REDIS_PORT=6379
 * ```
 *
 * @example Cluster Mode
 * ```
 * REDIS_SERVER_TYPE=cluster
 * REDIS_CLUSTER_NODES=node1:6379,node2:6379,node3:6379
 * ```
 */
export default {
  /**
   * Redis server type - 'single' for standalone, 'cluster' for Redis cluster
   * Default: 'single' (recommended for most applications)
   */
  type: process.env.REDIS_SERVER_TYPE || 'single',

  options: {
    /** Redis server hostname or IP address (for single instance mode) */
    host: process.env.REDIS_HOST || '127.0.0.1',

    /** Redis server port number (for single instance mode) */
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,

    /** Redis database number to use (0-15, ignored in cluster mode) */
    db: parseInt(process.env.REDIS_DB, 10) || 0,

    /** Redis authentication password (required for secured Redis instances) */
    password: process.env.REDIS_PASSWORD || undefined,

    /** Redis username for authentication (Redis 6+ ACL support) */
    username: process.env.REDIS_USERNAME || undefined,

    /**
     * Key prefix for all Redis keys to avoid conflicts
     * Recommended for multi-tenant applications or environment separation
     * Required for cluster mode to ensure proper key distribution
     */
    keyPrefix: process.env.REDIS_PREFIX || undefined,

    /**
     * TLS configuration for secure Redis connections
     * Enable for production environments with encrypted Redis (AWS ElastiCache, Redis Cloud)
     */
    tls: ['true', '1'].includes(process.env.REDIS_TLS) ? {} : undefined,

    /**
     * Cluster nodes configuration (for cluster mode only)
     * Format: "host1:port1,host2:port2,host3:port3"
     * Auto-enables cluster mode when provided
     */
    nodes: process.env.REDIS_CLUSTER_NODES
      ? process.env.REDIS_CLUSTER_NODES.split(',').map((node) => {
        const [host, port] = node.trim().split(':');
        return { host, port: parseInt(port, 10) || 6379 };
      }) : undefined,

    /**
     * Connection retry and error handling options
     * Helps prevent unhandled error events during development shutdown
     */
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true,

    /**
     * Suppress common connection errors during shutdown
     * Prevents EPIPE and other connection errors from being logged
     */
    showFriendlyErrorStack: process.env.REDIS_SHOW_FRIENDLY_ERRORS === 'true'
  }
};
