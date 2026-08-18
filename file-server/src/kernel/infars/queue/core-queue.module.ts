import { DynamicModule, Global, Module } from '@nestjs/common';
import IORedis from 'ioredis';
import {
  CORE_QUEUE_MESSAGE_REDIS_CONNECTION,
  CORE_QUEUE_MODULE_CONFIG_OPTIONS,
  CoreQueueModuleAsyncConfigOptions,
  CoreQueueModuleConfigOptions
} from './constants';
import { QueueService } from './queue.service';
import { QueueMessageService } from './queue-message.service';

/**
 * Queue message module is a combination of messaging & queue
 * Server A can broadcast message to a channel, but only one subscriber on the same topic receives message
 * Usage
 * ```
 * @Module({
 *   imports: [
 *    CoreQueueModule.registerAsync({
 *      redisConfig: { ... } // ioredis connection config
 *    })
 *   ]
 *  })
 * ```
 * In service
 * ```
 * @Injectable()
  export class TestService {
    constructor(
      private readonly queueService: QueueMessageService
    ) { }

    async test() {
      await this.queueService.subscribe('c1', 't1', this.log.bind(this))
      await this.queueService.subscribe('c1', 't2', this.log.bind(this))
      await this.queueService.subscribe('c1', 't1', this.log.bind(this))

      await this.queueService.publish('c1', {
        eventName: 'ev',
        data: {
          foo: 'bar'
        }
      } as any)
    }

    log(job) {
      console.log(job.data)
    }
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
            prefixLength: options.prefixLength || 5,
            enableTelemetry: options.enableTelemetry || false,
            skipVersionCheck: options.skipVersionCheck || false
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
      useFactory: async (factoryOptions: any) => {
        const { redisConfig, ...rests } = await options.useFactory(factoryOptions);
        const redisQueueConnection = new IORedis({
          ...redisConfig,
          // bull MQ requires this option
          maxRetriesPerRequest: null
        });
        return {
          redisQueueConnection,
          redisConfig,
          prefixLength: rests.prefixLength || 5,
          enableTelemetry: rests.enableTelemetry || false,
          skipVersionCheck: rests.skipVersionCheck || false,
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
