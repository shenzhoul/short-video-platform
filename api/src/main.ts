/* eslint-disable import/newline-after-import */
/* eslint-disable import/first */
// global config for templates dir
require('dotenv').config();
process.env.TEMPLATE_DIR = `${__dirname}/../templates`;

import { LogLevel, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { DBLoggerService } from './common/lib/logger';
import { HttpExceptionLogFilter } from './common/lib/logger/http-exception-log.filter';

/**
 * Bootstrap the NestJS application with all necessary configurations
 * Sets up CORS, validation pipes, WebSocket adapter, Swagger docs, and starts the server
 * @returns Promise<void>
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const httpAdapter = app.getHttpAdapter();
  // Configure logger based on environment
  if (process.env.NODE_ENV === 'production') {
    // Use DBLoggerService for production
    // Log levels can be configured via LOG_LEVELS environment variable
    // Default production levels: 'log', 'error'
    // Example: LOG_LEVELS=error,warn,log
    const dbLoggerService = app.get(DBLoggerService);
    app.useLogger(dbLoggerService);
  } else {
    const logLevelsEnv = process.env.LOG_LEVELS;

    if (logLevelsEnv) {
      // Parse comma-separated log levels from environment
      const levels = logLevelsEnv.split(',').map((level) => level.trim() as LogLevel);
      app.useLogger(levels);
    } else {
      // Use default NestJS logger for development
      app.useLogger(['error', 'warn', 'log', 'debug', 'verbose']);
    }
  }

  // SECURITY FIX: Implement proper CORS configuration with allowed origins
  const origin = process.env.CORS_ORIGIN?.split(',').map((value) => value.trim()).filter(Boolean) || [];
  const corsOrigins = origin.length ? origin : '*';
  app.enableCors({
    origin: corsOrigins,
    credentials: true, // Allow cookies and authentication tokens
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Internal-API-Key'],
    exposedHeaders: ['X-Total-Count', 'X-Page-Count']
  });
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true
    }
  }));
  app.useGlobalFilters(new HttpExceptionLogFilter(httpAdapter));
  app.disable('x-powered-by');

  // socket io redis - for chat with enhanced configuration
  const configService = app.get(ConfigService);
  const redisIoAdapter = new RedisIoAdapter(app);

  // Enhanced Redis configuration with environment-specific settings
  const redisConfig = {
    ...configService.get('redis'),
    // Environment-specific configuration
    ...(process.env.NODE_ENV === 'production' ? {
      // Production: Full retry logic and monitoring
      retry: {
        maxAttempts: 5,
        initialDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2
      },
      healthCheck: {
        enabled: true,
        interval: 30000, // 30 seconds
        timeout: 5000 // 5 seconds
      },
      monitoring: {
        logEvents: false, // Disable in production for performance
        enableMetrics: true
      }
    } : {
      // Development: Lightweight configuration for faster restarts
      retry: {
        maxAttempts: 2,
        initialDelay: 500,
        maxDelay: 2000,
        backoffMultiplier: 1.5
      },
      healthCheck: {
        enabled: false, // Disable health checks in dev to avoid conflicts during restarts
        interval: 60000,
        timeout: 2000
      },
      monitoring: {
        logEvents: true, // Enable in development for debugging
        enableMetrics: false // Disable metrics in dev for simplicity
      }
    })
  };

  await redisIoAdapter.connectToRedis(redisConfig);
  app.useWebSocketAdapter(redisIoAdapter);

  // Add global error handler to suppress Redis EPIPE errors during shutdown
  process.on('uncaughtException', (error) => {
    if (error.message.includes('EPIPE') || error.message.includes('Connection is closed')) {
      // Suppress Redis connection errors during shutdown
      // eslint-disable-next-line no-console
      console.debug('Suppressed Redis connection error during shutdown:', error.message);
    } else {
      // Re-throw other uncaught exceptions
      // eslint-disable-next-line no-console
      console.error('Uncaught Exception:', error);
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    const reasonStr = reason instanceof Error ? reason.message : String(reason);
    if (reasonStr.includes('EPIPE') || reasonStr.includes('Connection is closed')) {
      // Suppress Redis connection errors during shutdown
      // eslint-disable-next-line no-console
      console.debug('Suppressed Redis rejection during shutdown:', reasonStr);
    } else {
      // Log other unhandled rejections
      // eslint-disable-next-line no-console
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    }
  });

  // Set up graceful shutdown handlers
  // Use simple shutdown for development, more robust for production
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const gracefulShutdown = async (signal: string) => {
      // eslint-disable-next-line no-console
      console.log(`${signal} signal received: closing HTTP server`);
      try {
        // Set a global timeout for the entire shutdown process
        const shutdownTimeout = setTimeout(() => {
          // eslint-disable-next-line no-console
          console.error('Shutdown timeout reached, forcing exit');
          process.exit(1);
        }, 10000); // 10 second total timeout

        await redisIoAdapter.shutdown(5000); // 5 second timeout

        // Close the HTTP server first before closing the app
        const server = app.getHttpServer();
        if (server) {
          await new Promise<void>((resolve) => {
            server.close(() => {
              // eslint-disable-next-line no-console
              console.log('HTTP server closed');
              resolve();
            });
          });
        }

        await app.close(); // Close the NestJS application
        clearTimeout(shutdownTimeout);
        process.exit(0);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } else {
    // Development/non-production: Use simple shutdown for faster restarts
    // This ensures proper NestJS lifecycle cleanup (OnModuleDestroy) is triggered
    const developmentShutdown = async (signal: string) => {
      // eslint-disable-next-line no-console
      console.log(`\n🛑 ${signal} signal received: closing application gracefully...`);

      try {
        // Give a short timeout for graceful shutdown in development
        const shutdownTimeout = setTimeout(() => {
          process.exit(1);
        }, 3000); // 3 second timeout for development

        await app.close();

        clearTimeout(shutdownTimeout);
        process.exit(0);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('❌ Error during development shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => developmentShutdown('SIGINT'));
    process.on('SIGTERM', () => developmentShutdown('SIGTERM'));
  }

  if (process.env.NODE_ENV === 'development') {
    // generate api docs
    const options = new DocumentBuilder()
      .setTitle('API docs')
      .setDescription('The API docs')
      .setVersion('4.0.0')
      .addTag('api')
      .addSecurity('token-auth', {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description: 'The token we get after login'
      })
      .build();
    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('apidocs', app, document);
  }

  const appConfig = configService.get('app');
  const port = process.env.HTTP_PORT || appConfig.port;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}

void bootstrap();
