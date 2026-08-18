import { Global, Module } from "@nestjs/common";
import { HttpModule } from '@nestjs/axios';

// Centralized providers imports
import { appProviders } from './app-providers';
// Centralized controller imports
import { appControllers } from "src/controllers/app-controller";

import { ConfigModule, ConfigService } from "@nestjs/config";
import configuration from './config';
import { MongooseModule } from "@nestjs/mongoose";
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
// Centralized schema imports
import { mongooseFeatures } from './schemas/mongoose-features';
import { CoreQueueModule } from './kernel';

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
        socketTimeoutMS: parseInt(process.env.MONGO_SOCKET_TIMEOUT_MS, 10) || 45000,
        serverSelectionTimeoutMS: parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 10) || 10000,
        heartbeatFrequencyMS: parseInt(process.env.MONGO_HEARTBEAT_FREQUENCY_MS, 10) || 10000,
        retryWrites: process.env.MONGO_RETRY_WRITES !== 'false',
        retryReads: process.env.MONGO_RETRY_READS !== 'false'
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
          useRedisCluster: queue.REDIS_QUEUE_USE_CLUSTER_MODE,
          redisPrefix: redisConfig.redisPrefix,
          prefixLength: redisConfig.prefixLength,
          skipVersionCheck: redisConfig.skipVersionCheck,
          enableTelemetry: redisConfig.enableTelemetry
        };
      },
      inject: [ConfigService]
    }),
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 5
    })
  ],
  // Centralized controllers registration
  controllers: appControllers,
  // Centralized providers registration
  providers: [...appProviders],
  exports: [],
})

export class AppModule { }

export default AppModule;