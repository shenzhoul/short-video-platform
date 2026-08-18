import { Injectable } from "@nestjs/common";
import { IFileUploadOptions } from "src/common/lib/file";
import { IMulterUploadedFile } from "src/common/lib/file/multer/multer.utils";
import { FileDto } from "src/dtos/file.dto";
import { FileMetadataService } from "src/services/file/file-metadata.service";
import { FileProcessingService } from "src/services/file/file-processing.service";
import { FileValidationService } from "src/services/file/file-validation.service";
import { ObjectId } from 'mongodb';
import { AppConfigService } from "src/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { FileDocument } from "src/schemas";
import { FILE_STATUS, PROCESSING_STATUS } from "src/common/constants/content";
import { QueueMessageService } from "src/kernel";
import { extractDominantHsl } from "src/kernel/helpers/image-color.helper";
import { fromPosixPath } from "src/kernel/helpers/string.helper";
import { IFileUploadResponse } from "src/common/interfaces/file";
import { isImage } from "src/lib/file-type";
import { StorageService } from "src/services/file/storage.service";

/** Queue channels for processing operations */
/** Queue channel for video processing operations */
export const FILE_SERVER_VIDEO_QUEUE_CHANNEL = 'FILE_SERVER_VIDEO_QUEUE_CHANNEL';
/** Queue channel for photo processing operations */
export const FILE_SERVER_PHOTO_QUEUE_CHANNEL = 'FILE_SERVER_PHOTO_QUEUE_CHANNEL';
/** File processing events emitted by the service */
export const FILE_EVENT = {
  /** Emitted when video processing is completed */
  VIDEO_PROCESSED: 'VIDEO_PROCESSED',
  /** Emitted when video processing failed */
  VIDEO_FAILED: 'VIDEO_FAILED',
  /** Emitted when photo processing is completed */
  PHOTO_PROCESSED: 'PHOTO_PROCESSED',
  /** Emitted when photo processing failed */
  PHOTO_FAILED: 'PHOTO_FAILED',
};

/**
 * File Manager Service
 *
 * Main orchestrator service that coordinates file upload, validation, processing,
 * and storage operations. This service provides a clean, simplified interface
 * while delegating specific responsibilities to specialized services.
 *
 * Key Features:
 * - Centralized file upload orchestration
 * - Automatic validation and processing
 * - Queue-based background processing
 * - Comprehensive error handling
 * - Clean separation of concerns
 */
@Injectable()
export class FileManagerService {
  constructor(
    @InjectModel(File.name) private readonly fileModel: Model<FileDocument>,
    private readonly validationService: FileValidationService,
    private readonly metadataService: FileMetadataService,
    private readonly processingService: FileProcessingService,
    private readonly configService: AppConfigService,
    private readonly queueService: QueueMessageService,
    private readonly storageService: StorageService
  ) { }

  /**
  * Find file by ID
  */
  async findById(id: string): Promise<FileDto | null> {
    const file = await this.fileModel.findById(id);
    return file ? FileDto.fromModel(file) : null;
  }

