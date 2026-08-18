import { Injectable, Logger } from "@nestjs/common";
import { extname, parse } from "path";
import { PROCESSING_STATUS, STORAGE_TYPES } from "src/common/constants/content";
import { IFileUploadOptions } from "src/common/lib/file";
import { IMulterUploadedFile } from "src/common/lib/file/multer/multer.utils";
import { isImage, isVideo } from "src/lib/file-type";
import { ImageService } from "src/services/file/image.service";
import { FileVideoService } from "src/services/file/video.service";

/**
 * File Metadata Service
 *
 * Handles extraction, processing, and management of file metadata including
 * EXIF data, video metadata, file properties, and custom metadata.
 *
 * This service provides a centralized way to handle all metadata operations.
 */
@Injectable()
export class FileMetadataService {
  private readonly logger = new Logger(FileMetadataService.name);

  constructor(
    private readonly imageService: ImageService,
    private readonly videoService: FileVideoService
  ) { }

  /**
   * Generate file paths and keys for storage
   */
  generateFilePaths(
    multerData: IMulterUploadedFile,
    options: IFileUploadOptions,
    fileId: string
  ): {
    mainFileKey: string;
    fileName: string;
    isProtected: boolean;
  } {
    const fileName = multerData.filename;
    const acl = options.acl || multerData.acl || 'public-read';
    const isProtected = acl !== 'public-read';
    const bIsImage = isImage(multerData);
    const bIsVideo = isVideo(multerData);

    // Determine root directory based on explicit mediaType or file detection
    let rootKey = 'uploads'; // Default root directory

    // Use explicit mediaType from options if provided
    if (options.mediaType) {
      switch (options.mediaType) {
        case 'image':
          rootKey = 'photos';
          break;
        case 'video':
          rootKey = 'videos';
          break;
        case 'document':
          rootKey = 'documents';
          break;
        case 'audio':
          rootKey = 'audio';
          break;
        case 'file':
          rootKey = 'files';
          break;
        default:
          rootKey = 'uploads';
      }
    } else {
      if (bIsImage) rootKey = 'photos';
      else if (bIsVideo) rootKey = 'videos';
      else if (multerData.mimetype.startsWith('audio/')) rootKey = 'audio';
    }

    let mainFileKey = isProtected
      ? `${rootKey}/${fileId}/protected/${fileName}`
      : `${rootKey}/${fileId}/${fileName}`;

    const bIsAudio = multerData.mimetype.startsWith('audio/');
    const effectiveMediaType = options.mediaType
      || (bIsImage ? 'image' : bIsVideo ? 'video' : bIsAudio ? 'audio' : 'file');

    if (effectiveMediaType === 'image' && bIsImage && (options.thumbnails?.enabled || options.replaceOriginal)) {
      // Images with thumbnail generation or replacement get .webp extension
      const parsedPath = parse(mainFileKey);
      mainFileKey = `${parsedPath.dir}/${parsedPath.name}.webp`;
    } else if (effectiveMediaType === 'image' && bIsImage && !extname(mainFileKey)) {
      // Images without extension default to .webp
      mainFileKey = `${mainFileKey}.webp`;
    } else if (effectiveMediaType === 'video' && bIsVideo && !extname(mainFileKey)) {
      // For videos, preserve the original file extension from originalname
      const originalExt = extname(multerData.originalname);
      if (originalExt) {
        mainFileKey = `${mainFileKey}${originalExt}`;
      } else {
        // Default to .mp4 if no extension found
        mainFileKey = `${mainFileKey}.mp4`;
      }
    } else if ((effectiveMediaType === 'file' || effectiveMediaType === 'document' || effectiveMediaType === 'audio') && !extname(mainFileKey)) {
      // For files, documents, and audio, preserve the original extension
      const originalExt = extname(multerData.originalname);
      if (originalExt) {
        mainFileKey = `${mainFileKey}${originalExt}`;
      }
    }

    return {
      mainFileKey,
      fileName,
      isProtected
    };
  }

