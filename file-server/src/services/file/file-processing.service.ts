import { Injectable } from "@nestjs/common";
import { existsSync } from "fs";
import { basename, dirname, extname, join, resolve } from "path";
import { IFileUploadOptions } from "src/common/lib/file";
import { AppConfigService } from "src/config";
import { FileDto } from "src/dtos/file.dto";
import { fromPosixPath, getFileName } from "src/kernel/helpers/string.helper";
import { ImageService } from "src/services/file/image.service";
import { StorageService } from "src/services/file/storage.service";
import { FileVideoService } from "src/services/file/video.service";

/**
 * File Processing Service
 *
 * Handles the core file processing logic including thumbnail generation,
 * video conversion, MD5 hashing, and file optimization.
 *
 * This service is extracted from the main FileService to improve maintainability
 * and separation of concerns.
 */
@Injectable()
export class FileProcessingService {
  constructor(
    private readonly configService: AppConfigService,
    private readonly imageService: ImageService,
    private readonly videoService: FileVideoService,
    private readonly storageService: StorageService
  ) { }

  /**
   * Process image for queue-based processing
   *
   * Centralized image processing logic extracted from FileService._processPhoto
   * Handles thumbnail creation, blur image creation, EXIF removal, and file uploads
   *
   * @param photoPath - Path to the image file to process
   * @param fileData - File data object containing metadata and file information
   * @param options - Processing options from queue event
   * @returns Promise resolving to processing results
   */
  async processPhoto(
    photoPath: string,
    fileData: FileDto,
    options: Record<string, any> = {}
  ): Promise<{
    thumbnails: any[];
    blurImagePath: string | null;
    uploaded: any;
    imageMeta: any;
    mimeType: string;
    metadata: Record<string, any>;
    processedHash?: string;
  }> {
    // TODO - should check from photo dir
    const { publicDir } = this.configService.file;
    let actualPhotoPath = photoPath;
    // Resolve the actual file path using platform-specific paths
    const platformAbsolutePath = fromPosixPath(fileData.absolutePath);
    const platformRelativePath = fromPosixPath(fileData.path);

    if (existsSync(platformAbsolutePath)) {
      actualPhotoPath = platformAbsolutePath;
      // Use dir of the original file
    } else if (existsSync(join(publicDir, platformRelativePath))) {
      actualPhotoPath = join(publicDir, platformRelativePath);
    } else if (existsSync(fromPosixPath(photoPath))) {
      actualPhotoPath = fromPosixPath(photoPath);
    }

    // Create thumbnail
    const thumbBuffer = await this.imageService.generateImageThumbnail(
      actualPhotoPath,
      options.thumbnailSize || {
        width: 250,
        height: null
      }
    ) as Buffer;

    // Get thumbnail metadata
    const thumbnailMeta = await this.imageService.getMetaData(thumbBuffer);

    // Create thumbnail filename and key
    const thumbName = `thumb-${new Date().getTime()}.webp`;
    const thumbnailKey = `/photos/${fileData._id}/thumbnails/${thumbName}`;

    // Upload thumbnail to storage
    const uploadedThumbnail = await this.storageService.uploadFileToStorage({
      body: thumbBuffer,
      acl: 'public-read',
      key: thumbnailKey,
      rename: true,
      contentType: 'image/webp',
      deleteOriginalFile: true
    });

    // Create blur image
    const blurBuffer = await this.imageService.blur(thumbBuffer as Buffer);
    const blurName = `blur-${new Date().getTime()}.webp`;
    const blurKey = `/photos/${fileData._id}/${blurName}`; // TODO - check me

    // Upload blur image to storage
    const uploadedBlur = await this.storageService.uploadFileToStorage({
      body: blurBuffer,
      acl: 'public-read',
      key: blurKey,
      rename: true,
      contentType: 'image/webp',
      deleteOriginalFile: true
    });

    // Process original image (remove EXIF)
    const buffer = await this.imageService.replaceWithoutExif(actualPhotoPath, fileData.mimeType);
    const imageMeta = await this.imageService.getMetaData(buffer);

    // Derive verified MIME type from the actual output format (EXIF removal may change format)
    const actualMimeType = `image/${imageMeta.format}`;

    // Upload processed original image
    const mainFileKey = fileData.path;
    const uploaded = await this.storageService.uploadFileToStorage({
      body: buffer,
      acl: fileData.acl,
      key: mainFileKey,
      rename: true,
      contentType: actualMimeType,
      deleteOriginalFile: true
    });

    // Log a warning if the verified mime type differs from the original
    // if (actualMimeType !== fileData.mimeType) {
    //   // eslint-disable-next-line no-console
    //   console.warn(`[FileProcessingService] mimeType changed after photo processing: ${fileData.mimeType} → ${actualMimeType} (file: ${fileData._id})`);
    // }

    // Preserve original file data in metadata before overwriting
    const metadata = {
      ...(fileData.metadata || {}),
      original: {
        mimeType: fileData.mimeType,
        path: fileData.path,
        absolutePath: fileData.absolutePath,
        size: fileData.fileSize
      },
      ...(uploaded.metadata || {})
    };

    // Generate MD5 hash if requested
    let processedHash: string | undefined;
    if (options.md5Hashing?.enabled && options.md5Hashing.hashProcessed) {
      processedHash = await this.imageService.generateMD5Hash(actualPhotoPath);
    }

    return {
      thumbnails: [
        {
          path: uploadedThumbnail.path,
          absolutePath: uploadedThumbnail.absolutePath,
          width: thumbnailMeta.width,
          height: thumbnailMeta.height
        }
      ],
      blurImagePath: uploadedBlur.path,
      uploaded,
      imageMeta,
      mimeType: actualMimeType,
      metadata,
      processedHash
    };
  }