  /**
     * Create file record from Multer uploaded file data
     *
     * This is the main entry point for file uploads. It orchestrates the entire
     * file processing pipeline from validation to storage.
     *
     * @param type - File type identifier
     * @param multerData - Multer upload data
     * @param existingFileId - Optional existing file ID (for TUS uploads)
     * @param options - File upload options
     */
  async processUploadedFile(
    type: string,
    multerData: IMulterUploadedFile,
    options: IFileUploadOptions = {}
  ): Promise<FileDto> {
    // Step 1: Validate file and options
    this.validationService.validateFile(multerData, options);

    // const fileType = this.validationService.getFileType(multerData);
    // Use existing file ID if provided (for TUS uploads), otherwise create new one
    const fileId = options.fileId?.toString() || new ObjectId().toString();

    // Step 2: Extract metadata
    const metadata = await this.metadataService.extractMetadata(multerData, options);
    const mediaType = (options.mediaType || type) as 'image' | 'video' | 'file';

    if (type === 'cover' && mediaType === 'image') {
      try {
        metadata.metadata = {
          ...metadata.metadata,
          coverBgColor: await extractDominantHsl(multerData.path)
        };
      } catch {
        metadata.metadata = {
          ...metadata.metadata,
          coverBgColor: 'hsl(313deg 26% 15%)'
        };
      }
    }

    // Step 3: Generate file paths (use pre-generated paths for TUS uploads)
    // let filePaths: { mainFileKey: string; fileName: string; isProtected: boolean };

    // Generate file paths normally for regular uploads
    const baseDir = this.getDirFromUploadedPath(multerData.path);
    const filePaths = this.metadataService.generateFilePaths(
      multerData, // should rename multerData to uploadedFile
      options,
      fileId
    );
    // Step 4: Determine processing strategy
    const requiresProcessing = this.validationService.requiresProcessing(multerData, options);

    // Use explicit mediaType from options if provided, otherwise fall back to type parameter
    const processingFileType: 'image' | 'video' | 'file' = mediaType;
    const shouldProcessImmediately = this.processingService.shouldProcessImmediately(
      multerData.size,
      options,
      processingFileType, // Use explicit mediaType for processing decisions
      options.processingOptions // Pass processingOptions for immediateProcess flag
    );

    let processingResults: any = {
      thumbnails: [],
      processedImmediately: shouldProcessImmediately,
      queued: false
    };

    // Step 5: Upload to storage FIRST (before queueing)
    // This ensures queue jobs get the final storage path, not temp path
    const uploadResult = await this.uploadToStorage(
      multerData,
      options,
      filePaths,
      processingResults
    );

    // update file path to DB, require if this is an existing file (TUS)
    // Step 8: Create database record (skip for TUS uploads)
    if (options.fileId) {
      await this.fileModel.findOneAndUpdate(
        { _id: fileId },
        {
          path: uploadResult.key,
          absolutePath: uploadResult.absolutePath,
          status: FILE_STATUS.UPLOADED,
          processingStatus: requiresProcessing ? PROCESSING_STATUS.PENDING : PROCESSING_STATUS.COMPLETED,
          updatedAt: new Date()
        }
      );
    }

    // Step 6: Process file (immediate or queue) - AFTER upload
    if (requiresProcessing) {
      if (shouldProcessImmediately) {
        processingResults = await this.processFileImmediately(
          multerData,
          options,
          processingFileType,
          fileId
        );
      } else {
        // Queue for background processing with FINAL storage path
        // Create updated multerData with final storage path for queue processing
        const multerDataWithFinalPath = {
          ...multerData,
          path: uploadResult.absolutePath // Use final storage path instead of temp path
        };

        await this.queueFileProcessing(
          multerDataWithFinalPath,
          options,
          processingFileType, // Use explicit mediaType for queue processing
          fileId,
          baseDir
        );
        processingResults.processedImmediately = false;
        processingResults.queued = true;
      }
    } else {
      // File doesn't require processing - set status to available for existing files
      if (options.fileId) {
        await this.fileModel.findOneAndUpdate(
          { _id: fileId },
          {
            processingStatus: PROCESSING_STATUS.COMPLETED,
            updatedAt: new Date()
          }
        );
      }
    }

    // Step 7: Calculate real file size if needed
    if (options.calculateRealSize) {
      processingResults.realFileSize = await this.processingService.calculateRealFileSize(
        uploadResult.absolutePath
      );
    }

    const fileDocument = this.metadataService.createFileDocument(
      fileId,
      type,
      multerData,
      options,
      metadata,
      { ...processingResults, finalPath: uploadResult.absolutePath },
      filePaths
    );

    // Add generated tags
    fileDocument.tags = this.metadataService.generateFileTags(metadata, options);

    // Step 8: Create database record (skip for TUS uploads)
    if (options.fileId) {
      return this.fileModel.findOneAndUpdate(
        { _id: fileId },
        {
          ...fileDocument,
          updatedAt: new Date()
        }
      );
    }

    // Step 9: Save to database
    const savedFile = await this.fileModel.create(fileDocument);

    return FileDto.fromModel(savedFile);
  }

  /**
   * Queue file for background processing
   *
   * Uses the existing queueVideoProcessing and queuePhotoProcessing methods
   * to ensure consistent data structure and processing flow.
   */
  public async queueFileProcessing(
    multerData: IMulterUploadedFile,
    options: IFileUploadOptions,
    fileType: 'image' | 'video' | 'file',
    fileId: string,
    baseDir: any
  ): Promise<void> {
    // Only queue images, videos and audios for processing; documents/files are stored as-is
    if (fileType !== 'image' && fileType !== 'video') return;

    // Get priority for the processing
    const priority = this.processingService.getProcessingPriority(fileType, options, options.processingOptions);

    // Create enhanced options with priority and processing details
    const queueOptions = {
      meta: {
        filePath: multerData.path,
        fileType,
        baseDir,
        priority,
        originalOptions: options,
        createdAt: new Date()
      }
    };

    // Use existing queue methods to ensure consistent data structure
    if (fileType === 'video') {
      const thumbnailOptions = options.videoProcessing?.thumbnails;
      const defaultThumbnailCount = options.thumbnails?.enabled === false ? 0 : 1;

      // For videos, add video-specific options with priority
      const videoOptions = {
        ...queueOptions,
        size: thumbnailOptions?.size || '640x?',
        count: thumbnailOptions ? (thumbnailOptions.count ?? defaultThumbnailCount) : defaultThumbnailCount,
        md5Hashing: options.md5Hashing,
        priority // Pass priority to queue
      };

      await this.queueVideoProcessing(fileId, videoOptions);
    } else if (fileType === 'image') {
      // For images, add image-specific options with priority
      const thumbnailSize = Array.isArray(options.thumbnails?.sizes)
        ? options.thumbnails.sizes[0]
        : options.thumbnails?.sizes;

      const imageOptions = {
        ...queueOptions,
        thumbnailSize: {
          width: thumbnailSize?.width || 450,
          height: thumbnailSize?.height || undefined
        },
        priority // Pass priority to queue
      };

      await this.queuePhotoProcessing(fileId, imageOptions);
    }
  }

