import { BadRequestException, Injectable } from "@nestjs/common";
import { extname } from "path";
import { IFileUploadOptions } from "src/common/lib/file";
import { IMulterUploadedFile } from "src/common/lib/file/multer/multer.utils";
import { AppConfigService } from "src/config";
import { imageExtensions, isImage, isVideo, videoExtensions } from "src/lib/file-type";

/**
 * File Validation Service
 *
 * Handles all file validation logic including size limits, format validation,
 * security checks, and upload option validation.
 *
 * This service ensures that only valid, safe files are processed by the system.
 */
@Injectable()
export class FileValidationService {
  constructor(
    private readonly configService: AppConfigService
  ) { }

  /**
   * Check if file requires processing based on type and options
   */
  requiresProcessing(multerData: IMulterUploadedFile, options: IFileUploadOptions): boolean {
    const bIsImage = isImage(multerData);
    const bIsVideo = isVideo(multerData);
    const fileType = this.getFileType(multerData);
    // If manual processing is requested, don't process automatically
    if (options.processingOptions?.processManual === true) {
      return false;
    }

    // Generic files (upload-only) don't require processing
    if (fileType === 'file' || options.mediaType === 'file') {
      return false;
    }

    // Image processing requirements
    if (bIsImage) {
      return !!(
        options.thumbnails?.enabled
        || options.replaceOriginal
        || options.md5Hashing?.enabled
      );
    }

    // Videos always go through processing so we can normalize playback behavior.
    // The processing step itself decides whether MP4 conversion is needed based on HTML5 support.
    if (bIsVideo) {
      return true;
    }

    return !!(options.md5Hashing?.enabled);
  }

  /**
    * Validate uploaded file against system constraints
    */
  validateFile(multerData: IMulterUploadedFile, options: IFileUploadOptions): void {
    this.validateFileSize(multerData);
    this.validateFileType(multerData);
    this.validateFileName(multerData);
    this.validateUploadOptions(options, multerData);
  }

  /**
   * Validate file size against configured limits
   */
  private validateFileSize(multerData: IMulterUploadedFile): void {
    const fileConfig = this.configService.file;
    const maxSize = fileConfig.maxFileSize || 100 * 1024 * 1024; // 100MB default

    // Type-specific size limits
    if (multerData.mimetype.startsWith('image/')) {
      const imageConfig = this.configService.image;
      const maxImageSize = imageConfig.maxFileSize || 20 * 1024 * 1024; // 20MB default

      if (multerData.size > maxImageSize) {
        throw new BadRequestException(
          `Image size ${this.formatFileSize(multerData.size)} exceeds maximum allowed size of ${this.formatFileSize(maxImageSize)}`
        );
      }
    }

    if (multerData.mimetype.startsWith('video/')) {
      const videoConfig = this.configService.video;
      const maxVideoSize = videoConfig.maxFileSize || 500 * 1024 * 1024; // 500MB default

      if (multerData.size > maxVideoSize) {
        throw new BadRequestException(
          `Video size ${this.formatFileSize(multerData.size)} exceeds maximum allowed size of ${this.formatFileSize(maxVideoSize)}`
        );
      }
    }

    if (multerData.mimetype.startsWith('audio/')) {
      const fileConfig = this.configService.file;
      const maxAudioSize = fileConfig.limits?.audio || 200 * 1024 * 1024; // 200MB default

      if (multerData.size > maxAudioSize) {
        throw new BadRequestException(
          `Audio size ${this.formatFileSize(multerData.size)} exceeds maximum allowed size of ${this.formatFileSize(maxAudioSize)}`
        );
      }
    }

    if (multerData.size > maxSize) {
      throw new BadRequestException(
        `File size ${this.formatFileSize(multerData.size)} exceeds maximum allowed size of ${this.formatFileSize(maxSize)}`
      );
    }
  }

  /**
   * Validate file type against allowed formats
   */
  private validateFileType(multerData: IMulterUploadedFile): void {
    const allowedImageTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      'image/heic',
      'image/heif'
    ];

    const allowedVideoTypes = [
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo', // .avi
      'video/x-ms-wmv', // .wmv
      'video/webm',
      'video/hevc'
    ];

    const allowedDocumentTypes = [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    const allowedAudioTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/mp4',
      'audio/x-m4a',
      'audio/wav',
      'audio/ogg',
      'audio/webm',
      'audio/aac',
      'audio/flac',
      'audio/x-aiff',
      'audio/x-ms-wma'
    ];

