import { HttpException, Injectable, Logger } from "@nestjs/common";
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IFileProcessingOptions,
  ISignedUploadRequest,
  ISignedUploadResponse
} from "src/common/interfaces/upload.interface";
import { AppConfigService } from "src/config";
import { File, FileDocument } from "src/schemas";
import { ObjectId } from 'mongodb';
import {
  generateUniqueFileName,
  generateUploadToken,
  getBaseDirectory,
  getMimeTypeFromExtension
} from "src/lib/file-utils";
import { join, parse } from "path";
import {
  FILE_STATUS,
  PROCESSING_STATUS,
  S3_ACCESS_CONTROL,
  S3AccessControl
} from "src/common/constants/content";
import { EntityNotFoundException } from "src/kernel/exceptions";
import { FileDto } from "src/dtos/file.dto";
import * as path from 'path';
import * as fs from 'fs';
import { FileMediaValidationService } from "src/services/file/file-media-validation.service";
import { IMulterUploadedFile } from "src/common/lib/file/multer/multer.utils";
import { isImage, isVideo } from "src/lib/file-type";
import { IFileUploadOptions } from "src/common/lib/file";
import { FileManagerService } from "src/services/file/file-manager.service";
import { fromPosixPath, isUrl } from "src/kernel/helpers/string.helper";
import { StorageService } from "src/services/file/storage.service";

