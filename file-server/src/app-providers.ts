import {
  TusAuthService,
  TusServerService
} from 'src/services/tus';
import { AppConfigService } from 'src/config';
import { DBLoggerService } from 'src/common/lib/logger';
import {
  AppService,
  DiskStorageService,
  FileManagerService,
  FileMediaValidationService,
  ImageContentValidationService,
  VideoContentValidationService,
  FileMetadataService,
  FileProcessListenerService,
  FileProcessingService,
  FileService,
  FileValidationService,
  FileVideoService,
  ImageService,
  S3StorageService,
  StorageService
} from './services';

export const appProviders = [
  // Core services
  AppService,
  AppConfigService,
  DBLoggerService,

  // File services
  FileService,
  StorageService,
  ImageService,
  FileVideoService,
  DiskStorageService,
  // Bucket-backed engine. Registered unconditionally even on a disk deploy:
  // `StorageService` injects it, and its client is only built on first use, so
  // an unconfigured R2 costs nothing until something actually asks for it.
  S3StorageService,

  // Enhanced file services
  FileManagerService,
  FileMediaValidationService,
  ImageContentValidationService,
  VideoContentValidationService,
  FileMetadataService,
  FileProcessListenerService,
  FileProcessingService,
  FileValidationService,

  // TUS services
  TusServerService,
  TusAuthService
]
