/* eslint-disable import/newline-after-import */
/* eslint-disable import/first */
require('dotenv').config();

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { accessSync, constants, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { AppModule } from './app.module';
import { DBLoggerService, HttpExceptionLogFilter } from './common/lib/logger';
import { TusServerService } from './services/tus/tus-server.service';

/**
 * Bootstrap the NestJS application with all necessary configurations
 * Sets up CORS, validation pipes, WebSocket adapter, Swagger docs, and starts the server
 * @returns Promise<void>
 */
async function bootstrap() {
  const bootstrapLogger = new Logger('Bootstrap');

  // Ensure required storage directories exist and are writable before the app starts
  const requiredDirs = [
    process.env.FILE_TEMP_DIR || join(__dirname, '..', 'temp'),
    process.env.FILE_PUBLIC_DIR || join(__dirname, '..', 'public')
  ];
  for (const dir of requiredDirs) {
    const absDir = resolve(dir);
    mkdirSync(absDir, { recursive: true });
    accessSync(absDir, constants.W_OK);
    bootstrapLogger.log(`Storage directory ensured: ${absDir}`);
  }

  if (!process.env.API_SECRET_KEY) {
    bootstrapLogger.warn('API_SECRET_KEY is not configured; authenticated internal file-server routes may reject requests with 401.');
  }

  if (!process.env.INTERNAL_API_KEY) {
    bootstrapLogger.warn('INTERNAL_API_KEY is not configured; internal-only file-server routes may reject requests with 403.');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
    logger: process.env.NODE_ENV === 'development' ? ['error', 'warn', 'log', 'debug', 'verbose'] : ['error', 'warn', 'debug']
  });
  const httpAdapter = app.getHttpAdapter();

  // Configure logger based on environment
  if (process.env.NODE_ENV === 'production') {
    // Use DBLoggerService for production
    // Log levels can be configured via LOG_LEVELS environment variable
    // Default production levels: 'error', 'warn', 'log'
    // Example: LOG_LEVELS=error,warn,log
    const dbLoggerService = app.get(DBLoggerService);
    app.useLogger(dbLoggerService);
  }

  // SECURITY FIX: Implement proper CORS configuration with allowed origins
  const corsOrigins = process.env.CORS_ORIGIN?.split(',') || '*';
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
    // allowedHeaders: '*' // since we have tus upload and many custom headers
  });
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    transformOptions: {
      enableImplicitConversion: true
    }
  }));
  app.useGlobalFilters(new HttpExceptionLogFilter(httpAdapter));
  const configService = app.get(ConfigService);

  if (process.env.NODE_ENV === 'development') {
    // generate api docs
    const options = new DocumentBuilder()
      .setTitle('API docs')
      .setDescription('The API docs')
      .setVersion('1.0')
      .addTag('api')
      .build();
    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('apidocs', app, document);
  }

  // Setup TUS server using the dedicated service
  const tusServerService = app.get(TusServerService);
  tusServerService.setupWithFileService(app);

  const appConfig = configService.get('app');
  const port = process.env.HTTP_PORT || appConfig.port;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 Application is running on: http://localhost:${port}`);

  // Setup graceful shutdown handlers
  process.on('SIGINT', async () => {
    await app.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await app.close();
    process.exit(0);
  });
}

void bootstrap();
