import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Processor, Queue, Worker } from 'bullmq';
import { createHash } from 'crypto';

import {
  CORE_QUEUE_MESSAGE_REDIS_CONNECTION,
  IRedisQueueParams,
  QueueEvent
} from './constants';
import { QueueWorkerHolderSingleton } from './queue-workers-holder';

/**
 * Publish-Subscribe Message Service using BullMQ
 *
 * This service implements a true publish-subscribe pattern where:
 * - Multiple worker types can subscribe to the same channel
 * - Publishing to a channel delivers messages to ALL subscribed worker types
 * - Each channel-worker combination gets its own queue for isolation
 * - Horizontal scaling is handled automatically by BullMQ
 *
 * @example Basic Usage
 * ```typescript
 * // Subscribe multiple services to the same channel with different concurrency
 * await pubSubService.subscribe('user_events', 'email_service', emailHandler, { concurrency: 5 });
 * await pubSubService.subscribe('user_events', 'push_service', pushHandler, { concurrency: 3 });
 * await pubSubService.subscribe('user_events', 'analytics_service', analyticsHandler, { concurrency: 1 });
 *
 * // Publish once → message delivered to ALL 3 services
 * await pubSubService.publish('user_events', {
 *   eventName: 'user_registered',
 *   data: { userId: '123', email: 'user@example.com' }
 * });
 * ```
 *
 * @example Horizontal Scaling
 * ```
 * Instance A          Instance B          Instance C
 * ├─ email_service    ├─ email_service    ├─ email_service
 * ├─ push_service     ├─ push_service     ├─ push_service
 * └─ analytics        └─ analytics        └─ analytics
 *          │                   │                   │
 *          └───────────────────┼───────────────────┘
 *                              │
 *                     ┌────────▼────────┐
 *                     │   Redis Queues  │
 *                     │                 │
 *                     │ user_events_    │ → Only ONE instance
 *                     │   email_service │   processes each job
 *                     │                 │
 *                     │ user_events_    │ → Only ONE instance
 *                     │   push_service  │   processes each job
 *                     │                 │
 *                     │ user_events_    │ → Only ONE instance
 *                     │   analytics     │   processes each job
 *                     └─────────────────┘
 * ```
 *
 * @example Module Setup
 * ```typescript
 * @Module({
 *   imports: [
 *     CoreQueueModule.registerAsync({
 *       redisConfig: { host: 'localhost', port: 6379, db: 0 }
 *     })
 *   ]
 * })
 * export class AppModule implements OnModuleInit {
 *   constructor(private readonly pubSubService: QueueMessageService) {}
 *
 *   async onModuleInit() {
 *     // Set up subscriptions when app starts
 *     await this.pubSubService.subscribe('user_events', 'email_service', this.handleEmail);
 *     await this.pubSubService.subscribe('user_events', 'push_service', this.handlePush);
 *   }
 *
 *   private async handleEmail(job) {
 *     console.log('📧 Processing email:', job.data);
 *     // Send email logic here
 *   }
 *
 *   private async handlePush(job) {
 *     console.log('📱 Processing push:', job.data);
 *     // Send push notification logic here
 *   }
 * }
 * ```
 *
 * @example Dynamic Management
 * ```typescript
 * // Get system statistics
 * const stats = await pubSubService.getSubscriptionStats();
 * console.log('Channels:', stats.totalChannels);
 * console.log('Active workers:', stats.totalWorkers);
 *
 * // Add new service to existing channel
 * await pubSubService.subscribe('user_events', 'audit_service', auditHandler);
 *
 * // Remove service from channel
 * await pubSubService.unsubscribe('user_events', 'audit_service');
 *
 * // List all active channels
 * const channels = pubSubService.getActiveChannels();
 * console.log('Active channels:', channels);
 * ```
 *
 * Key Features:
 * - ✅ True pub-sub pattern with fanout messaging
 * - ✅ Automatic horizontal scaling via BullMQ
 * - ✅ Reliable message delivery with retry logic
 * - ✅ Dynamic subscription management
 * - ✅ Comprehensive error handling and logging
 * - ✅ Production-ready monitoring and statistics
 * - ✅ Redis cluster compatibility
 */
@Injectable()
export class QueueMessageService implements OnModuleDestroy {
  /** Static map of available channel topics for message routing */
  public static _availableChannelTopics = {} as Record<string, Array<string>>;

  /** Map of queue names to Queue instances */
  protected _queues = {} as Record<string, Queue>;

  /** Array of worker names that have been created */
  protected _workers = [] as Array<string>;

