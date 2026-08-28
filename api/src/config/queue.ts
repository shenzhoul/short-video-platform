import { QUEUE_PREFIX_NAMESPACE } from 'src/kernel/infras/redis/redis-keys';

/**
 * Queue system configuration using Redis as the backing store
 * Handles background job processing for tasks like email sending, file processing, etc.
 */
export default {
  /** Redis connection configuration specifically for queue operations */
  REDIS_QUEUE_CONFIG: {
    /** Redis server port for queue operations */
    port: parseInt(process.env.REDIS_QUEUE_PORT, 10) || 6379,
    /** Redis server host for queue operations */
    host: process.env.REDIS_QUEUE_HOST || '127.0.0.1',
    /** Redis username for authentication (requires Redis >= 6) */
    username: process.env.REDIS_QUEUE_USERNAME || undefined,
    /** Redis password for authentication */
    password: process.env.REDIS_QUEUE_PASSWORD || undefined,
    /** Redis database number for queue data */
    db: process.env.REDIS_QUEUE_DB || 0,
    /** TLS configuration for secure connections (e.g., AWS ElastiCache) */
    tls: process.env.REDIS_QUEUE_TLS === 'true' ? {} : undefined,
    /**
     * Project namespace for every BullMQ key.
     *
     * BullMQ builds its own keys as `<prefix>:<queue>:<id>` and needs the braces
     * for Redis Cluster hash-tagging, so it takes a `prefix` option rather than
     * an ioredis `keyPrefix`. Defaulting it means queue keys read
     * `{douyin-clone-<queue-hash>}:…` instead of an anonymous `{<hash>}:…` in a
     * Redis shared with another project.
     */
    redisPrefix: process.env.REDIS_QUEUE_PREFIX || QUEUE_PREFIX_NAMESPACE,
    /** Length of auto-generated prefix hash (default: 5) */
    prefixLength: parseInt(process.env.REDIS_QUEUE_PREFIX_LENGTH, 10) || 5,
    /** Skip Redis version compatibility check (default: false) */
    skipVersionCheck: process.env.REDIS_QUEUE_SKIP_VERSION_CHECK === 'true',
    /** Enable BullMQ telemetry for monitoring (default: false) */
    enableTelemetry: process.env.REDIS_QUEUE_ENABLE_TELEMETRY === 'true'
  }
};