  /**
   * Queue existing video file for processing
   *
   * @param fileId - ID of the video file to process
   * @param options - Processing options with priority support
   */
  public async queueVideoProcessing(
    fileId: string,
    options?: {
      meta?: Record<string, any>;
      publishChannel?: string;
      size?: string;
      count?: number;
      priority?: number;
    }
  ): Promise<boolean> {
    const file = await this.fileModel.findById(fileId);
    if (!file || file.processingStatus === 'processing') {
      return false;
    }

    // Create queue job with priority support
    const jobOptions: any = {
      eventName: 'PROCESS_VIDEO',
      data: {
        file: FileDto.fromModel(file),
        options
      }
    };

    // Add priority if specified
    if (options?.priority) {
      jobOptions.priority = options.priority;
    }

    await this.queueService.publish(FILE_SERVER_VIDEO_QUEUE_CHANNEL, jobOptions);

    return true;
  }

  /**
   * Queue existing photo file for processing
   *
   * @param fileId - ID of the photo file to process
   * @param options - Processing options with priority support
   */
  public async queuePhotoProcessing(
    fileId: string,
    options?: {
      meta?: Record<string, any>;
      publishChannel?: string;
      thumbnailSize?: {
        width: number;
        height: number;
      };
      priority?: number;
    }
  ): Promise<boolean> {
    const file = await this.fileModel.findById(fileId);
    if (!file || file.processingStatus === 'processing') {
      return false;
    }

    // Create queue job with priority support
    const jobOptions: any = {
      eventName: 'PROCESS_PHOTO',
      data: {
        file: FileDto.fromModel(file),
        options
      }
    };

    // Add priority if specified
    if (options?.priority) {
      jobOptions.priority = options.priority;
    }

    await this.queueService.publish(FILE_SERVER_PHOTO_QUEUE_CHANNEL, jobOptions);

    return true;
  }

  /**
   * Process file immediately (synchronous processing)
   */
  private async processFileImmediately(
    multerData: IMulterUploadedFile,
    options: IFileUploadOptions,
    fileType: 'image' | 'video' | 'document' | 'audio' | 'file',
    fileId: string
  ): Promise<any> {
    if (fileType === 'image') {
      const fileDto = await this.findById(fileId);
      const processingResult = await this.processingService.processPhoto(
        multerData.path,
        fileDto,
        options
      );
      await this.fileModel.updateOne({ _id: fileId }, { $set: { processingStatus: PROCESSING_STATUS.COMPLETED } });
      return processingResult;
    }

    if (fileType === 'video') {
      const fileDto = await this.findById(fileId);
      const processingResult = this.processingService.processVideo(
        multerData.path,
        fileDto,
        options
      );
      await this.fileModel.updateOne({ _id: fileId }, { $set: { processingStatus: PROCESSING_STATUS.COMPLETED } });
      return processingResult;
    }

    // For documents and audio, only MD5 hashing if enabled; no thumbnail or conversion
    const result: any = { thumbnails: [], processedImmediately: true };
    if (options.md5Hashing?.enabled && options.md5Hashing.hashOriginal) {
      // For documents, we can use a generic hash function
      const crypto = await import('crypto');
      const fs = await import('fs');
      // Convert POSIX path to platform-specific path before file operations
      const platformPath = fromPosixPath(multerData.path);
      const fileBuffer = fs.readFileSync(platformPath);
      result.processedHash = crypto.createHash('md5').update(fileBuffer as any).digest('hex');
    }

    return result;
  }

  /**
   * Upload processed file to storage
   */
  private async uploadToStorage(
    multerData: IMulterUploadedFile,
    options: IFileUploadOptions,
    filePaths: Record<string, any>,
    processingResults: Record<string, any>
  ): Promise<IFileUploadResponse> {
    const bIsImage = isImage(multerData);

    // Determine which file to upload
    let fileToUpload = multerData.path;
    let contentType = multerData.mimetype;

    // If image was processed and should replace original
    if (bIsImage && options.replaceOriginal && processingResults.processedPath) {
      fileToUpload = processingResults.processedPath;
      contentType = 'image/webp';
    }

    // If video was converted
    if (processingResults.convertedPath) {
      fileToUpload = processingResults.convertedPath;
      contentType = 'video/mp4';
    }

    // Read file for upload
    return this.storageService.uploadFileToStorage({
      fromFile: fileToUpload,
      acl: options.acl || 'public-read',
      key: filePaths.mainFileKey,
      contentType,
      rename: true
    });
  }

  /**
   * Get directory information from uploaded path
   */
  private getDirFromUploadedPath(uploadedPath: string | null = null) {
    const { publicDir } = this.configService.file;
    const newUploadedPath = uploadedPath || publicDir;
    const path = newUploadedPath.replace(publicDir, '');

    const dirs = path.split('/').filter(Boolean);
    const dir = dirs.length > 0 ? dirs[0] : 'files';

    return {
      dir,
      path: `/${dir}`,
      publicDir
    };
  }
}