  /**
   * Creates a new QueueMessageService instance
   * @param redisQueueParams - Redis connection parameters for queue operations
   */
  constructor(
    @Inject(CORE_QUEUE_MESSAGE_REDIS_CONNECTION) private readonly redisQueueParams: IRedisQueueParams
  ) { }

  async onModuleDestroy() {
    const queues = Object.values(this._queues);
    await Promise.allSettled(queues.map((queue) => queue.close()));
    this._queues = {};
  }

  /**
   * Creates a new queue with the specified name
   * @param name - The name of the queue to create
   * @returns The created Queue instance
   */
  public createQueue(name: string) {
    if (this._queues[name]) return this._queues[name];

    try {
      const { redisConfig, skipVersionCheck } = this.redisQueueParams;
      const prefix = this.getQueuePrefix(name);

      const queue = new Queue(name, {
        defaultJobOptions: {
          removeOnComplete: 10, // Keep last 10 completed jobs for debugging
          removeOnFail: {
            age: 3600, // Remove failed jobs after 1 hour
            count: 50 // Keep max 50 failed jobs
          },
          attempts: 3, // Retry failed jobs up to 3 times
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        },
        connection: redisConfig,
        // https://docs.bullmq.io/bull/patterns/redis-cluster
        prefix: `{${prefix}}`,
        ...(skipVersionCheck && { skipVersionCheck: true })
      });

      this._queues[name] = queue;
      return queue;
    } catch (error) {
      console.error(`❌ Failed to create queue ${name}:`, error);
      throw error;
    }
  }

