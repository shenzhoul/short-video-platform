import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

import appConfig from './app';
import fileConfig from './file';
import imageConfig from './image';
import processingConfig from './processing';
import videoConfig from './video';

/**
 * Enhanced Configuration Service
 *
 * Provides type-safe access to application configuration using NestJS ConfigService.
 * Replaces the legacy getConfig function with proper dependency injection and type safety.
 *
 * Features:
 * - Type-safe configuration access
 * - Proper NestJS dependency injection
 * - Centralized configuration management
 * - Environment variable support
 * - Default value handling
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: NestConfigService) { }

  /**
   * Get application configuration
   */
  get app() {
    return {
      ...appConfig,
      // Override with environment variables if available
      port: this.configService.get<number>('PORT', appConfig.port),
      host: this.configService.get<string>('HOST', appConfig.host),
      apiPrefix: this.configService.get<string>('API_PREFIX', appConfig.apiPrefix),
      environment: this.configService.get<string>('NODE_ENV', appConfig.environment)
    };
  }

  /**
   * Get file configuration
   */
  get file() {
    return {
      ...fileConfig,
      // Override with environment variables if available
      publicDir: this.configService.get<string>('FILE_PUBLIC_DIR', fileConfig.publicDir),
      tempDir: this.configService.get<string>('FILE_TEMP_DIR', fileConfig.tempDir),
      maxFileSize: this.configService.get<number>('FILE_MAX_SIZE', fileConfig.maxFileSize),
      // File size limits
      limits: {
        image: this.configService.get<number>('FILE_MAX_SIZE_IMAGE', fileConfig.limits.image),
        video: this.configService.get<number>('FILE_MAX_SIZE_VIDEO', fileConfig.limits.video),
        document: this.configService.get<number>('FILE_MAX_SIZE_DOCUMENT', fileConfig.limits.document),
        audio: this.configService.get<number>('FILE_MAX_SIZE_AUDIO', fileConfig.limits.audio),
        default: this.configService.get<number>('FILE_MAX_SIZE_DEFAULT', fileConfig.limits.default)
      },
      // TUS configuration
      tus: {
        uploadDir: this.configService.get<string>('TUS_UPLOAD_DIR', fileConfig.tus.uploadDir),
        chunkSize: this.configService.get<number>('TUS_CHUNK_SIZE', fileConfig.tus.chunkSize),
        maxFileSize: this.configService.get<number>('TUS_MAX_FILE_SIZE', fileConfig.tus.maxFileSize)
      }
    };
  }

  /**
   * Get image processing configuration
   */
  get image() {
    return {
      ...imageConfig,
      // Override with environment variables if available
      thumbnails: {
        ...imageConfig.thumbnails,
        enabled: this.configService.get<boolean>('IMAGE_THUMBNAILS_ENABLED', imageConfig.thumbnails.enabled),
        quality: this.configService.get<number>('IMAGE_THUMBNAILS_QUALITY', imageConfig.thumbnails.quality)
      },
      blur: {
        ...imageConfig.blur,
        enabled: this.configService.get<boolean>('IMAGE_BLUR_ENABLED', imageConfig.blur.enabled),
        intensity: this.configService.get<number>('IMAGE_BLUR_INTENSITY', imageConfig.blur.intensity)
      }
    };
  }

  /**
   * Get video processing configuration
   */
  get video() {
    return {
      ...videoConfig,
      // Override with environment variables if available
      maxResolution: {
        ...videoConfig.maxResolution,
        width: this.configService.get<number>('VIDEO_MAX_WIDTH', videoConfig.maxResolution.width),
        height: this.configService.get<number>('VIDEO_MAX_HEIGHT', videoConfig.maxResolution.height)
      },
      thumbnails: {
        ...videoConfig.thumbnails,
        count: this.configService.get<number>('VIDEO_THUMBNAIL_COUNT', videoConfig.thumbnails.count),
        enabled: this.configService.get<boolean>('VIDEO_THUMBNAILS_ENABLED', videoConfig.thumbnails.enabled)
      }
    };
  }

  /**
   * Get processing configuration
   */
  get processing() {
    return {
      ...processingConfig,
      // Override with environment variables if available
      queue: {
        ...processingConfig.queue,
        enabled: this.configService.get<boolean>('PROCESSING_QUEUE_ENABLED', processingConfig.queue.enabled),
        concurrency: this.configService.get<number>('PROCESSING_CONCURRENCY', processingConfig.queue.concurrency),
        jobTimeout: this.configService.get<number>('PROCESSING_JOB_TIMEOUT', processingConfig.queue.jobTimeout)
      },
      hashing: {
        ...processingConfig.hashing,
        enabled: this.configService.get<boolean>('PROCESSING_HASHING_ENABLED', processingConfig.hashing.enabled)
      }
    };
  }

  /**
   * Get database configuration
   */
  get database() {
    return {
      mongodb: {
        uri: this.configService.get<string>('MONGODB_URI', 'mongodb://localhost:27017/douyin-clone-file-server'),
        options: {
          useNewUrlParser: true,
          useUnifiedTopology: true
        }
      }
    };
  }

  /**
   * Get authentication configuration
   */
  get auth() {
    return {
      jwtSecret: this.configService.get<string>('JWT_SECRET', 'your-jwt-secret-key'),
      apiSecretKey: this.configService.get<string>('API_SECRET_KEY', 'your-api-secret-key'),
      tokenExpiration: this.configService.get<string>('JWT_EXPIRATION', '24h')
    };
  }

  /**
   * Get storage configuration
   */
  get storage() {
    return {
      type: this.configService.get<string>('STORAGE_TYPE', 'disk'),
      disk: {
        publicDir: this.file.publicDir,
        tempDir: this.file.tempDir
      },
      s3: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
        region: this.configService.get<string>('AWS_REGION', 'us-east-1'),
        bucket: this.configService.get<string>('AWS_S3_BUCKET')
      }
    };
  }

  /**
   * Check if the application is in development mode
   */
  get isDevelopment(): boolean {
    return this.app.environment === 'development';
  }

  /**
   * Check if the application is in production mode
   */
  get isProduction(): boolean {
    return this.app.environment === 'production';
  }

  /**
   * Check if the application is in test mode
   */
  get isTest(): boolean {
    return this.app.environment === 'test';
  }

  /**
   * Generic configuration getter with type safety
   * @param key - Configuration key
   * @param defaultValue - Default value if key not found
   */
  get<T = any>(key: string, defaultValue?: T): T {
    return this.configService.get<T>(key, defaultValue);
  }

  /**
   * Get configuration by section name (backward compatibility)
   * @param section - Configuration section name
   * @deprecated Use specific getters instead (e.g., configService.image, configService.video)
   */
  getConfig(section: string): any {
    switch (section) {
      case 'app':
        return this.app;
      case 'file':
        return this.file;
      case 'image':
        return this.image;
      case 'video':
        return this.video;
      case 'processing':
        return this.processing;
      case 'database':
        return this.database;
      case 'auth':
        return this.auth;
      case 'storage':
        return this.storage;
      default:
        // Unknown configuration section - return empty object
        return {};
    }
  }
}
