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
   * Custom Redis prefix for queue keys (optional)
   */
  redisPrefix?: string;
  /**
   * Length of auto-generated prefix hash (default: 5)
   */
  prefixLength?: number;
  /**
   * Skip Redis version compatibility check (default: false)
   */
  skipVersionCheck?: boolean;
  /**
   * Enable BullMQ telemetry for monitoring (default: false)
   */
  enableTelemetry?: boolean;
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
     * Custom Redis prefix for queue keys (optional)
     */
    redisPrefix?: string;
    /**
     * Length of auto-generated prefix hash (default: 5)
     */
    prefixLength?: number;
    /**
     * Skip Redis version compatibility check (default: false)
     */
    skipVersionCheck?: boolean;
    /**
     * Enable BullMQ telemetry for monitoring (default: false)
     */
    enableTelemetry?: boolean;
  }>;
  inject?: any[];
}

export interface IRedisQueueParams {
  redisQueueConnection: Redis;
  redisConfig: any;
  useRedisCluster: boolean;
  redisPrefix?: string;
  prefixLength?: number;
  skipVersionCheck?: boolean;
  enableTelemetry?: boolean;
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
