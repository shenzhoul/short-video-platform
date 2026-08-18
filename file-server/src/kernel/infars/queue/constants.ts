import { ModuleMetadata } from '@nestjs/common';
import { Job, JobsOptions } from 'bullmq';
import { Redis, RedisOptions } from 'ioredis';

export class Event {
  channel: string;

  eventName: string;

  data: any;

  priority?: number;

  constructor(data: Event) {
    Object.assign(this, data);
  }
}

export const CORE_QUEUE_MODULE_REDIS_CONFIG = 'CORE_QUEUE_MODULE_REDIS_CONFIG';

/**
 * Redis instance
 */
export const CORE_QUEUE_MESSAGE_REDIS_CONNECTION = 'CORE_QUEUE_MESSAGE_REDIS_CONNECTION';

/**
 * redis key to store topics of each channels
 * once fire a message queue event, system will loop these topics and send queue event to that
 * channel and topic should be defined in configuration file instead of redis server in future
 */
export const QUEUE_MESSAGE_CHANNEL_TOPICS_REDIS_KEY = 'QUEUE_MESSAGE_CHANNEL_TOPICS';

/**
 * redis key to store registered channel
 */
export const QUEUE_SUBSCRIBE_CHANNELS_SET = 'QUEUE_SUBSCRIBE_CHANNELS';
export const QUEUE_SUBSCRIBE_CHANNELS_TOPICS_PREFIX = 'QUEUE_SUBSCRIBE_CHANNELS_TOPICS_';

export const CORE_QUEUE_MODULE_CONFIG_OPTIONS = 'CORE_QUEUE_MODULE_CONFIG_OPTIONS';

export interface CoreQueueModuleConfigOptions {
  /**
   * redis configuration string, check more info here https://ioredis.readthedocs.io/en/latest/API/
   */
  redisConfig?: RedisOptions;
  /**
   * if use redis cluster mode we have to enable prefix. check here https://docs.bullmq.io/bull/patterns/redis-cluster
   */
  useRedisCluster?: boolean;
  /**
   * Custom prefix for Redis keys. If not provided, will use auto-generated hash-based prefix.
   * Useful for multi-tenant applications or environment separation.
   * Example: 'prod', 'staging', 'tenant-123'
   */
  redisPrefix?: string;
  /**
   * Length of auto-generated prefix hash. Default is 5 characters.
   * Only used when redisPrefix is not provided.
   */
  prefixLength?: number;
  /**
   * Enable telemetry for monitoring and observability.
   * Available in BullMQ v5.22.0+
   */
  enableTelemetry?: boolean;
  /**
   * Skip version check for Redis compatibility.
   * Available in BullMQ v5.56.4+
   */
  skipVersionCheck?: boolean;
}

export interface CoreQueueModuleAsyncConfigOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory?: (
    ...args: any
  ) => Promise<{
    redisConfig: RedisOptions;
    /**
    * if use redis cluster mode we have to enable prefix. check here https://docs.bullmq.io/bull/patterns/redis-cluster
    */
    useRedisCluster?: boolean;
    /**
     * Custom prefix for Redis keys. If not provided, will use auto-generated hash-based prefix.
     */
    redisPrefix?: string;
    /**
     * Length of auto-generated prefix hash. Default is 5 characters.
     */
    prefixLength?: number;
    /**
     * Enable telemetry for monitoring and observability.
     */
    enableTelemetry?: boolean;
    /**
     * Skip version check for Redis compatibility.
     */
    skipVersionCheck?: boolean;
  }>;
  inject?: any[];
}

export interface IRedisQueueParams {
  redisQueueConnection: Redis;
  redisConfig: any;
  useRedisCluster: boolean;
  redisPrefix?: string;
  prefixLength?: number;
  enableTelemetry?: boolean;
  skipVersionCheck?: boolean;
}

export interface QueueEvent<T> {
  channel?: string;
  eventName: string;
  data?: T | any;
}

export interface QueueEventListener<T> extends Omit<Job, 'data'> {
  data: QueueEvent<T>
}

export interface IQueueJobOptions {
  data?: any;

  jobOptions?: JobsOptions;

  /**
   * add job to unique job list, because if we change job name in future, it still have on redis
   * need to ignore if any
   * jobId must be provided
   */
  jobUnique?: boolean;

  removePreviousJob?: boolean;
}
