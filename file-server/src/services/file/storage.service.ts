import { Injectable } from '@nestjs/common';
import { STORAGE_TYPES } from 'src/common/constants/content';
import { AbstractStorage } from './abstract-storage';
import {
  IDeleteFileResponse,
  IDeleteFilesOptions,
  IFileUpload,
  IFileUploadResponse,
  IGetFileUrlOptions
} from 'src/common/interfaces/file';
import { DiskStorageService } from './disk-storage.service';

/**
 * Storage Service
 *
 * Unified storage abstraction layer that provides a consistent interface for file operations
 * across different storage backends (disk, S3, CDN, etc.). This service acts as a factory
 * and proxy for various storage implementations.
 *
 * Key Features:
 * - Multi-backend storage support (disk, cloud storage)
 * - Automatic storage engine selection based on configuration
 * - Consistent API across different storage types
 * - File upload, deletion, and URL generation
 * - Storage engine abstraction for easy switching
 *
 * Architecture:
 * ```
 * StorageService (this)
 *       ↓
 * AbstractStorage (interface)
 *       ↓
 * DiskStorageService | S3StorageService | CDNStorageService
 * ```
 *
 * @example File upload
 * ```typescript
 * const result = await storageService.uploadFileToStorage({
 *   fromFile: '/tmp/upload.jpg',
 *   key: 'images/user-avatar.jpg',
 *   acl: 'public-read',
 *   contentType: 'image/jpeg'
 * });
 * console.log(`File uploaded: ${result.url}`);
 * ```
 *
 * @example Bulk file deletion
 * ```typescript
 * await storageService.removeFilesFromStorage({
 *   storageType: 'diskStorage',
 *   keys: ['old-image1.jpg', 'old-image2.jpg']
 * });
 * ```
 */
@Injectable()
export class StorageService {
  constructor(
    private readonly diskStorageService: DiskStorageService
  ) { }

  /**
   * Generate public URL for a stored file
   *
   * Creates a publicly accessible URL for a file stored in the system.
   * Handles different storage backends and URL generation strategies.
   *
   * @param key - File key/path in storage
   * @param options - URL generation options
   * @returns Promise resolving to the file URL
   * @static
   * @example
   * ```typescript
   * const url = await StorageService.getFileUrl('images/avatar.jpg', {
   *   expires: 3600 // URL expires in 1 hour
   * });
   * ```
   */
  public static async getFileUrl(key: string, options?: IGetFileUrlOptions) {
    // Handle external links directly
    if (options?.storageType === STORAGE_TYPES.EXTERNAL_LINK) {
      return key;
    }

    // TODO: Make this configurable to support different storage engines
    const storage = new DiskStorageService();
    const url = await storage.getFileUrl(key, options);
    return url;
  }

  /**
   * Upload file to storage
   *
   * Uploads a file to the configured storage backend with the specified options.
   * Provides a cleaner interface than calling storage engines directly.
   *
   * @param options - Upload configuration
   * @returns Promise resolving to upload response
   * @example
   * ```typescript
   * const result = await storageService.uploadFileToStorage({
   *   file: multerFile,
   *   fileName: 'avatar.jpg',
   *   storageType: 'diskStorage'
   * });
   * ```
   */
  public async uploadFileToStorage(options: IFileUpload): Promise<IFileUploadResponse> {
    const storageEngine = this.getStorageEngine(options.storageType);
    return storageEngine.writeFile(options);
  }

  /**
   * Remove files from storage
   *
   * Removes multiple files from the specified storage backend in a single operation.
   * More efficient than deleting files individually for bulk operations.
   * Provides a clearer name that indicates the removal operation from storage.
   *
   * @param options - Deletion configuration
   * @param options.engine - Storage engine to use
   * @param options.keys - Array of file keys/paths to delete
   * @returns Promise resolving to deletion response
   * @example
   * ```typescript
   * await storageService.removeFilesFromStorage({
   *   storageType: 'diskStorage',
   *   keys: ['temp/file1.jpg', 'temp/file2.jpg', 'temp/file3.jpg']
   * });
   * ```
   */
  public async removeFilesFromStorage({
    storageType,
    keys
  }: IDeleteFilesOptions): Promise<IDeleteFileResponse> {
    const storageEngine = this.getStorageEngine(storageType);
    return storageEngine.deleteFiles(keys);
  }

  /**
   * Get appropriate storage engine based on configuration
   *
   * Factory method that returns the correct storage implementation based on
   * the specified storage type. Defaults to disk storage if no storage type specified.
   *
   * @param storageType - Storage engine type (optional)
   * @returns Storage storageType instance
   * @private
   */
  private getStorageEngine(storageType?: string): AbstractStorage {
    if (storageType === STORAGE_TYPES.DISK_STORAGE) return this.diskStorageService;

    // Default to disk storage
    // TODO: Add support for S3, CDN, and other storage types
    return this.diskStorageService;
  }
}
