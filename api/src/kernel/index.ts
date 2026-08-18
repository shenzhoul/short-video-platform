/* eslint-disable import/no-dynamic-require */
import { join } from 'path';

/**
 * Kernel Module - Core Application Infrastructure
 *
 * This module provides the foundational components and utilities used throughout the application.
 * It includes infrastructure services, common utilities, exception handling, data models, and helpers.
 *
 * Exports:
 * - infras: Infrastructure services (queues, databases, external integrations)
 * - exceptions: Custom exception classes for error handling
 * - common: Common utilities and base classes (pagination, search, etc.)
 * - models: Data transfer objects and response models
 * - helpers: Utility functions and helper methods
 */

export * from './exceptions';
export * from './models';
export * from './helpers';
export * from './infras';

/**
 * Dynamic configuration loader utility
 * Loads configuration files from the config directory at runtime
 * @param configName - Name of the configuration file to load (without extension)
 * @returns Configuration object from the specified config file
 * TODO: Consider replacing with static imports for better tree-shaking and type safety
 */
export function getConfig(configName = 'app') {
  // eslint-disable-next-line global-require
  return require(join(__dirname, '..', 'config', configName)).default;
}
