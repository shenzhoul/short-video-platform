import { DynamicModule, Global, Module } from '@nestjs/common';
import IORedis from 'ioredis';

import {
  CORE_QUEUE_MESSAGE_REDIS_CONNECTION, CORE_QUEUE_MODULE_CONFIG_OPTIONS, CoreQueueModuleAsyncConfigOptions, CoreQueueModuleConfigOptions
} from './constants';
import { QueueService } from './queue.service';
import { QueueMessageService } from './queue-message.service';

// Type alias for better semantic naming - QueueMessageService provides pub-sub functionality
export { QueueMessageService as PubSubService } from './queue-message.service';

/**
 * Core Queue Module - Provides both Job Queues and Publish-Subscribe Messaging
 *
 * This module exports two main services:
 *
 * 1. **QueueService** - Traditional job queue processing
 *    - One job → exactly one worker processes it
 *    - Use for: background tasks, delayed jobs, scheduled jobs
 *
 * 2. **QueueMessageService (alias: PubSubService)** - Publish-Subscribe messaging
 *    - One message → all subscribed worker types receive it
 *    - Use for: event notifications, real-time updates, system-wide events
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
 * export class AppModule {}
 * ```
 *
 * @example Job Queue Usage (QueueService)
 * ```typescript
 * @Injectable()
 * export class ImageService {
 *   constructor(private readonly queueService: QueueService) {}
 *
 *   async processImage(imageUrl: string) {
 *     // Add job to queue - only ONE worker will process this
 *     await this.queueService.add('image_processing', 'resize_image', {
 *       data: { imageUrl, size: '300x300' }
 *     });
 *   }
 * }
 * ```
 *
 * @example Pub-Sub Usage (QueueMessageService)
 * ```typescript
 * @Injectable()
 * export class EventService {
 *   constructor(
 *     private readonly pubSubService: QueueMessageService // or PubSubService
 *   ) {}
 *
 *   async onModuleInit() {
 *     // Multiple services subscribe to same channel
 *     await this.pubSubService.subscribe('user_events', 'email_service', this.sendEmail);
 *     await this.pubSubService.subscribe('user_events', 'push_service', this.sendPush);
 *     await this.pubSubService.subscribe('user_events', 'analytics', this.trackEvent);
 *   }
 *
 *   async userRegistered(userId: string, email: string) {
 *     // Publish once → ALL 3 services receive the message
 *     await this.pubSubService.publish('user_events', {
 *       eventName: 'user_registered',
 *       data: { userId, email }
 *     });
 *   }
 *
 *   private async sendEmail(job) { // email logic }
 *   private async sendPush(job) { // push logic }
 *   private async trackEvent(job) { // analytics logic }
 * }
 * ```
 */
@Global()
@Module({})
export class CoreQueueModule {
  static register(options: CoreQueueModuleConfigOptions): DynamicModule {
    const redisConfig = options.redisConfig || {
      host: 'localhost',
      port: 6379,
      db: 0
    } as any;
    const redisQueueConnection = new IORedis({
      ...redisConfig,
      // bull MQ requires this option
      maxRetriesPerRequest: null
    });
    // do not connect redis connection. BullMQ will throw error if it is already connected
    // await redisQueueConnection.connect();
    // TODO - log me

    return {
      module: CoreQueueModule,
      providers: [
        {
          provide: CORE_QUEUE_MODULE_CONFIG_OPTIONS,
          useValue: options
        },
        {
          provide: CORE_QUEUE_MESSAGE_REDIS_CONNECTION,
          useValue: {
            redisQueueConnection,
            redisConfig,
            useRedisCluster: options.useRedisCluster,
            redisPrefix: options.redisPrefix,
            prefixLength: options.prefixLength,
            skipVersionCheck: options.skipVersionCheck,
            enableTelemetry: options.enableTelemetry
          }
        },
        QueueMessageService,
        QueueService
      ],
      exports: [
        QueueMessageService,
        QueueService
      ]
    };
  }

  static async registerAsync(options: CoreQueueModuleAsyncConfigOptions): Promise<DynamicModule> {
    // do not connect redis connection. BullMQ will throw error if it is already connected
    // await redisQueueConnection.connect();
    // TODO - log me
    const asyncProviders = {
      inject: options.inject || [],
      provide: CORE_QUEUE_MESSAGE_REDIS_CONNECTION,
      useFactory: async (factoryOptions) => {
        const { redisConfig, ...rests } = await options.useFactory(factoryOptions);
        const redisQueueConnection = new IORedis({
          ...redisConfig,
          // bull MQ requires this option
          maxRetriesPerRequest: null
        });
        return {
          redisQueueConnection,
          redisConfig,
          ...rests
        };
      }
    };

    return {
      module: CoreQueueModule,
      imports: options.imports,
      providers: [
        {
          provide: CORE_QUEUE_MODULE_CONFIG_OPTIONS,
          useValue: options
        },
        asyncProviders,
        QueueMessageService,
        QueueService
      ],
      exports: [
        QueueMessageService,
        QueueService
      ]
    };
  }
}
