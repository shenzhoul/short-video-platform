import app from './app';
import fileServer from './file-server';
import redis from './redis';
import queue from './queue';
import throttler from './throttler';

/**
 * Main configuration aggregator that combines all application configuration modules
 * Exports a function that returns the complete configuration object for NestJS ConfigModule
 * @returns Configuration object containing all app settings
 */
export default () => ({
  app,
  fileServer,
  redis,
  throttler,
  queue
});