  /**
   * Publishes a message to all subscribers of a channel
   * @param channel - The channel to publish to
   * @param data - The event data to publish
   * @param jobName - Optional job name, defaults to event name
   * @param priority - Optional job priority
   */
  async publish(channel: string, data: QueueEvent<any>, jobName = '', priority?: number): Promise<void> {
    try {
      const topics = await this.getTopicsByChannel(channel);
      if (!topics || !topics.length) {
        console.warn(`⚠️ No subscribers found for channel: ${channel}`);
        return;
      }

      const publishPromises = topics.map(async (queueName) => {
        try {
          const channelQueue = this.createQueue(queueName);
          return await channelQueue.add(jobName || data.eventName, data, {
            ...(priority && { priority })
          });
        } catch (error) {
          console.error(`❌ Failed to publish to queue ${queueName}:`, error);
          throw error;
        }
      });

      await Promise.all(publishPromises);
    } catch (error) {
      console.error(`❌ Failed to publish to channel ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Subscribes to a specific topic within a channel
   * @param channel - The channel to subscribe to
   * @param topic - The specific topic within the channel
   * @param handler - The processor function to handle messages
   * @param options - Optional worker configuration options
   * @param options.concurrency - Number of jobs to process concurrently (default: 1)
   * @example
   * // High concurrency for bulk operations like emails
   * await service.subscribe('notifications', 'email_service', handler, { concurrency: 5 });
   * ```
   */
  async subscribe(channel: string, topic: string, handler: Processor<any, any, string>, options = {} as Record<string, any>): Promise<void> {
    try {
      // Register the subscription
      await this.setChannelTopic(channel, topic);

      const { redisConfig, skipVersionCheck } = this.redisQueueParams;
      const workerName = `${channel}_${topic}`;

      if (this._workers.includes(workerName) || QueueWorkerHolderSingleton.getByName(workerName)) {
        if (!this._workers.includes(workerName)) this._workers.push(workerName);
        return;
      }

      if (!this._workers.includes(workerName)) {
        this._workers.push(workerName);
        const prefix = this.getQueuePrefix(workerName);
        const {
          concurrency = 1,
          lockDuration = 120000,
          lockRenewTime = 30000,
          maxStalledCount = 2,
          ...workerOptions
        } = options;

        const worker = new Worker(workerName, handler, {
          concurrency, // Configurable concurrency, defaults to 1
          autorun: false,
          lockDuration,
          lockRenewTime,
          maxStalledCount,
          connection: redisConfig,
          prefix: `{${prefix}}`,
          ...(skipVersionCheck && { skipVersionCheck: true }),
          ...workerOptions
        });

        // Add error handling for worker
        worker.on('error', (error) => {
          console.error(`❌ Worker ${workerName} error:`, error);
        });

        worker.on('failed', (job, error) => {
          console.error(`❌ Job ${job?.id} in worker ${workerName} failed:`, error);
        });

        worker.run();
        QueueWorkerHolderSingleton.addToList(worker);
      }
    } catch (error) {
      console.error(`❌ Failed to subscribe to channel ${channel}, topic ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Get all channels that have active subscriptions
   */
  public getActiveChannels(): string[] {
    return Object.keys(QueueMessageService._availableChannelTopics);
  }

  /**
   * Get all topics subscribed to a specific channel
   */
  public getChannelTopics(channel: string): string[] {
    return QueueMessageService._availableChannelTopics[channel] || [];
  }

  /**
   * Get subscription statistics
   */
  public getSubscriptionStats() {
    const channels = Object.keys(QueueMessageService._availableChannelTopics);
    const stats = {
      totalChannels: channels.length,
      totalQueues: Object.keys(this._queues).length,
      totalWorkers: this._workers.length,
      channels: {} as Record<string, { topics: string[], topicCount: number }>
    };

    for (const channel of channels) {
      const topics = QueueMessageService._availableChannelTopics[channel];
      stats.channels[channel] = {
        topics: topics || [],
        topicCount: topics?.length || 0
      };
    }

    return stats;
  }

  /**
   * Unsubscribe a topic from a channel
   * Gracefully shuts down the worker and cleans up resources
   */
  public async unsubscribe(channel: string, topic: string): Promise<void> {
    try {
      const workerName = `${channel}_${topic}`;
      const topicKey = `${channel}_${topic}`;

      // Remove from workers list
      const workerIndex = this._workers.indexOf(workerName);
      if (workerIndex > -1) {
        this._workers.splice(workerIndex, 1);
      }

      // Remove from available topics
      if (QueueMessageService._availableChannelTopics[channel]) {
        const topicIndex = QueueMessageService._availableChannelTopics[channel].indexOf(topicKey);
        if (topicIndex > -1) {
          QueueMessageService._availableChannelTopics[channel].splice(topicIndex, 1);
        }

        // Clean up empty channel
        if (QueueMessageService._availableChannelTopics[channel].length === 0) {
          delete QueueMessageService._availableChannelTopics[channel];
        }
      }

      // Find and close the worker
      const worker = QueueWorkerHolderSingleton.getByName(workerName);
      if (worker) {
        await worker.close();
      }

      // Clean up queue
      if (this._queues[topicKey]) {
        await this._queues[topicKey].close();
        delete this._queues[topicKey];
      }
    } catch (error) {
      console.error(`❌ Failed to unsubscribe ${topic} from channel ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves topics for a specific channel
   * @param channel - The channel to get topics for
   * @returns Array of topic names for the channel
   */
  protected async getTopicsByChannel(channel: string) {
    return QueueMessageService._availableChannelTopics[channel];
    // const key = `${QUEUE_SUBSCRIBE_CHANNELS_TOPICS_PREFIX}${channel}`;
    // const { redisQueueConnection } = this.redisQueueParams;
    // const topics = await redisQueueConnection.smembers(key);
    // return topics.map((t) => `${channel}_${t}`);
  }

  /**
   * Sets up a topic within a channel for message routing
   * @param channel - The channel name
   * @param topic - The topic name to add to the channel
   */
  protected async setChannelTopic(channel: string, topic: string) {
    // add to _availableChannelTopics
    if (!QueueMessageService._availableChannelTopics[channel]) {
      QueueMessageService._availableChannelTopics[channel] = [];
    }
    const topicKey = `${channel}_${topic}`;
    if (!QueueMessageService._availableChannelTopics[channel].includes(topicKey)) {
      QueueMessageService._availableChannelTopics[channel].push(topicKey);
    }
  }

  /**
   * Gets queue prefix for Redis cluster compatibility
   * Combines environment prefix with queue-specific prefix to avoid overlap
   * @param queueName - Name of the queue
   * @returns Prefix string for Redis keys
   */
  protected getQueuePrefix(queueName: string): string {
    const { redisPrefix, prefixLength } = this.redisQueueParams;

    // Always generate queue-specific prefix for separation
    const queueSpecificPrefix = this.shortenPrefix(queueName, prefixLength || 5);

    if (redisPrefix) {
      // Combine environment prefix with queue-specific prefix
      return `${redisPrefix}-${queueSpecificPrefix}`;
    }

    // Use only queue-specific prefix when no environment prefix is set
    return queueSpecificPrefix;
  }

  /**
   * Creates a shortened prefix using MD5 hash for Redis cluster compatibility
   * @param str - The string to hash
   * @param len - The length of the prefix to return (default: 5)
   * @returns A shortened hash prefix
   */
  protected shortenPrefix(str: string, len = 5) {
    return createHash('md5').update(str).digest('hex').substring(0, len);
  }
}