  /**
   * Get processing priority based on file type and options
   *
   * For videos, the immediateProcess flag determines priority:
   * - immediateProcess: true → HIGH priority (process immediately in queue)
   * - immediateProcess: false → NORMAL priority (process when resources available)
   */
  getProcessingPriority(
    fileType: 'image' | 'video' | 'file',
    options: IFileUploadOptions,
    processingOptions?: any
  ): number {
    const processingConfig = this.configService.processing;

    // Use explicit priority if provided
    if (options.queueOptions?.priority) {
      return typeof options.queueOptions.priority === 'string'
        ? processingConfig?.priorities?.[options.queueOptions.priority] || processingConfig?.priorities?.normal || 1
        : options.queueOptions.priority;
    }

    // For videos, check immediateProcess flag to determine priority
    if (fileType === 'video') {
      // If immediateProcess is true, use HIGH priority for immediate queue processing
      if (processingOptions?.immediateProcess === true) {
        return processingConfig?.priorities?.avatarResize || 2; // HIGH priority
      }

      // Otherwise, determine priority based on processing complexity
      return options.videoProcessing?.multiResolution
        ? processingConfig?.priorities?.videoMultiRes || 3
        : processingConfig?.priorities?.videoConvert || 4;
    }

    // Auto-determine priority based on file type and processing for non-videos
    if (fileType === 'image') {
      return options.replaceOriginal
        ? processingConfig?.priorities?.avatarResize || 2
        : processingConfig?.priorities?.photoThumbnail || 5;
    }

    return processingConfig?.priorities?.normal || 1;
  }

  /**
     * Determine if file should be processed immediately or queued
     *
     * Note: Videos are ALWAYS queued (never processed immediately) regardless of settings.
     * Only images/photos can be processed immediately based on immediateProcess flag.
     */
  shouldProcessImmediately(
    fileSize: number,
    options: IFileUploadOptions,
    fileType?: 'image' | 'video' | 'document' | 'audio' | 'file',
    processingOptions?: any
  ): boolean {
    if (fileType === 'video') {
      return false;
    }

    // Documents and audio are stored as-is (no thumbnail/conversion)
    if (fileType === 'document') {
      return false;
    }

    // Audio files are stored as-is (no thumbnail/conversion)
    if (fileType === 'audio') {
      return false;
    }

    if (fileType === 'file') {
      return false;
    }

    // If manual processing is requested, don't process automatically
    if (processingOptions?.processManual === true) {
      return false;
    }

    // For images/photos, check immediateProcess flag from processingOptions
    if (processingOptions?.immediateProcess === true) {
      return true;
    }

    if (processingOptions?.immediateProcess === false) {
      return false;
    }

    // Special handling for photos - if immediateProcess is not provided, default to immediate for photos
    if (fileType === 'image' && processingOptions?.immediateProcess === undefined) {
      // For photos specifically, default to immediate processing if not specified
      return true;
    }

    // Auto-determine based on file size and processing complexity for images
    const processingConfig = this.configService.processing;
    const threshold = processingConfig?.backgroundProcessing?.fileSizeThreshold || 50 * 1024 * 1024; // 50MB

    // Large files should be processed in background
    if (fileSize > threshold) {
      return false;
    }

    // Complex processing should be done in background
    const hasComplexProcessing = (options.thumbnails?.sizes && Array.isArray(options.thumbnails.sizes) && options.thumbnails.sizes.length > 2);

    if (hasComplexProcessing) {
      return false;
    }

    // Default to background processing (immediateProcess should be false by default)
    return false;
  }