    const allAllowedTypes = [
      ...allowedImageTypes,
      ...allowedVideoTypes,
      ...allowedDocumentTypes,
      ...allowedAudioTypes
    ];

    if (!allAllowedTypes.includes(multerData.mimetype)) {
      const fileExtension = extname(multerData.originalname).toLowerCase();
      const allowedExtensions = [
        ...imageExtensions,
        ...videoExtensions
      ];

      if (allowedExtensions.includes(fileExtension)) {
        // Allow file if extension is valid, even if MIME type doesn't match
        // This handles cases where MIME type detection fails or is inconsistent
        return;
      }

      throw new BadRequestException(
        `File type '${multerData.mimetype}' with extension '${fileExtension}' is not supported. `
        + `Allowed extensions: ${allowedExtensions.join(', ')}`
      );
    }
  }

  /**
   * Validate file name for security and compatibility
   */
  private validateFileName(multerData: IMulterUploadedFile): void {
    const fileName = multerData.originalname;

    // Check for dangerous characters
    // eslint-disable-next-line no-control-regex
    const dangerousChars = /[<>:"/\\|?*\0-\x1f]/;
    if (dangerousChars.test(fileName)) {
      throw new BadRequestException(
        'File name contains invalid characters. Please use only letters, numbers, spaces, hyphens, and underscores.'
      );
    }

    // Check file name length
    if (fileName.length > 255) {
      throw new BadRequestException(
        'File name is too long. Maximum length is 255 characters.'
      );
    }

    // Check for reserved names (Windows)
    const reservedNames = [
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ];

    const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '').toUpperCase();
    if (reservedNames.includes(nameWithoutExt)) {
      throw new BadRequestException(
        `File name '${fileName}' is reserved and cannot be used.`
      );
    }
  }

  /**
   * Validate upload options for consistency and compatibility
   */
  private validateUploadOptions(options: IFileUploadOptions, multerData: IMulterUploadedFile): void {
    const bIsImage = isImage(multerData);
    const bIsVideo = isVideo(multerData);

    // Validate thumbnail options for non-image, non-video files
    if (options.thumbnails?.enabled && !bIsImage && !bIsVideo) {
      throw new BadRequestException(
        'Thumbnail generation is only supported for image and video files.'
      );
    }

    // Validate video processing options for non-video files
    if (options.videoProcessing && !bIsVideo) {
      throw new BadRequestException(
        'Video processing options can only be used with video files.'
      );
    }

    // Validate replace original option
    if (options.replaceOriginal && !bIsImage) {
      throw new BadRequestException(
        'Replace original option is only supported for image files.'
      );
    }

    // Validate thumbnail sizes
    if (options.thumbnails?.sizes) {
      const sizes = Array.isArray(options.thumbnails.sizes)
        ? options.thumbnails.sizes
        : [options.thumbnails.sizes];

      sizes.forEach((size) => {
        if (size.width && (size.width < 1 || size.width > 4000)) {
          throw new BadRequestException(
            `Thumbnail width ${size.width} is invalid. Must be between 1 and 4000 pixels.`
          );
        }
        if (size.height && (size.height < 1 || size.height > 4000)) {
          throw new BadRequestException(
            `Thumbnail height ${size.height} is invalid. Must be between 1 and 4000 pixels.`
          );
        }
      });
    }

    // Validate video resolution limits
    if (options.videoProcessing?.maxResolution) {
      const maxRes = options.videoProcessing.maxResolution;
      if (maxRes.width < 1 || maxRes.width > 7680 || maxRes.height < 1 || maxRes.height > 4320) {
        throw new BadRequestException(
          'Video resolution limits must be between 1x1 and 7680x4320 (8K).'
        );
      }
    }
  }

  /**
  * Format file size for human-readable display
  */
  private formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${Math.round((bytes / 1024 ** i) * 100) / 100} ${sizes[i]}`;
  }

  /**
   * Get file type category
   */
  getFileType(multerData: IMulterUploadedFile): 'image' | 'video' | 'file' {
    if (multerData.mimetype.startsWith('image/')) {
      return 'image';
    }
    if (multerData.mimetype.startsWith('video/')) {
      return 'video';
    }

    return 'file';
  }

}
