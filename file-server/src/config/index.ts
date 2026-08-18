import app from './app';
import file from './file';
import image from './image';
import processing from './processing';
import queue from './queue';
import security from './security';
import video from './video';

/**
 * Main configuration aggregator that combines all application configuration modules
 * Exports a function that returns the complete configuration object for NestJS ConfigModule
 * @returns Configuration object containing all app settings
 */
export default () => ({
  app,
  file,
  image,
  processing,
  queue,
  security,
  video
});

// Enhanced NestJS Configuration Service
export { AppConfigModule } from './config.module';
export { AppConfigService } from './config.service';

// Individual config exports for backward compatibility
export { default as appConfig } from './app';
export { default as fileConfig } from './file';
export { default as imageConfig } from './image';
export { default as processingConfig } from './processing';
export { default as queueConfig } from './queue';
export { default as securityConfig } from './security';
export { default as videoConfig } from './video';
