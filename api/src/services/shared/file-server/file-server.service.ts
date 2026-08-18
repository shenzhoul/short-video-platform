import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger
} from "@nestjs/common";
import {
  FileInfo,
  GenerateUploadUrlOptions,
  UploadMethod,
  UploadUrlResponse,
} from './interfaces/file-server.interface';
import { ConfigService } from "@nestjs/config";
import { __t } from 'src/utils/translation';
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { ObjectId } from 'mongodb';
import { FileServerInfoDto } from "src/dtos/shared/file-server/file-server.dto";

/**
 * Douyin Clone File Server Integration Service
 *
 * This service provides a comprehensive interface for integrating with the Douyin Clone File Server.
 * It handles file uploads, processing, metadata extraction, and file management operations
 * through the file server's internal API.
 *
 * Features:
 * - Secure file upload URL generation
 * - File processing with customizable options
 * - Metadata extraction and management
 * - File deletion and bulk operations
 * - Webhook integration for processing notifications
 * - Automatic retry mechanism for failed requests
 * - Comprehensive error handling and logging
 *
 * @example
 * ```typescript
 * // Generate upload URL for an image
 * const uploadData = await fileServerService.generateUploadUrl({
 *   mediaType: 'image',
 *   filename: 'profile-photo.jpg',
 *   processingOptions: {
 *     generateThumbnail: true,
 *     quality: 90
 *   }
 * });
 *
 * // Get file information
 * const fileInfo = await fileServerService.getFileInfo('file-id-123');
 * ```
 *
 * @author ShenZhoul
 * @version 1.0.0
 * @since 2026-06-04
 */
@Injectable()
export class FileServerService {
  private readonly logger = new Logger(FileServerService.name);

  private readonly baseUrl: string;

  private readonly apiKey: string;

  private readonly internalApiKey: string;

  private readonly defaultUploadMethod: UploadMethod;

  private readonly tusConfig: any;

  private readonly axiosInstance: AxiosInstance;

  private readonly maxRetries: number;

  private readonly retryDelay: number;

  private readonly timeout: number;

  constructor(private readonly configService: ConfigService) {
    const fileServerConfig = this.configService.get('fileServer');
    this.baseUrl = fileServerConfig.baseUrl;
    this.apiKey = fileServerConfig.auth.apiKey;
    this.internalApiKey = fileServerConfig.auth.internalApiKey;
    this.defaultUploadMethod = fileServerConfig.upload.method;
    this.tusConfig = fileServerConfig.tus;
    this.timeout = fileServerConfig.http.timeout;
    this.maxRetries = fileServerConfig.http.maxRetries;
    this.retryDelay = fileServerConfig.http.retryDelay;

    if (!this.apiKey) {
      this.logger.warn('FILE_SERVER_API_KEY is not configured; file server internal requests will fail with 401.');
    }

    if (!this.internalApiKey) {
      this.logger.warn('INTERNAL_API_KEY is not configured; internal-only file server routes may fail with 403.');
    }

    const defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      defaultHeaders['X-API-Key'] = this.apiKey;
    }

    if (this.internalApiKey) {
      defaultHeaders['X-Internal-API-Key'] = this.internalApiKey;
    }