  /**
   * Create file document data for database storage
   */
  createFileDocument(
    fileId: string,
    type: string,
    multerData: IMulterUploadedFile,
    options: IFileUploadOptions,
    metadata: any,
    processingResults: any,
    filePaths: any
  ): any {
    const now = new Date();

    let processingStatus: string = PROCESSING_STATUS.PENDING;
    if (processingResults.processedImmediately) {
      processingStatus = PROCESSING_STATUS.COMPLETED;
    } else if (processingResults.queued) {
      processingStatus = PROCESSING_STATUS.IN_QUEUE;
    } else if (!processingResults.processedImmediately && !processingResults.queued) {
      // File doesn't require processing - set to completed
      processingStatus = PROCESSING_STATUS.COMPLETED;
    }

    return {
      _id: fileId,
      type,
      mediaType: options.mediaType || 'file', // Store the user's explicit mediaType choice
      name: metadata.originalName,
      description: (options as any).description || '',
      fileName: filePaths.fileName,
      mimeType: metadata.mimeType,
      storageType: STORAGE_TYPES.DISK_STORAGE, // or 's3' based on storage configuration
      path: filePaths.mainFileKey,
      absolutePath: processingResults.finalPath || multerData.path,
      width: processingResults.width || metadata.width,
      height: processingResults.height || metadata.height,
      duration: processingResults.duration || metadata.duration,
      fileSize: processingResults.realFileSize || metadata.fileSize,
      originalFileSize: metadata.fileSize,
      status: options.fileId ? 'uploaded' : 'active', // TUS uploads are 'uploaded', regular uploads are 'active'
      encoding: multerData.encoding || 'binary',
      acl: options.acl || 'public-read',
      isProtected: filePaths.isProtected,
      thumbnails: processingResults.thumbnails || [],
      blurImagePath: processingResults.blurImagePath,
      metadata: {
        ...metadata.metadata,
        originalHash: metadata.originalHash,
        processedHash: processingResults.processedHash,
        exifData: metadata.exifData,
        processingOptions: this.sanitizeProcessingOptions(options),
        uploadMethod: 'normal', // or 'tus' for resumable uploads
        processingStatus
      },
      uploaderId: options.uploader?._id || options.uploader?.id,
      uploaderInfo: options.uploader ? {
        id: options.uploader._id || options.uploader.id,
        username: options.uploader.username,
        email: options.uploader.email
      } : null,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
     * Extract comprehensive metadata from uploaded file
     */
  async extractMetadata(
    multerData: IMulterUploadedFile,
    options: IFileUploadOptions
  ): Promise<{
    width?: number;
    height?: number;
    duration?: number;
    fileSize: number;
    realFileSize?: number;
    mimeType: string;
    originalName: string;
    extension: string;
    metadata: Record<string, any>;
    exifData?: Record<string, any>;
    originalHash?: string;
  }> {
    const bIsImage = isImage(multerData);
    const bIsVideo = isVideo(multerData);

    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;
    let exifData: Record<string, any> | undefined;
    let originalHash: string | undefined;

    // Extract image metadata
    if (bIsImage) {
      try {
        const imageMetadata = await this.imageService.getMetaData(multerData.path);
        width = imageMetadata.width;
        height = imageMetadata.height;

        // Extract EXIF data if available
        if (imageMetadata.exif) {
          exifData = this.sanitizeExifData(imageMetadata.exif);
        }
      } catch (error) {
        this.logger.warn(`Failed to extract image metadata: ${error.message}`);
      }
    }

    // Extract video metadata
    if (bIsVideo) {
      try {
        const videoMetadata = await this.videoService.getMetaData(multerData.path);
        width = videoMetadata.width;
        height = videoMetadata.height;
        duration = videoMetadata.duration;
      } catch (error) {
        this.logger.warn(`Failed to extract video metadata: ${error.message}`);
      }
    }

    // Generate original file hash if requested
    if (options.md5Hashing?.enabled && options.md5Hashing.hashOriginal) {
      try {
        if (bIsImage) {
          originalHash = await this.imageService.generateMD5Hash(multerData.path);
        } else if (bIsVideo) {
          originalHash = await this.videoService.generateMD5Hash(multerData.path);
        }
      } catch (error) {
        this.logger.warn(`Failed to generate MD5 hash: ${error.message}`);
      }
    }

    return {
      width,
      height,
      duration,
      fileSize: multerData.size,
      mimeType: multerData.mimetype,
      originalName: multerData.originalname,
      extension: extname(multerData.originalname).toLowerCase(),
      metadata: multerData.metadata || {},
      exifData,
      originalHash
    };
  }

  /**
   * Sanitize EXIF data to remove sensitive information
   */
  private sanitizeExifData(exifData: any): Record<string, any> {
    const sensitiveFields = [
      'gps',
      'GPS',
      'GPSLatitude',
      'GPSLongitude',
      'GPSLatitudeRef',
      'GPSLongitudeRef',
      'GPSAltitude',
      'GPSAltitudeRef',
      'GPSTimeStamp',
      'GPSDateStamp',
      'UserComment',
      'MakerNote'
    ];

    const sanitized = { ...exifData };

    // Remove sensitive fields
    sensitiveFields.forEach((field) => {
      delete sanitized[field];
    });

    // Keep only useful metadata
    const allowedFields = [
      'Make',
      'Model',
      'DateTime',
      'DateTimeOriginal',
      'DateTimeDigitized',
      'ExposureTime',
      'FNumber',
      'ISO',
      'FocalLength',
      'Flash',
      'WhiteBalance',
      'ColorSpace',
      'ExifImageWidth',
      'ExifImageHeight',
      'Orientation'
    ];

    const filtered: Record<string, any> = {};
    allowedFields.forEach((field) => {
      if (sanitized[field] !== undefined) {
        filtered[field] = sanitized[field];
      }
    });

    return filtered;
  }

  /**
   * Calculate aspect ratio
   */
  calculateAspectRatio(width?: number, height?: number): number | undefined {
    if (!width || !height) return undefined;
    return Math.round((width / height) * 100) / 100;
  }

  /**
   * Determine file category based on mime type and metadata
   */
  getFileCategory(mimeType: string, metadata: any): string {
    if (mimeType.startsWith('image/')) {
      // Determine image category based on dimensions or usage
      if (metadata.width && metadata.height) {
        const aspectRatio = this.calculateAspectRatio(metadata.width, metadata.height);
        if (aspectRatio && Math.abs(aspectRatio - 1) < 0.1) {
          return 'square-image'; // Nearly square images (avatars, thumbnails)
        }
        if (metadata.width > 1920 || metadata.height > 1080) {
          return 'high-res-image';
        }
      }
      return 'image';
    }

    if (mimeType.startsWith('video/')) {
      if (metadata.duration) {
        if (metadata.duration < 30) {
          return 'short-video'; // Clips, GIFs converted to video
        }
        if (metadata.duration > 3600) {
          return 'long-video'; // Movies, long content
        }
      }
      return 'video';
    }

    return 'file';
  }

  /**
   * Generate file tags based on metadata and content analysis
   */
  generateFileTags(metadata: any, options: IFileUploadOptions): string[] {
    const tags: string[] = [];

    // Add category tag
    const category = this.getFileCategory(metadata.mimeType, metadata);
    tags.push(category);

    // Add size-based tags
    if (metadata.fileSize > 100 * 1024 * 1024) {
      tags.push('large-file');
    } else if (metadata.fileSize < 1024 * 1024) {
      tags.push('small-file');
    }

    // Add resolution-based tags for images/videos
    if (metadata.width && metadata.height) {
      if (metadata.width >= 3840 || metadata.height >= 2160) {
        tags.push('4k');
      } else if (metadata.width >= 1920 || metadata.height >= 1080) {
        tags.push('hd');
      }
    }

    // Add processing-based tags
    if (options.thumbnails?.enabled) {
      tags.push('has-thumbnails');
    }
    if (options.md5Hashing?.enabled) {
      tags.push('verified');
    }
    if (options.replaceOriginal) {
      tags.push('optimized');
    }

    return tags;
  }

  /**
   * Sanitize processing options for storage (remove sensitive data)
   */
  private sanitizeProcessingOptions(options: IFileUploadOptions): Record<string, any> {
    const sanitized = { ...options };

    // Remove sensitive or unnecessary fields
    delete sanitized.uploader;

    return sanitized;
  }
}