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
import { S3StorageService } from './s3-storage.service';
import { storageConfig, STORAGE_DRIVERS } from 'src/config';

/**
 * Engines for the *static* URL path, which cannot go through DI.
 *
 * `FileDto.getUrl()` and its siblings are plain class instances produced by
 * `plainToInstance` — Nest never constructs them, so they cannot be injected
 * into. They call `StorageService.getFileUrl` statically, and before this that
 * method hardcoded `new DiskStorageService()`. With a bucket configured, every
 * media URL in every API response would still have been built as a local path.
 *
 * These are module singletons rather than a `new` per call because the S3
 * client holds a connection pool, and a DTO can be mapped thousands of times in
 * one feed response.
 */
const readEngines = {
  disk: new DiskStorageService(),
  s3: null as S3StorageService | null
};

function getS3ReadEngine(): S3StorageService {
  if (!readEngines.s3) readEngines.s3 = new S3StorageService();
  return readEngines.s3;
}

/**
 * Pick the engine for reading a file back.
 *
 * Dispatch is on the **file's own stored `storageType`**, not on the configured
 * driver, and that distinction is the whole point. Turning `STORAGE_DRIVER=r2`
 * on decides where new uploads go; it must not change how the media already on
 * disk is addressed. Reading the configured driver here instead would rewrite
 * every existing local file's URL to a bucket path on the next deploy and break
 * all of it at once, with nothing logged.
 *
 * A record with no `storageType` predates the field, which means it was written
 * before there was any engine but disk — so an unknown type resolves to disk,
 * never to the configured driver.
 */
function resolveStorageEngineForRead(storageType?: string): AbstractStorage {
  if (storageType === STORAGE_TYPES.S3) return getS3ReadEngine();
  return readEngines.disk;
}

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
    private readonly diskStorageService: DiskStorageService,
    private readonly s3StorageService: S3StorageService
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

    const storage = resolveStorageEngineForRead(options?.storageType);
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
    /*
     * An explicit type always wins, and that is what makes deletion correct: a
     * delete carries the *file's own* recorded `storageType`, so media written
     * to disk before a cutover is still removed from disk after it, rather than
     * being looked for in a bucket it was never in and reported as already
     * gone. Removing a record while its bytes survive is the one failure the
     * sweeper can never repair, because the row that named them is what it
     * would have needed.
     */
    if (storageType === STORAGE_TYPES.S3) return this.s3StorageService;
    if (storageType === STORAGE_TYPES.DISK_STORAGE) return this.diskStorageService;

    // No type given — this is a fresh write, so it goes wherever the deployment
    // is configured to put new uploads.
    return storageConfig.driver === STORAGE_DRIVERS.R2
      ? this.s3StorageService
      : this.diskStorageService;
  }
}