  /**
   * Calculate real file size after processing
   */
  async calculateRealFileSize(filePath: string): Promise<number> {
    const fs = await import('fs');
    // Convert POSIX path to platform-specific path before file operations
    const platformFilePath = fromPosixPath(filePath);
    const stats = fs.statSync(platformFilePath);
    return stats.size;
  }

  /**
   * Process video for queue-based processing
   *
   * Centralized video processing logic extracted from FileService._processVideo
   * Handles video conversion, thumbnail generation, blur image creation, and file uploads
   *
   * @param videoPath - Path to the video file to process
   * @param fileData - File data object containing metadata and file information
   * @param options - Processing options from queue event
   * @returns Promise resolving to processing results
   */
  async processVideo(
    videoPath: string,
    fileData: FileDto,
    options: Record<string, any> = {}
  ): Promise<{
    thumbnails: any[];
    blurImagePath: string | null;
    metadata: Record<string, any>;
    uploaded: any;
    mimeType: string;
    width: number | null;
    height: number | null;
    duration: number;
    deleteOriginalFile: boolean;
    originalFileAbsolutePath?: string; // path of the original source file to delete after conversion
    processedHash?: string;
  }> {
    let blurImagePath: string | null = null;
    let { mimeType } = fileData;
    let { metadata = {} } = fileData;

    // Preserve original file data in metadata before any conversion
    metadata = {
      ...metadata,
      original: {
        mimeType: fileData.mimeType,
        path: fileData.path,
        absolutePath: fileData.absolutePath,
        size: fileData.fileSize
      }
    };
    const { videoDir } = this.configService.file;
    let defaultVideoDir = options?.toDir || videoDir;
    // Convert POSIX path to platform-specific path before file operations
    const platformAbsolutePath = fromPosixPath(fileData.absolutePath);
    if (existsSync(platformAbsolutePath)) {
      // Use dir of the original file
      defaultVideoDir = dirname(platformAbsolutePath);
    }

    // Convert to mp4 if it is not support html5
    const isSupportHtml5 = await this.videoService.isSupportHtml5(videoPath);
    let deleteOriginalFile = false;
    let respVideo = {
      toPath: videoPath,
      fileName: getFileName(videoPath, false)
    };

    if (!isSupportHtml5) {
      deleteOriginalFile = true;
      respVideo = await this.videoService.convert2Mp4(videoPath);
    }

    // A conversion creates a distinct browser-compatible output. Compare the
    // actual source and output paths because direct uploads use the source path
    // as fileData.absolutePath too.
    const sourceVideoPath = resolve(fromPosixPath(videoPath));
    const convertedVideoPath = resolve(fromPosixPath(respVideo.toPath));
    const originalFileAbsolutePath = !isSupportHtml5 && sourceVideoPath !== convertedVideoPath
      ? sourceVideoPath
      : undefined;

    const meta = await this.videoService.getMetaData(respVideo.toPath);
    const videoMeta = meta.streams.find((s: any) => s.codec_type === 'video');
    const { width = null, height = null } = videoMeta || {};

    const thumbnailCount = typeof options?.count === 'number'
      ? Math.max(options.count, 0)
      : 0;
    const respThumb = thumbnailCount > 0
      ? await this.videoService.createThumbs(respVideo.toPath, {
        toFolder: defaultVideoDir,
        size: options?.size || null,
        count: thumbnailCount
      })
      : [];

    const thumbnails: any = [];

    // Original file - videos will be saved in the same path of original, since we set policy from multer
    const mainFileKey = `${dirname(fileData.path)}/${basename(respVideo.toPath)}`;

    // Determine actual MIME type from the converted/processed file path
    const actualMimeType = this.getVideoMimeType(respVideo.toPath, fileData.mimeType);

    const targetVideoPath = resolve(fromPosixPath(join(this.configService.file.publicDir, mainFileKey)));
    const processedVideoPath = convertedVideoPath;

    // Skip the re-upload when the processed file is already sitting at the final storage path.
    const uploaded = processedVideoPath === targetVideoPath
      ? {
        path: mainFileKey,
        absolutePath: targetVideoPath,
        acl: fileData.acl,
        key: mainFileKey,
        storageType: fileData.storageType,
        metadata: {}
      }
      : await this.storageService.uploadFileToStorage({
        fromFile: respVideo.toPath,
        acl: fileData.acl,
        key: mainFileKey,
        rename: true,
        contentType: actualMimeType
      });

    // Use verified mime type from the actual converted file
    mimeType = actualMimeType;

    if (respThumb.length) {
      await respThumb.reduce(async (cb, name) => {
        await cb;
        // From main key, ignore protected folder if any, set thumbnail as public?
        const key = `/videos/${fileData._id}/thumbnails/${name}`;
        const uploadedThumb = await this.storageService.uploadFileToStorage({
          fromFile: join(defaultVideoDir, name), // Generate thumbnail to the same folder of original
          key,
          acl: 'public-read', // By default it is public-read, thumbnails are always public
          contentType: 'image/webp',
          rename: true,
          deleteOriginalFile: true
        });
        const thumbnailMeta = await this.imageService.getMetaData(uploadedThumb.absolutePath);
        thumbnails.push({
          path: uploadedThumb.path,
          absolutePath: uploadedThumb.absolutePath,
          width: thumbnailMeta.width,
          height: thumbnailMeta.height
        });
        return Promise.resolve();
      }, Promise.resolve());

      // Generate blur image
      const blurBuffer = await this.imageService.blur(thumbnails[0].absolutePath);
      const uploadedBlur = await this.storageService.uploadFileToStorage({
        body: blurBuffer,
        key: `/videos/${fileData._id}/blur.webp`,
        acl: 'public-read',
        contentType: 'image/webp',
        rename: true,
        deleteOriginalFile: true
      });
      blurImagePath = uploadedBlur.path;
    }

    metadata = {
      ...metadata,
      ...(uploaded.metadata || {})
    };

    // Log a warning if the verified mime type differs from the original
    // if (mimeType !== fileData.mimeType) {
    //   // eslint-disable-next-line no-console
    //   console.warn(`[FileProcessingService] mimeType changed after video processing: ${fileData.mimeType} → ${mimeType} (file: ${fileData._id})`);
    // }

    if (uploaded.storageType !== 'diskStorage') deleteOriginalFile = true;

    // Generate processedHash if needed
    const shouldGenerateProcessedHash = options.generateProcessedHash
      || (options.md5Hashing?.enabled && options.md5Hashing.hashProcessed)
      || (options.meta?.originalOptions?.md5Hashing?.enabled && options.meta.originalOptions.md5Hashing.hashProcessed);

    let processedHash: string | undefined;
    if (shouldGenerateProcessedHash) {
      processedHash = await this.videoService.generateMD5Hash?.(respVideo.toPath);
    }

    return {
      thumbnails,
      blurImagePath,
      metadata,
      uploaded,
      mimeType,
      width,
      height,
      duration: parseInt(meta.format.duration, 10),
      deleteOriginalFile,
      originalFileAbsolutePath,
      processedHash
    };
  }

  /**
   * Determine the MIME type for a video file based on its file extension.
   * Falls back to the provided fallback if the extension is not recognized.
   */
  private getVideoMimeType(filePath: string, fallback: string = 'video/mp4'): string {
    const ext = extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogg': 'video/ogg',
      '.ogv': 'video/ogg',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      '.flv': 'video/x-flv',
      '.wmv': 'video/x-ms-wmv',
      '.m4v': 'video/mp4',
      '.3gp': 'video/3gpp',
      '.hevc': 'video/hevc'
    };
    return mimeMap[ext] || fallback;
  }
}
