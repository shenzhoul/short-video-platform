import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import configuration from './config';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

// Centralized controller imports
import { appControllers } from './controllers/app-controllers';
// Centralized providers imports
import { appProviders } from './app-providers';
// Centralized schema imports
import { mongooseFeatures } from './schemas/mongoose-features';

import { UserLangResolver } from './common/user-lang.resolver';
import { join } from 'path';
import { existsSync } from 'fs';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TranslationService } from './common/services/translation.service';
import { SettingService } from './services/system/setting/setting.service';
import { setTranslationService } from './utils/translation';
import { AcceptLanguageResolver, I18N_OPTIONS, I18nJsonLoader, I18nMiddleware, I18nModule, QueryResolver } from 'nestjs-i18n';
import { I18nMessageFormat } from 'nestjs-i18n/dist/utils';
import { ThrottlerModule } from '@nestjs/throttler';
import { CoreQueueModule } from 'src/kernel';
import { DBLoggerService } from './common/lib/logger';
import { RequestLoggerMiddleware } from './common/lib/logger/request-log.middleware';

const resolveI18nPath = () => {
  const candidates = [
    join(process.cwd(), 'i18n'),
    join(process.cwd(), 'api', 'i18n'),
    join(__dirname, '..', 'i18n')
  ];

  return candidates.find(candidate => existsSync(candidate)) || candidates[0];
};

/**
 * Main application module that configures and bootstraps the entire NestJS application
 * Sets up database connections, Redis, queues, static file serving, and middleware
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration]
    }),
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loader: I18nJsonLoader,
      loaderOptions: {
        path: resolveI18nPath(),
        watch: true
      },
      resolvers: [
        new UserLangResolver(), // 1st: req.user.language
        new QueryResolver(['lang']), // 2nd: ?lang=
        new AcceptLanguageResolver() // 3rd: Accept-Language header
      ]
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public')
    }),
    MongooseModule.forRootAsync({
      useFactory: () => ({
        uri: process.env.MONGO_URI,
        // Enhanced connection pool settings for production stability
        maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE, 10) || 50,
        minPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE, 10) || 5,
        maxIdleTimeMS: parseInt(process.env.MONGO_MAX_IDLE_TIME_MS, 10) || 60000,
        waitQueueTimeoutMS: parseInt(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS, 10) || 30000,
        connectTimeoutMS: parseInt(process.env.MONGO_CONNECT_TIMEOUT_MS, 10) || 10000,
        socketTimeoutMS: parseInt(process.env.MONGO_SOCKET_TIMEOUT_MS, 10) || 45000
      })
    }),
    // Centralized schema registration
    mongooseFeatures,
    CoreQueueModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const queue = configService.get('queue');
        const redisConfig = queue.REDIS_QUEUE_CONFIG;
        return {
          redisConfig,
          redisPrefix: redisConfig.redisPrefix,
          prefixLength: redisConfig.prefixLength,
          skipVersionCheck: redisConfig.skipVersionCheck,
          enableTelemetry: redisConfig.enableTelemetry
        };
      },
      inject: [ConfigService]
    }),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const redisConfig = configService.get('redis');

        // Add error handling configuration to suppress EPIPE errors
        return {
          ...redisConfig,
          onClientCreated: (client: Redis) => {
            // Add error handler to suppress EPIPE errors during shutdown
            client.on('error', (err: any) => {
              if (err.code === 'EPIPE' || err.code === 'ECONNRESET' || err.message?.includes('EPIPE')) {
                // Silently ignore connection errors during shutdown
                return;
              }
              // Log other Redis errors that are not connection-related
              if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.error('Redis client error:', err);
              }
            });
          }
        };
      },
      inject: [ConfigService]
    }),
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5
    }),
    // Rate limiting configuration for authentication endpoints
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const throttlerConfig = configService.get('throttler');
        const redisConfig = configService.get('redis');

        const config: any = {
          throttlers: throttlerConfig.throttlers
        };

        // Conditionally add Redis storage if configured
        if (throttlerConfig.storageType === 'redis' && redisConfig) {
          const redis = new Redis(redisConfig.options);

          // Suppress unhandled error events during shutdown
          redis.on('error', (err: any) => {
            if (err.code === 'EPIPE' || err.code === 'ECONNRESET' || err.message?.includes('EPIPE')) {
              // Silently ignore connection errors during shutdown
              return;
            }
            // Log other Redis errors that are not connection-related
            if (process.env.NODE_ENV !== 'production') {
              // eslint-disable-next-line no-console
              console.error('Redis error:', err);
            }
          });

          config.storage = new ThrottlerStorageRedisService(redis);
        }
        // If storageType is 'memory' or Redis is not available, use default memory storage

        return config;
      },
      inject: [ConfigService]
    }),
  ],
  // Centralized controllers registration
  controllers: appControllers,
  // Centralized providers registration
  providers: [
    ...appProviders,
    DBLoggerService,
    TranslationService,
    {
      provide: I18nMessageFormat,
      useFactory: (options: any) => new I18nMessageFormat(options),
      inject: [I18N_OPTIONS]
    }
  ]
})

export class AppModule implements NestModule {
  /**
    * Initialize the app module and sync settings cache on startup
    * @param settingService - Service for managing application settings
    * @param translationService - Service for managing translations
    */
  constructor(
    private settingService: SettingService,
    private translationService: TranslationService
  ) {
    this.settingService.syncCache();
    setTranslationService(this.translationService);
  }

  /**
   * Configure middleware for specific routes
   * @param consumer - Middleware consumer for route configuration
   */
  configure(consumer: MiddlewareConsumer) {
    // Apply i18n middleware globally
    consumer
      .apply(I18nMiddleware)
      .forRoutes('*');

    consumer
      .apply(RequestLoggerMiddleware)
  }
}

export default AppModule;
