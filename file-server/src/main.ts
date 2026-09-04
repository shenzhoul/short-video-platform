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
/**
 * The allowed cross-origin callers, validated before anything is opened.
 *
 * `origin: '*'` together with `credentials: true` is not a permissive
 * configuration — it is a broken one. The spec forbids the combination, so
 * browsers reject the response outright: the wildcard does not widen access, it
 * removes it, and every credentialed request fails with an opaque CORS error
 * rather than a status anyone could diagnose.
 *
 * This matters even on a bucket deploy, where media is served from R2's custom
 * domain and never touches this service. The *upload* path still does — TUS
 * `PATCH`/`HEAD` and the direct multipart `POST` are cross-origin calls from the
 * user app, and they are exactly what breaks.
 *
 * Locally it never shows, because both apps reach the backend through their own
 * Next rewrite and are therefore same-origin.
 */
function resolveCorsOrigins(): string[] | string {
  const origins = process.env.CORS_ORIGIN?.split(',').map((value) => value.trim()).filter(Boolean) || [];

  if (process.env.NODE_ENV === 'production' && !origins.length) {
    throw new Error(
      'CORS_ORIGIN is empty. In production it must list the exact user and admin origins '
      + '(comma-separated, e.g. https://app.example.com,https://admin.example.com). '
      + 'Refusing to fall back to a wildcard, which browsers reject when credentials are sent.'
    );
  }

  return origins.length ? origins : '*';
}

async function bootstrap() {
  const bootstrapLogger = new Logger('Bootstrap');

  /*
   * Checked here, before `NestFactory.create` opens Mongo and Redis.
   *
   * Ordering is the whole point. Validating after the app exists meant the
   * throw happened with connections already established and a Nest logger
   * already redirected to Mongo — and the process did not die, it *hung*: exit
   * code 124 under a timeout, no error on stdout. A container that hangs is
   * worse than one that crashes, because the orchestrator never restarts it and
   * the health check never gets a chance to answer. Fail before there is
   * anything to hold the event loop open.
   */
  resolveCorsOrigins();

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
    bootstrapLogger.warn('INTERNAL_API_KEY is not configured; the second factor on /internal/files routes is skipped and only API_SECRET_KEY is enforced.');
  }

  if (!process.env.JWT_SECRET) {
    bootstrapLogger.warn('JWT_SECRET is not configured; upload tokens and signed file URLs cannot be issued and those requests will fail.');
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

  const corsOrigins = resolveCorsOrigins();
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

/*
 * An explicit catch, not `void bootstrap()`.
 *
 * A configuration error thrown during startup must terminate the process with a
 * non-zero code and a readable message on stderr. Left as a floating rejection
 * it can be swallowed once a logger has been redirected, and the container then
 * sits there: never ready, never restarted, never explaining why.
 */
bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`Fatal: file server failed to start. ${error?.message || error}`);
  process.exit(1);
});
