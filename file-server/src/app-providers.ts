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
  FileMetadataService,
  FileProcessListenerService,
  FileProcessingService,
  FileService,
  FileValidationService,
  FileVideoService,
  ImageService,
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

  // Enhanced file services
  FileManagerService,
  FileMediaValidationService,
  FileMetadataService,
  FileProcessListenerService,
  FileProcessingService,
  FileValidationService,

  // TUS services
  TusServerService,
  TusAuthService
]