/**
 * File Service
 *
 * Core service for file management operations including upload, processing, storage, and retrieval.
 * Handles various file types (images, videos, documents) with support for thumbnails, format conversion,
 * and cloud storage integration.
 *
 * Key Features:
 * - File upload and storage management
 * - Image processing (thumbnails, format conversion, EXIF removal)
 * - Video processing (MP4 conversion, thumbnail extraction)
 * - Queue-based background processing
 * - Multi-storage backend support (disk, S3, etc.)
 * - File ownership and permission validation
 * - Automatic cleanup and garbage collection
 *
 */
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    @InjectModel(File.name) private readonly FileModel: Model<FileDocument>,
    private readonly configService: AppConfigService,
    private readonly fileMediaValidationService: FileMediaValidationService,
    private readonly fileManagerService: FileManagerService,
    private readonly storageService: StorageService
  ) { }

  /**
   * Find a file by its unique identifier
   *
   * @param id - File ID (string or ObjectId)
   * @returns Promise resolving to FileDto or null if not found
   * @example
   * ```typescript
   * const file = await fileService.findById('507f1f77bcf86cd799439011');
   * if (file) {
   *   console.log(`File: ${file.name}, Size: ${file.size} bytes`);
   * }
   * ```
   */
  public async findById(id: string | ObjectId): Promise<FileDto> {
    const model = await this.FileModel.findById(id);
    if (!model) return null;
    return FileDto.fromModel(model);
  }

  /**
   * Find multiple files by their IDs
   *
   * Efficiently retrieves multiple files in a single database query.
   * Returns files in the same order as the input IDs when possible.
   *
   * @param ids - Array of file IDs (string or ObjectId format)
   * @returns Promise resolving to array of FileDto objects
   * @example
   * ```typescript
   * const files = await fileService.findFilesByIds([id1, id2, id3]);
   * console.log(`Found ${files.length} files`);
   * ```
   */
  public async findFilesByIds(ids: string[] | ObjectId[] | ObjectId[]): Promise<FileDto[]> {
    if (!ids.length) return [];
    const items = await this.FileModel.find({
      _id: {
        $in: ids
      }
    }).lean();

    return items.map((i) => FileDto.fromModel(i));
  }

  // ===== INTERNAL API METHODS =====

  /**
   * Generate signed upload URL for internal API
   *
   * Creates a secure upload URL that clients can use to upload files directly.
   * Pre-creates a file record in the database with pending status.
   *
   * @param request - Upload request parameters
   * @returns Promise resolving to signed upload response
   * @example
   * ```typescript
   * const uploadUrl = await fileService.generateSignedUploadUrl({
   *   mediaType: 'image',
   *   type: 'profile-avatar',
   *   filename: 'avatar.jpg',
   *   acl: 'public-read',
   *   processingOptions: { generateThumbnail: true }
   * });
   * ```
   */
  public async generateSignedUploadUrl(request: ISignedUploadRequest): Promise<ISignedUploadResponse> {
    // Check if normal upload is supported in config
    const supportedMethods = this.configService.app.supportedUploadMethods;
    if (!supportedMethods.includes('normal')) {
      throw new Error(`Normal upload method is not supported. Supported methods: ${supportedMethods.join(', ')}`);
    }

    const fileId = new ObjectId();
    const {
      mediaType, type, filename, acl, contentType, processingOptions, metadata, createdBy, updatedBy
    } = request;

    // Generate file path based on type and media type
    const baseDir = getBaseDirectory(type);
    const fileName = generateUniqueFileName(filename);
    const fileKey = `${baseDir}/${fileName}`;

    // Create pending file record
    const fileData = {
      _id: fileId,
      type,
      mediaType, // Store the user's explicit mediaType choice
      name: parse(filename).name,
      originalName: filename,
      fileExtension: parse(filename).ext || '',
      description: '',
      mimeType: contentType || getMimeTypeFromExtension(filename),
      storageType: 'diskStorage',
      path: fileKey,
      absolutePath: join(this.configService.file.publicDir, fileKey),
      processingStatus: PROCESSING_STATUS.PENDING,
      status: FILE_STATUS.PENDING,
      uploadMethod: 'normal',
      acl: acl || 'private',
      isProtected: (acl || 'private') !== 'public-read',
      fileSize: 0,
      originalFileSize: 0,
      uploadedAt: new Date(),
      metadata: {
        ...metadata,
        processingOptions,
        originalFilename: filename
      },
      createdBy: createdBy || null,
      updatedBy: updatedBy || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.FileModel.create(fileData);

    // Generate upload token
    const uploadToken = generateUploadToken(fileId.toString(), fileKey, acl, this.configService.auth.jwtSecret);
    const { baseUrl } = this.configService.app;

    return {
      uploadUrl: new URL('files/upload', baseUrl).href,
      fileId: fileId.toString(),
      token: uploadToken,
      fields: {
        key: fileKey,
        'Content-Type': contentType || 'application/octet-stream',
        acl: acl || 'private'
      },
      fieldName: this.configService.app.fileFieldName || 'file',
      expiresIn: 3600 * 2, // 2 hours
      uploadType: 'normal',
      httpMethod: 'POST'
    };
  }

  /**
   * Update file status by file ID
   *
   * @param fileId - File ID
   * @param status - New file status
   * @param additionalFields - Additional fields to update
   * @returns Promise resolving when update is complete
   */
  public async updateFileStatus(
    fileId: string,
    status: string,
    additionalFields?: Record<string, any>
  ): Promise<void> {
    const updateFields = {
      status,
      updatedAt: new Date(),
      ...additionalFields
    };

    const result = await this.FileModel.updateOne(
      { _id: fileId },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      throw new EntityNotFoundException(`File not found with ID: ${fileId}`);
    }

    // Clean up physical files if status is set to ERROR
    if (status === FILE_STATUS.ERROR) {
      await this.cleanupErroredFile(fileId);
    }
  }

  /**
  * Update existing file record with TUS ID and size
  *
  * Updates a file record that was created during TUS URL generation
  * with the actual TUS upload ID and size when the upload starts.
  * Also updates the status to reflect that the upload is in progress.
  *
  * @param fileId - File ID from the database
  * @param tusId - TUS upload ID
  * @param size - Upload size
  * @returns Promise resolving when update is complete
  */
  public async updateFileWithTusId(fileId: string, tusId: string, size: number): Promise<void> {
    const result = await this.FileModel.updateOne(
      { _id: fileId },
      {
        $set: {
          tusId,
          fileSize: size,
          originalFileSize: size,
          status: FILE_STATUS.UPLOADING,
          updatedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      throw new EntityNotFoundException(`File record not found for ID: ${fileId}`);
    }

    // File record updated successfully with TUS upload status
  }

  /**
   * Process uploaded file and update database record
   *
   * Takes an uploaded file from the upload endpoint, processes it according
   * to the specified options, and updates the pending file record.
   *
   * @param fileId - File ID from the upload token
   * @param uploadedFile - Multer file object
   * @param options - Processing options
   * @returns Promise resolving to updated file DTO
   */
  public async processUploadedFile(
    fileId: string,
    uploadedFile: IMulterUploadedFile,
    options: {
      fileKey: string;
      acl: string;
      processingOptions?: IFileProcessingOptions;
    }
  ): Promise<FileDto> {
    // Find the pending file record
    const existingFile = await this.FileModel.findById(fileId);
    if (!existingFile) {
      throw new EntityNotFoundException('File record not found');
    }

    const {
      acl,
      processingOptions = existingFile.metadata?.processingOptions || {}
    } = options;

    // file is uploaded to process
    if (existingFile.status !== FILE_STATUS.UPLOADED) {
      throw new HttpException(`File cannot be processed. Current status: ${existingFile.status}`, 400);
    }

    // Validate media type consistency for image and video files
    if (existingFile.mediaType && ['image', 'video', 'audio'].includes(existingFile.mediaType)) {
      this.fileMediaValidationService.validateMediaTypeConsistency(
        existingFile.mediaType,
        uploadedFile.mimetype,
        uploadedFile.originalname,
        uploadedFile.path // Pass file path for cleanup on validation failure
      );
    }

    // Use the uploaded file directly since it's already IMulterUploadedFile
    const multerFile = uploadedFile;

    // Determine file type and processing options
    const bIsImage = isImage(multerFile);
    const bIsVideo = isVideo(multerFile);

    // Map string ACL to S3AccessControl
    let mappedAcl: S3AccessControl;
    switch (acl) {
      case 'public-read':
        mappedAcl = S3_ACCESS_CONTROL.PUBLIC_READ;
        break;
      case 'authenticated-read':
        mappedAcl = S3_ACCESS_CONTROL.AUTHENTICATED_READ;
        break;
      default:
        mappedAcl = S3_ACCESS_CONTROL.PRIVATE;
        break;
    }

    const fileUploadOptions: IFileUploadOptions = {
      thumbnails: {
        enabled: (processingOptions?.generateThumbnail ?? (bIsImage || bIsVideo)),
        sizes: processingOptions?.resizeWidth ? {
          width: processingOptions.resizeWidth,
          height: processingOptions.resizeHeight || null
        } : { width: 450, height: null }
      },
      uploadImmediately: true, // Always upload to storage immediately for API uploads
      acl: mappedAcl,
      replaceOriginal: false, // TODO - check me this option
      fileId: existingFile._id.toString(),
      // Pass processingOptions for immediate processing decisions
      processingOptions,
      // put media type from db to ensure consistency
      mediaType: existingFile.mediaType || 'file' // Use stored mediaType, fallback to 'file'
    };

    // Only add video processing options for video files
    if (bIsVideo) {
      fileUploadOptions.videoProcessing = {
        convertToMp4: processingOptions?.videoFormat === 'mp4'
      };

      // Add thumbnail generation for videos if requested
      if (processingOptions?.generateThumbnail || processingOptions?.generateBlurImage) {
        fileUploadOptions.videoProcessing.thumbnails = {
          count: processingOptions?.generateBlurImage ? 3 : 1, // More thumbnails for blur image
          size: '640x?', // Standard thumbnail size
          atPercentage: 10 // Extract thumbnail at 10% of video duration
        };
      }
    }

    // Process the file using existing processUploadedFile method
    // Pass both type (reference category) and mediaType (processing behavior) through options
    fileUploadOptions.mediaType = existingFile.mediaType;
    fileUploadOptions.referenceType = existingFile.type;

    const processedFile = await this.fileManagerService.processUploadedFile(
      existingFile.type, // Keep for backward compatibility, but use mediaType from options
      multerFile,
      fileUploadOptions
    );

    // Clean up the temporary file after successful processing
    // Similar to TUS upload cleanup logic
    try {
      if (existingFile.uploadMethod === 'normal' && fs.existsSync(uploadedFile.path)) {
        fs.unlinkSync(uploadedFile.path);
      }
    } catch (error) {
      // Log warning but don't fail the operation - cleanup failure shouldn't prevent success response
      this.logger.warn(`Failed to clean up temporary file: ${uploadedFile.path}`, error);
    }

    return FileDto.fromModel(processedFile);
  }

  /**
   * Process a completed TUS upload
   *
   * @param tusId - TUS upload ID
   * @param tusUploadDir - Directory where TUS files are stored
   * @returns Promise resolving to processed file DTO
   */
  public async processTusUpload(tusId: string, tusUploadDir: string): Promise<FileDto> {
    // Find the pending file record by TUS ID
    const pendingFile = await this.FileModel.findOne({ tusId, status: FILE_STATUS.UPLOADING });
    if (!pendingFile) {
      throw new EntityNotFoundException(`Pending file record not found for TUS ID: ${tusId}`);
    }

    // Update status to uploading while processing
    await this.FileModel.findByIdAndUpdate(pendingFile._id, {
      status: FILE_STATUS.UPLOADED,
      updatedAt: new Date()
    });

    // Construct path to the uploaded file
    const tusFilePath = path.join(tusUploadDir, tusId);

    // Create a mock Multer file object for processing
    // Fix MIME type detection for files that were incorrectly detected as application/octet-stream
    let correctedMimeType = pendingFile.mimeType;
    if (correctedMimeType === 'application/octet-stream') {
      correctedMimeType = getMimeTypeFromExtension(pendingFile.originalName);
    }
    // Check if the file exists
    if (!fs.existsSync(tusFilePath)) {
      // Update status to error if file not found
      await this.FileModel.findByIdAndUpdate(pendingFile._id, {
        status: FILE_STATUS.ERROR,
        processingError: { message: 'TUS file not found', path: tusFilePath },
        updatedAt: new Date()
      });
      throw new EntityNotFoundException(`TUS file not found: ${tusFilePath}`);
    }

    // Validate media type consistency for image and video files
    if (pendingFile.mediaType && ['image', 'video', 'audio'].includes(pendingFile.mediaType)) {
      this.fileMediaValidationService.validateMediaTypeConsistency(
        pendingFile.mediaType,
        correctedMimeType,
        pendingFile.originalName,
        tusFilePath // Pass TUS file path for cleanup on validation failure
      );
    }

    const multerFile: IMulterUploadedFile = {
      fieldname: 'file',
      originalname: pendingFile.originalName,
      encoding: '7bit',
      mimetype: correctedMimeType,
      destination: path.dirname(tusFilePath), // Directory to which this file has been uploaded
      filename: path.basename(tusFilePath), // Use the actual filename in the final destination
      path: tusFilePath, // Full path to the uploaded file
      size: pendingFile.fileSize,
      stream: null,
      buffer: null
    };

    const result = await this.processUploadedFile(
      pendingFile._id.toString(),
      multerFile,
      {
        fileKey: pendingFile.path, // Use proper directory based on file type
        acl: pendingFile.acl || 'private',
        processingOptions: pendingFile.metadata?.processingOptions || {
          generateThumbnail: isImage(multerFile) || isVideo(multerFile),
          immediateProcess: false // in queue
        }
      }
    );

    // Clean up the TUS files (both data file and metadata .json file)
    // Clean up TUS metadata file
    try {
      if (fs.existsSync(tusFilePath)) {
        fs.unlinkSync(tusFilePath);
      }

      const tusMetadataPath = `${tusFilePath}.json`;
      if (fs.existsSync(tusMetadataPath)) {
        fs.unlinkSync(tusMetadataPath);
      }
    } catch (error) {
      this.logger.warn(`TUS: Failed to clean up TUS metadata file: ${tusFilePath}.json`, error);
    }

    return result;
  }

  /**
   * Update file status by TUS ID
   *
   * Updates the status of a file record identified by its TUS ID.
   * Used for error handling and status updates during TUS uploads.
   *
   * @param tusId - TUS upload ID
   * @param status - New file status
   * @param additionalFields - Additional fields to update
   * @returns Promise resolving when update is complete
   */
  public async updateFileStatusByTusId(
    tusId: string,
    status: string,
    additionalFields?: Record<string, any>
  ): Promise<void> {
    const updateFields = {
      status,
      updatedAt: new Date(),
      ...additionalFields
    };

    const result = await this.FileModel.updateOne(
      { tusId },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      throw new EntityNotFoundException(`File not found with TUS ID: ${tusId}`);
    }

    // Clean up physical files if status is set to ERROR
    if (status === FILE_STATUS.ERROR) {
      // Find the file by TUS ID to get the file ID for cleanup
      const file = await this.FileModel.findOne({ tusId }).lean();
      if (file) {
        await this.cleanupErroredFile(file._id.toString());
      }
    }
  }

  /**
   * Clean up physical files for a file that has been marked as ERROR
   *
   * This method safely removes physical files associated with a file record
   * that has entered ERROR status. It handles cases where files may be
   * partially processed or missing.
   *
   * @param fileId - ID of the file to clean up
   * @returns Promise resolving to true if cleanup was performed, false otherwise
   * @example
   * ```typescript
   * await fileService.cleanupErroredFile('507f1f77bcf86cd799439011');
   * ```
   */
  public async cleanupErroredFile(fileId: string): Promise<boolean> {
    try {
      const file = await this.FileModel.findById(fileId).lean();
      if (!file) {
        return false;
      }

      // Check environment configuration for file cleanup
      const shouldDeleteOnError = process.env.FILE_DELETE_ON_ERROR !== 'false'; // Default to true
      if (!shouldDeleteOnError) {
        return false;
      }

      // Only clean up if file has physical storage paths
      const hasPhysicalFiles = file.absolutePath ||
        file.path ||
        (file.thumbnails && file.thumbnails.length > 0) ||
        file.blurImagePath;

      if (!hasPhysicalFiles) {
        return false;
      }

      // Log detailed error information before cleanup
      const errorDetails = JSON.stringify({
        fileId,
        fileName: file.name,
        originalName: file.originalName,
        fileSize: file.fileSize,
        mimeType: file.mimeType,
        status: file.status,
        processingStatus: file.processingStatus,
        processingError: file.processingError,
        absolutePath: file.absolutePath,
        path: file.path,
        hasThumbnails: !!(file.thumbnails && file.thumbnails.length > 0),
        hasBlurImage: !!file.blurImagePath,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt
      });
      this.logger.error(`File processing error - initiating cleanup for file: ${fileId}. Details: ${errorDetails}`, '', 'FileService');

      // Add delay before cleanup if configured
      const cleanupDelay = parseInt(process.env.FILE_ERROR_CLEANUP_DELAY || '0', 10);
      if (cleanupDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, cleanupDelay));
      }

      // Use existing removePhysicalFile method for consistent cleanup
      await this.removePhysicalFile(file);
      return true;
    } catch (error) {
      // Log error but don't throw - cleanup failure shouldn't break the main operation
      const errorDetails = JSON.stringify({ fileId, error: error.message, stack: error.stack });
      this.logger.error(`Failed to clean up physical files for errored file ${fileId}: ${error.message}. Details: ${errorDetails}`, error.stack, 'FileService');
      return false;
    }
  }

  /**
   * Add a reference to a file
   *
   * Associates a file with a specific content item (feed, product, message, etc.).
   * This creates a many-to-many relationship between files and content items,
   * allowing files to be shared across multiple content pieces.
   *
   * @param fileId - ID of the file to reference
   * @param ref - Reference information containing item ID and type
   * @example
   * ```typescript
   * await fileService.addRef(fileId, {
   *   itemId: new ObjectId('507f1f77bcf86cd799439011'),
   *   itemType: 'feed'
   * });
   * ```
   */
  public async addRef(
    fileId: ObjectId | string,
    ref: {
      itemId: ObjectId;
      itemType: string;
    }
  ) {
    await this.FileModel.updateOne(
      { _id: fileId },
      {
        $addToSet: {
          refItems: ref
        }
      }
    );
  }

  /**
   * Add references to multiple files in batch
   *
   * Efficiently associates multiple files with content items in a single operation.
   * This is optimized for performance when dealing with multiple file references.
   *
   * @param fileRefs - Array of file references containing file ID and reference info
   * @example
   * ```typescript
   * await fileService.addRefBatch([
   *   {
   *     fileId: 'file-id-1',
   *     ref: { itemId: new ObjectId('507f1f77bcf86cd799439011'), itemType: 'feed' }
   *   },
   *   {
   *     fileId: 'file-id-2',
   *     ref: { itemId: new ObjectId('507f1f77bcf86cd799439011'), itemType: 'feed' }
   *   }
   * ]);
   * ```
   */
  public async addRefBatch(
    fileRefs: Array<{
      fileId: ObjectId | string;
      ref: {
        itemId: ObjectId;
        itemType: string;
      };
    }>
  ) {
    if (!fileRefs || fileRefs.length === 0) {
      return;
    }

    // Use bulkWrite for efficient batch operations
    const bulkOps = fileRefs.map((fileRef) => ({
      updateOne: {
        filter: { _id: new ObjectId(fileRef.fileId) },
        update: {
          $addToSet: {
            refItems: fileRef.ref
          }
        }
      }
    }));

    await this.FileModel.bulkWrite(bulkOps);
  }

  /**
   * Add same reference to multiple files
   *
   * Associates multiple files with the same content item efficiently.
   * Useful when multiple files belong to the same feed, product, etc.
   *
   * @param fileIds - Array of file IDs to reference
   * @param ref - Reference information to add to all files
   * @example
   * ```typescript
   * await fileService.addRefToMultipleFiles(
   *   ['file-id-1', 'file-id-2', 'file-id-3'],
   *   { itemId: new ObjectId('507f1f77bcf86cd799439011'), itemType: 'feed' }
   * );
   * ```
   */
  public async addRefToMultipleFiles(
    fileIds: Array<ObjectId | string>,
    ref: {
      itemId: ObjectId;
      itemType: string;
    }
  ) {
    if (!fileIds || fileIds.length === 0) {
      return;
    }

    await this.FileModel.updateMany(
      { _id: { $in: fileIds } },
      {
        $addToSet: {
          refItems: ref
        }
      }
    );
  }

  /**
   * Update file ownership (createdBy and updatedBy) for a single file
   *
   * @param fileId - File ID to update
   * @param updates - Object containing createdBy and/or updatedBy values
   * @param currentCreatedBy - Optional filter to match current createdBy value for security
   * @param ref - Optional reference to add to the file
   * @returns Promise resolving to update result
   */
  async updateFileOwnership(
    fileId: string | ObjectId,
    updates: { createdBy?: string; updatedBy?: string, ref?: { itemId: ObjectId; itemType: string } },
    currentCreatedBy?: string
  ): Promise<{ updated: boolean; fileId: string }> {
    try {
      const query: any = { _id: new ObjectId(fileId) };

      // Add security filter if provided
      if (currentCreatedBy) {
        query.createdBy = currentCreatedBy;
      }

      const updateData: any = {};
      if (updates.createdBy !== undefined) {
        updateData.createdBy = updates.createdBy;
      }
      if (updates.updatedBy !== undefined) {
        updateData.updatedBy = updates.updatedBy;
      }

      // Always update the updatedAt timestamp
      updateData.updatedAt = new Date();
      const updateQuery: any = { $set: updateData };
      // add ref if provided
      if (updates.ref !== undefined) {
        updateQuery.$addToSet = {
          refItems: updates.ref
        };
      }

      const result = await this.FileModel.updateOne(query, updateQuery);

      const updated = result.modifiedCount > 0;

      return {
        updated,
        fileId: fileId.toString()
      };
    } catch (error) {
      throw new HttpException(`Failed to update file ownership: ${error.message}`, 500);
    }
  }

  /**
   * Update file ownership for multiple files
   *
   * @param fileIds - Array of file IDs to update
   * @param updates - Object containing createdBy and/or updatedBy values
   * @param currentCreatedBy - Optional filter to match current createdBy value for security
   * @param ref - Optional reference to add to updated files
   * @returns Promise resolving to batch update result
   */
  async updateMultipleFileOwnership(
    fileIds: Array<string | ObjectId>,
    updates: { createdBy?: string; updatedBy?: string, ref?: { itemId: ObjectId; itemType: string } },
    currentCreatedBy?: string
  ): Promise<{
    updated: number;
    updatedFileIds: string[];
    errors: Array<{ fileId: string; error: string }>;
  }> {
    const results = {
      updated: 0,
      updatedFileIds: [] as string[],
      errors: [] as Array<{ fileId: string; error: string }>
    };

    for (const fileId of fileIds) {
      try {
        const result = await this.updateFileOwnership(fileId, updates, currentCreatedBy);
        if (result.updated) {
          results.updated++;
          results.updatedFileIds.push(result.fileId);
        }
      } catch (error) {
        results.errors.push({
          fileId: fileId.toString(),
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Delete multiple files by IDs in batch
   *
   * Efficiently deletes multiple files and their physical storage in a single operation.
   * This is optimized for performance when dealing with multiple file deletions.
   *
   * @param fileIds - Array of file IDs to delete
   * @returns Deletion results with success and error counts
   * @example
   * ```typescript
   * const result = await fileService.deleteManyByIds(['file-id-1', 'file-id-2']);
   * console.log(`Deleted: ${result.deleted}, Errors: ${result.errors.length}`);
   * ```
   */
  public async deleteManyByIds(fileIds: Array<ObjectId | string>) {
    if (!fileIds || fileIds.length === 0) {
      return { deleted: 0, errors: [] };
    }

    return this.deleteMany(fileIds.map(id => id.toString()));
  }

  /**
   * Remove unused files by type after a specified time period
   *
   * Cleanup operation that removes files of specific types that have no references
   * and are older than the specified time threshold. Prevents immediate deletion
   * of recently uploaded files that may not have been associated yet.
   *
   * @param types - Array of file types to clean up (e.g., ['image', 'video'])
   * @param timeInHours - Minimum age in hours before files can be deleted (default: 6)
   * @example
   * ```typescript
   * // Clean up unused images and videos older than 24 hours
   * await fileService.removeUnusedFilesByTypes(['image', 'video'], 24);
   * ```
   */
  public async removeUnusedFilesByTypes(types: string[], timeInHours = 6): Promise<void> {
    const thresholdTime = new Date(Date.now() - timeInHours * 60 * 60 * 1000);

    const unusedFiles = await this.FileModel.find({
      type: { $in: types },
      createdAt: { $lt: thresholdTime },
      $or: [
        { refItems: { $exists: false } },
        { refItems: { $size: 0 } }
      ]
    }).lean();

    if (!unusedFiles.length) {
      return;
    }

    await unusedFiles.reduce(async (cb, file) => {
      await cb;
      await this.FileModel.deleteOne({ _id: file._id });
      await this.removePhysicalFile(file);
      return Promise.resolve();
    }, Promise.resolve());
  }

  /**
   * Delete multiple files by IDs
   *
   * Removes files from both database and storage.
   * Handles cleanup of thumbnails and related files.
   * Also removes empty parent directories after deletion.
   *
   * @param fileIds - Array of file IDs to delete
   * @returns Promise resolving to deletion results
   */
  public async deleteMany(fileIds: string[]): Promise<{ deleted: number; errors: Array<{ fileId: string; error: string }> }> {
    const results = { deleted: 0, errors: [] };

    // Process all file deletions concurrently using Promise.all and map
    await Promise.all(
      fileIds.map(async (fileId) => {
        try {
          // Tombstone atomically so a queued worker can no longer claim the
          // record after this point. Returning the previous document also tells
          // us whether a worker already owns media-processing handles.
          const existingFile = await this.FileModel.findOneAndUpdate(
            { _id: fileId },
            { $set: { status: FILE_STATUS.DELETED, updatedAt: new Date() } },
            { new: false }
          );
          if (!existingFile) {
            results.errors.push({ fileId, error: 'File not found' });
            return;
          }

          const workerOwnsFileHandles = [
            PROCESSING_STATUS.IN_QUEUE,
            PROCESSING_STATUS.PROCESSING
          ].some(status => status === existingFile.processingStatus);

          if (workerOwnsFileHandles) {
            // Discard is durable once tombstoned. The processing worker will
            // remove every generated asset and this record after releasing its
            // FFmpeg/Sharp handles.
            results.deleted += 1;
            return;
          }

          await this.removePhysicalFile(existingFile);
          await this.FileModel.deleteOne({ _id: fileId });
          results.deleted += 1;
        } catch (error) {
          results.errors.push({ fileId, error: error.message });
        }
      })
    );

    return results;
  }

  public async removeDetachedPhysicalFile(file: File | FileDto): Promise<void> {
    await this.removePhysicalFile(file);
  }

  /**
   * Finish a deferred discard after the media worker has released its handles.
   * Both physical removal and the final database delete are idempotent so a
   * retried BullMQ job converges on the same result.
   */
  public async cleanupDiscardedFile(file: File | FileDto): Promise<void> {
    await this.removePhysicalFile(file);

    const fileId = (file as any)._id?.toString();
    if (fileId) {
      await this.FileModel.deleteOne({ _id: fileId, status: FILE_STATUS.DELETED });
    }
  }

  /**
   * Get base directory for file type
   */
  /**
   * Remove physical file from storage
   *
   * Deletes the actual file and all its thumbnails from the storage backend.
   * Handles both local disk storage and cloud storage (S3, etc.).
   * Also removes empty parent directories after file deletion.
   *
   * @param file - File document or DTO to remove
   * @private
   */
  private async removePhysicalFile(file: File | FileDto) {
    this.removePendingTusUploadFiles(file);

    const keys: any = [
      {
        absolutePath: file.absolutePath,
        path: file.path
      },
      ...(file.thumbnails || []),
      {
        absolutePath: (file as any).blurImagePath
      }
    ].reduce((res: string[], f) => {
      if (f.absolutePath && !isUrl(f.absolutePath)) res.push(f.absolutePath);
      if (f.path && !isUrl(f.path)) res.push(f.path);

      return res;
    }, []);

    // Delete files using storage service
    const deleteResult = await this.storageService.removeFilesFromStorage({
      keys,
      storageType: (file as any).storageType || (file as any).server as any
    });
    if (!deleteResult.success) {
      throw new Error(`Failed to remove files from storage: ${(deleteResult.errors || []).join('; ')}`);
    }

    // For disk storage, also remove empty parent directories
    if ((file as any).storageType === 'diskStorage' || (file as any).server === 'diskStorage') {
      await this.removeDiskVideoAssetDirectory(file);
      await this.removeEmptyDirectoriesForFile(file);
    }
  }

  /**
   * Remove the complete per-video directory, including processing output that
   * may not have reached the database thumbnail list before a draft is discarded.
   */
  private async removeDiskVideoAssetDirectory(file: File | FileDto): Promise<void> {
    const fileId = (file as any)._id?.toString();
    const isVideo = (file as any).type?.includes?.('video')
      || (file as any).mimeType?.startsWith?.('video/')
      || String((file as any).path || '').replace(/\\/g, '/').includes('/videos/');
    if (!fileId || !isVideo) return;

    const publicRoot = path.resolve(fromPosixPath(this.configService.file.publicDir));
    const videoRoot = path.resolve(publicRoot, 'videos');
    const videoDirectory = path.resolve(videoRoot, fileId);
    const safeVideoRootPrefix = `${videoRoot}${path.sep}`;

    if (!videoDirectory.startsWith(safeVideoRootPrefix)) {
      throw new Error(`Unsafe video cleanup path for file ${fileId}`);
    }

    try {
      await fs.promises.rm(videoDirectory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200
      });
    } catch (error) {
      throw new Error(`Failed to remove video directory ${videoDirectory}: ${error.message}`);
    }
  }

  /**
   * Remove a partial TUS upload that has not reached the final storage path yet.
   * Pending TUS records have no absolutePath, so storage cleanup alone cannot
   * discover these temporary files.
   */
  private removePendingTusUploadFiles(file: File | FileDto): void {
    const tusId = (file as any).tusId;
    if (!tusId) return;

    const tusUploadRoot = path.resolve(fromPosixPath(
      this.configService.file.tus?.uploadDir
      || path.join(process.cwd(), 'storage', 'tus-uploads')
    ));
    const safeRootPrefix = `${tusUploadRoot}${path.sep}`;
    const candidatePaths = [
      path.resolve(tusUploadRoot, tusId),
      path.resolve(tusUploadRoot, `${tusId}.info`),
      path.resolve(tusUploadRoot, `${tusId}.json`)
    ];

    candidatePaths.forEach((candidatePath) => {
      if (!candidatePath.startsWith(safeRootPrefix)) {
        throw new Error(`Unsafe TUS cleanup path for file ${(file as any)._id}`);
      }

      try {
        if (fs.existsSync(candidatePath)) fs.unlinkSync(candidatePath);
      } catch (error) {
        throw new Error(`Failed to delete partial TUS file ${candidatePath}: ${error.message}`);
      }
    });
  }

  /**
   * Remove empty directories for a specific file
   *
   * @param file - File document or DTO
   * @private
   */
  private async removeEmptyDirectoriesForFile(file: File | FileDto): Promise<void> {
    try {
      // const path = await import('path');
      const foldersToCheck = new Set<string>();

      // Collect all parent directories from file paths
      // Convert POSIX paths from database to platform-specific paths
      if (file.absolutePath && !isUrl(file.absolutePath)) {
        const platformAbsolutePath = fromPosixPath(file.absolutePath);
        const parentDir = path.dirname(platformAbsolutePath);
        foldersToCheck.add(parentDir);
      }

      // Collect parent directories from thumbnails
      if (file.thumbnails && Array.isArray(file.thumbnails)) {
        file.thumbnails.forEach((thumbnail) => {
          if (thumbnail.absolutePath && !isUrl(thumbnail.absolutePath)) {
            const platformThumbnailPath = fromPosixPath(thumbnail.absolutePath);
            const parentDir = path.dirname(platformThumbnailPath);
            foldersToCheck.add(parentDir);
          }
        });
      }

      // Collect parent directory from blur image
      if ((file as any).blurImagePath) {
        const platformBlurImagePath = fromPosixPath((file as any).blurImagePath);
        const parentDir = path.dirname(platformBlurImagePath);
        foldersToCheck.add(parentDir);
      }

      // Remove empty directories
      await this.removeEmptyDirectories(Array.from(foldersToCheck));
    } catch (error) {
      // Log warning but don't fail the operation
      this.logger.warn(`Failed to remove empty directories for file ${(file as any)._id}: ${error.message}`);
    }
  }

  /**
   * Remove empty directories recursively
   *
   * @param directories - Array of directory paths to check and remove if empty
   * @private
   */
  private async removeEmptyDirectories(directories: string[]): Promise<void> {
    for (const dir of directories) {
      try {
        // Skip if directory doesn't exist
        if (!fs.existsSync(dir)) {
          continue;
        }

        // Check if directory is empty
        const files = fs.readdirSync(dir);
        if (files.length === 0) {
          // Remove empty directory
          fs.rmdirSync(dir);

          // Recursively check parent directory
          const parentDir = path.dirname(dir);
          const publicDir = this.configService.file.publicDir;
          const tusUploadDir = this.configService.file.tus?.uploadDir
            || path.join(process.cwd(), 'storage', 'tus-uploads');
          const storageDir = path.dirname(tusUploadDir);

          // Don't remove base directories (public, storage, uploads, etc.)
          if (parentDir !== publicDir &&
            parentDir !== storageDir &&
            !parentDir.endsWith('uploads') &&
            !parentDir.endsWith('storage') &&
            parentDir !== path.dirname(publicDir)) {
            await this.removeEmptyDirectories([parentDir]);
          }
        }
      } catch { /* Ignore errors */ }
    }
  }
}