    // Create axios instance with default configuration
    this.axiosInstance = axios.create({
      baseURL: `${this.baseUrl}/internal/files`,
      timeout: this.timeout,
      headers: defaultHeaders
    });
  }

  /**
   * Delay execution for specified milliseconds
   *
   * @private
   * @param ms - Milliseconds to delay
   * @returns Promise that resolves after delay
   */
  private delay(ms: number): Promise<void> {
    // eslint-disable-next-line no-promise-executor-return
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Generate a secure upload URL for file uploads
   *
   * Creates a signed upload URL with processing options and returns upload credentials.
   * The generated URL is time-limited and includes a JWT token for secure uploads.
   *
   * @param options - Upload configuration options
   * @param options.mediaType - Type of media (image, video, document)
   * @param options.filename - Original filename
   * @param options.type - File type category (avatar, post, product, etc.)
   * @param options.acl - Access control level (public-read, private, authenticated-read)
   * @param options.contentType - MIME type of the file
   * @param options.processingOptions - File processing configuration
   * @param options.processingOptions.immediateProcess - Whether to process immediately (images only) or queue for background processing
   * @param options.metadata - Additional metadata to store with the file
   *
   * @returns Promise resolving to upload URL data including token and upload endpoint
   *
   * @throws {HttpException} When upload URL generation fails
   *
   * @example Image with immediate processing
   * ```typescript
   * const uploadData = await fileServerService.generateUploadUrl({
   *   mediaType: 'image',
   *   filename: 'avatar.jpg',
   *   type: 'avatar',
   *   acl: 'public-read',
   *   processingOptions: {
   *     generateThumbnail: true,
   *     immediateProcess: true, // Process immediately for images
   *     quality: 85,
   *     resizeWidth: 300,
   *     resizeHeight: 300
   *   },
   *   metadata: {
   *     userId: 'user-123',
   *     description: 'User profile avatar'
   *   }
   * });
   * ```
   *
   * @example Video with background processing
   * ```typescript
   * const uploadData = await fileServerService.generateUploadUrl({
   *   mediaType: 'video',
   *   filename: 'content.mp4',
   *   type: 'content',
   *   acl: 'private',
   *   processingOptions: {
   *     generateThumbnail: true,
   *     immediateProcess: false, // Videos are always queued regardless
   *     videoFormat: 'mp4'
   *   }
   * });
   * ```
   */
  async generateUploadUrl(options: GenerateUploadUrlOptions): Promise<UploadUrlResponse> {
    const uploadType = options.uploadType || this.defaultUploadMethod;
    try {
      // Validate TUS upload requirements
      if (uploadType === 'tus' && !options.fileSize) {
        throw new Error(__t('errors.file_size_required_for_tus_uploads'));
      }

      // TODO - option from params
      // const webhookUrl = this.buildWebhookUrl('fileProcessed');
      const requestData = {
        ...options,
        uploadType,
        processingOptions: {
          ...this.getDefaultProcessingOptions(options.mediaType),
          ...options.processingOptions
          // webhookUrl
        },
        tusConfig: uploadType === 'tus' ? {
          chunkSize: this.tusConfig.chunkSize,
          maxFileSize: this.tusConfig.maxFileSize,
          version: this.tusConfig.version,
          extensions: this.tusConfig.extensions
        } : undefined
      };
      const endpoint = uploadType === 'tus' ? '/tus-upload-url' : '/direct-upload-link';
      const response = await this.makeRequest<UploadUrlResponse>('POST', endpoint, requestData);
      return response.data.data;
    } catch (error) {
      throw new HttpException(
        __t('errors.failed_to_generate_upload_url', { reason: error.message }),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  public async findByIds(fileIds: Array<string | ObjectId>): Promise<FileServerInfoDto[]> {
    const res = await this.getMultipleFileInfo(fileIds, false) as FileServerInfoDto[];
    return res;
  }

  /**
   * Generate upload URL specifically for images with optimized defaults
   *
   * @param options - Image upload options
   * @returns Promise resolving to upload URL data
   */
  async generateImageUploadUrl(options: Omit<GenerateUploadUrlOptions, 'mediaType'>): Promise<UploadUrlResponse> {
    return this.generateUploadUrl({ ...options, mediaType: 'image' });
  }

  /**
  * Generate upload URL specifically for videos with optimized defaults
  *
  * @param options - Video upload options
  * @returns Promise resolving to upload URL data
  */
  async generateVideoUploadUrl(options: Omit<GenerateUploadUrlOptions, 'mediaType'>): Promise<UploadUrlResponse> {
    return this.generateUploadUrl({ ...options, mediaType: 'video' });
  }

  /**
   * Get detailed information about multiple files
   *
   * Retrieves comprehensive file metadata for multiple files in a single request.
   * More efficient than making individual getFileInfo calls for bulk operations.
   *
   * @param fileIds - Array of unique file identifiers
   * @param returnAsObject - If true, returns object with fileId as key; if false, returns array
   * @returns Promise resolving to file information DTOs (array or object format)
   *
   * @throws {HttpException} When request fails
   *
   * @example Array format
   * ```typescript
   * const fileInfos = await fileServerService.getMultipleFileInfo(['id1', 'id2', 'id3']);
   * console.log(`Retrieved info for ${fileInfos.length} files`);
   * fileInfos.forEach(info => console.log(`File: ${info.name}, Size: ${info.size}`));
   * ```
   *
   * @example Object format
   * ```typescript
   * const fileInfoMap = await fileServerService.getMultipleFileInfo(['id1', 'id2'], true);
   * console.log(`File 1 name: ${fileInfoMap['id1']?.name}`);
   * console.log(`File 2 size: ${fileInfoMap['id2']?.size}`);
   * ```
   */
  async getMultipleFileInfo(
    fileIds: Array<string | ObjectId>,
    returnAsObject: boolean = false
  ): Promise<FileServerInfoDto[] | Record<string, FileServerInfoDto>> {
    if (!fileIds || fileIds.length === 0) {
      return returnAsObject ? {} : [];
    }

    try {
      const requestData = { fileIds, returnAsObject };
      const response = await this.makeRequest<FileInfo[] | Record<string, FileInfo>>(
        'POST',
        '/find-by-ids',
        requestData
      );

      // Transform raw FileInfo to FileServerInfoDto
      const rawData = response.data.data;

      if (returnAsObject) {
        const rawObject = rawData as Record<string, FileInfo>;
        const transformedObject: Record<string, FileServerInfoDto> = {};

        Object.keys(rawObject).forEach((key) => {
          const fileInfo = rawObject[key];
          if (fileInfo) {
            transformedObject[key] = FileServerInfoDto.fromFileInfo(fileInfo);
          }
        });

        return transformedObject;
      }
      const rawArray = rawData as FileInfo[];
      return FileServerInfoDto.fromFileInfoArray(rawArray);
    } catch (error) {
      if (error.response?.status === 404) {
        throw new HttpException(__t('errors.some_files_not_found'), HttpStatus.NOT_FOUND);
      }

      throw new HttpException(
        __t('errors.file_server_request_failed', { reason: error.message }),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get detailed information about a specific file
   *
   * Retrieves comprehensive file metadata including processing status,
   * thumbnails, dimensions, and other file properties.
   *
   * @param fileId - Unique identifier of the file
   * @returns Promise resolving to file information
   *
   * @throws {HttpException} When file is not found or request fails
   *
   * @example
   * ```typescript
   * const fileInfo = await fileServerService.getFileInfo('507f1f77bcf86cd799439011');
   * console.log(`File size: ${fileInfo.size} bytes`);
   * console.log(`Processing status: ${fileInfo.status}`);
   * ```
   */
  async getFileInfo(fileId: string | ObjectId): Promise<FileServerInfoDto> {
    try {
      const response = await this.makeRequest<FileInfo>('GET', `/${fileId}`);

      return FileServerInfoDto.fromFileInfo(response.data.data);
    } catch (error) {
      if (error.response?.status === 404) {
        throw new HttpException(__t('identity.file.not_found'), HttpStatus.NOT_FOUND);
      }

      throw new HttpException(
        __t('errors.file_server_request_failed', { reason: error.message }),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Delete multiple files by IDs in batch
   *
   * @param fileIds - Array of file IDs to delete
   * @returns Promise resolving to deletion results
   *
   * @example
   * ```typescript
   * const result = await fileServerService.deleteManyByIds(['file-id-1', 'file-id-2']);
   * console.log(`Deleted: ${result.deleted}, Errors: ${result.errors.length}`);
   * ```
   */
  async deleteManyByIds(fileIds: Array<string | ObjectId>): Promise<{ deleted: number; errors: any[] }> {
    if (!fileIds || fileIds.length === 0) {
      return { deleted: 0, errors: [] };
    }

    try {
      const response = await this.makeRequest<{ deleted: number; errors: any[] }>('POST', '/batch-delete', { fileIds });
      return response.data.data;
    } catch (error) {
      const reason = error.response?.data?.error
        || error.response?.data?.message
        || error.message
        || 'Unknown file-server error';
      this.logger.error(`Batch file deletion failed: ${reason}`, error.stack);

      throw new HttpException(
        __t('errors.file_server_request_failed', { reason }),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Add reference to a file
   *
   * @param fileId - File ID
   * @param ref - Reference information
   * @returns Promise resolving when reference is added
   *
   * @example
   * ```typescript
   * await fileServerService.addRef('file-id-123', {
   *   itemId: 'post-id-456',
   *   itemType: 'post'
   * });
   * ```
   */
  async addRef(fileId: string | ObjectId, ref: { itemId: string | ObjectId; itemType: string }): Promise<void> {
    try {
      await this.makeRequest('POST', `/${fileId}/add-ref`, ref);
    } catch (error) {
      throw new HttpException(
        `Failed to add reference to file: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Add references to multiple files in batch
   *
   * @param fileRefs - Array of file references
   * @returns Promise resolving when all references are added
   *
   * @example
   * ```typescript
   * await fileServerService.addRefBatch([
   *   { fileId: 'file-id-1', ref: { itemId: 'post-id-456', itemType: 'post' } },
   *   { fileId: 'file-id-2', ref: { itemId: 'post-id-456', itemType: 'post' } }
   * ]);
   * ```
   */
  async addRefBatch(fileRefs: Array<{
    fileId: string | ObjectId;
    ref: { itemId: string | ObjectId; itemType: string };
  }>): Promise<void> {
    if (!fileRefs || fileRefs.length === 0) {
      return;
    }

    try {
      await this.makeRequest('POST', '/batch-add-ref', { fileRefs });
    } catch (error) {
      throw new HttpException(
        `Failed to add references in batch: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Add same reference to multiple files
   *
   * @param fileIds - Array of file IDs
   * @param ref - Reference information to add to all files
   * @returns Promise resolving when reference is added to all files
   *
   * @example
   * ```typescript
   * await fileServerService.addRefToMultipleFiles(
   *   ['file-id-1', 'file-id-2', 'file-id-3'],
   *   { itemId: 'post-id-456', itemType: 'post' }
   * );
   * ```
   */
  async addRefToMultipleFiles(
    fileIds: Array<string | ObjectId>,
    ref: { itemId: string | ObjectId; itemType: string }
  ): Promise<void> {
    if (!fileIds || fileIds.length === 0) {
      return;
    }

    try {
      await this.makeRequest('POST', '/add-ref-to-multiple-files', { fileIds, ref });
    } catch (error) {
      throw new HttpException(
        `Failed to add reference to multiple files: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Remove unused files by types
   *
   * @param types - Array of file types to clean up
   * @param timeInHours - Age threshold in hours (default: 4)
   * @returns Promise resolving when cleanup is complete
   *
   * @example
   * ```typescript
   * // Clean up unused images and videos older than 24 hours
   * await fileServerService.removeUnusedFilesByTypes(['image', 'video'], 24);
   * ```
   */
  async removeUnusedFilesByTypes(types: string[], timeInHours: number = 4): Promise<{ deleted: number; errors: any[] }> {
    try {
      const response = await this.makeRequest<{ deleted: number; errors: any[] }>(
        'POST',
        '/remove-unused-files',
        { types, timeInHours }
      );
      return response.data.data;
    } catch (error) {
      throw new HttpException(
        `Failed to remove unused files: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get default processing options based on media type
   *
   * @private
   * @param mediaType - Type of media (image, video, document)
   * @returns Default processing options for the media type
   */
  private getDefaultProcessingOptions(mediaType: string): any {
    const { defaults } = this.configService.get('fileServer');

    switch (mediaType) {
      case 'image':
        return defaults.image;
      case 'video':
        return defaults.video;
      default:
        return {};
    }
  }

  /**
   * Update file ownership (createdBy and updatedBy) for single or multiple files
   *
   * This method allows updating the ownership of files, which is useful for scenarios like:
   * - Updating placeholder ownership after user registration
   * - Transferring file ownership between users
   * - Bulk ownership updates for administrative purposes
   *
   * @param payload - File ownership update request
   * @returns Promise resolving to update result with success/failure details
   * @example
   * ```typescript
   * // Update single file ownership
   * const result = await fileServerService.updateFileOwnership({
   *   fileId: '507f1f77bcf86cd799439011',
   *   createdBy: 'user123',
   *   updatedBy: 'admin',
   *   currentCreatedBy: 'new-register-creator'
   * });
   *
   * // Update multiple files ownership with reference
   * const result = await fileServerService.updateFileOwnership({
   *   fileIds: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'],
   *   createdBy: 'user123',
   *   updatedBy: 'admin',
   *   ref: {
   *     itemId: 'post-id-456',
   *     itemType: 'post'
   *   }
   * });
   * ```
   */
  async updateFileOwnership(payload: {
    fileId?: string | ObjectId;
    fileIds?: string[] | ObjectId[];
    createdBy?: string | ObjectId;
    updatedBy?: string | ObjectId;
    currentCreatedBy?: string;
    ref?: {
      itemId: string | ObjectId;
      itemType: string;
    };
  }): Promise<{
    updated: number;
    updatedFileIds: string[];
    errors: Array<{ fileId: string; error: string }>;
    message: string;
  }> {
    try {
      const response = await this.makeRequest<{
        updated: number;
        updatedFileIds: string[];
        errors: Array<{ fileId: string; error: string }>;
        message: string;
      }>('POST', 'update-ownership', payload);

      return response.data.data;
    } catch (error) {
      throw new Error(`Failed to update file ownership: ${error.message}`);
    }
  }

  /**
   * Make HTTP request to file server with retry logic
   *
   * @private
   * @param method - HTTP method
   * @param endpoint - API endpoint
   * @param data - Request data
   * @returns Promise resolving to API response
   */
  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
    endpoint: string,
    data?: any
  ): Promise<AxiosResponse<{ success: boolean; data: T; error?: string; message?: string }>> {
    const makeRequestAttempt = async (attempt: number): Promise<AxiosResponse<{ success: boolean; data: T; error?: string; message?: string }>> => {
      try {
        let response: AxiosResponse;

        switch (method) {
          case 'GET':
            response = await this.axiosInstance.get(endpoint);
            break;
          case 'POST':
            response = await this.axiosInstance.post(endpoint, data);
            break;
          case 'PATCH':
            response = await this.axiosInstance.patch(endpoint, data);
            break;
          case 'DELETE':
            response = await this.axiosInstance.delete(endpoint);
            break;
          default:
            throw new Error(`Unsupported method: ${method}`);
        }

        if (!response.data.success) {
          throw new Error(response.data.error || response.data.message || 'Request failed');
        }

        return response;
      } catch (error) {
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelay * attempt);
          return makeRequestAttempt(attempt + 1);
        }

        const fullUrl = `${this.baseUrl}/internal/files${endpoint}`;
        this.logger.error(`File server request failed: ${fullUrl}`, error);
        throw error;
      }
    };

    return makeRequestAttempt(1);
  }
}
