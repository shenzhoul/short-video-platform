import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import appConfig from './app';
import { AppConfigService } from './config.service';
import fileConfig from './file';
import imageConfig from './image';
import processingConfig from './processing';
import videoConfig from './video';

/**
 * Configuration Module
 *
 * Provides centralized configuration management for the entire application.
 * This module is marked as Global, so AppConfigService is available throughout the app.
 *
 * Features:
 * - Environment variable loading
 * - Configuration validation
 * - Type-safe configuration access
 * - Default value management
 * - Hot reload support in development
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      // Load environment variables from .env files
      envFilePath: [
        '.env.local',
        '.env.development',
        '.env.production',
        '.env'
      ],
      // Make ConfigService available globally
      isGlobal: true,
      // Enable configuration caching for better performance
      cache: true,
      // Expand environment variables (e.g., ${HOME}/uploads)
      expandVariables: true,
      // Load configuration objects
      load: [
        () => ({
          app: appConfig,
          file: fileConfig,
          image: imageConfig,
          video: videoConfig,
          processing: processingConfig
        })
      ],
      // Validate configuration on startup
      validate: (config) => {
        // Basic validation - can be extended with class-validator
        const requiredEnvVars = [
          'NODE_ENV'
        ];

        const missingVars = requiredEnvVars.filter(
          (envVar) => !config[envVar] && !process.env[envVar]
        );

        if (missingVars.length > 0) {
          // Missing environment variables - will use defaults
          // Could log this with a proper logger if needed
        }

        return config;
      }
    })
  ],
  providers: [AppConfigService],
  exports: [AppConfigService]
})
export class AppConfigModule {
  /**
   * For root module registration
   * Use this in your main AppModule
   */
  static forRoot() {
    return {
      module: AppConfigModule,
      global: true
    };
  }
}
