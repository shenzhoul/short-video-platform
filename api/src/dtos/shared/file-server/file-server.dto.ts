import { Expose, plainToInstance } from 'class-transformer';
import { FileInfo, PublicFileInfo, ThumbnailValue } from 'src/services/shared/file-server/interfaces/file-server.interface';

/**
 * File Server DTO for internal file information
 *
 * This DTO represents file information from the file server with all internal details.
 * Used for admin operations and internal processing.
 */
export class FileServerInfoDto {
  @Expose()
  _id: string;

  @Expose()
  type: string;

  @Expose()
  name: string;

  @Expose()
  originalName?: string;

  @Expose()
  fileExtension?: string;

  @Expose()
  mimeType: string;

  @Expose()
  size: number;

  @Expose()
  originalFileSize?: number;

  @Expose()
  width?: number;

  @Expose()
  height?: number;

  @Expose()
  duration?: number;

  @Expose()
  status: string;

  @Expose()
  processingStatus?: string;

  @Expose()
  storageType?: string;

  @Expose()
  path?: string;

  @Expose()
  absolutePath?: string;

  @Expose()
  acl?: string;

  @Expose()
  isProtected?: boolean;

  @Expose()
  uploadType?: string;

  @Expose()
  url?: string;

  @Expose()
  thumbnails?: ThumbnailValue[];

  @Expose()
  blurImage?: string;

  @Expose()
  processingError?: string;

  @Expose()
  createdAt: string;

  @Expose()
  updatedAt: string;

  @Expose()
  uploadedAt?: string;

  @Expose()
  processedAt?: string;

  @Expose()
  metadata?: Record<string, any>;

  @Expose()
  refItems: Array<{
    itemType: string;
    itemId: string;
  }>;

  @Expose()
  createdBy?: string;

  @Expose()
  updatedBy?: string;

  /**
   * Create DTO from FileInfo interface
   * @param fileInfo - FileInfo object from file server
   * @returns FileServerInfoDto instance
   */
  public static fromFileInfo(fileInfo: FileInfo): FileServerInfoDto {
    if (!fileInfo) return null;
    return plainToInstance(FileServerInfoDto, fileInfo, { excludeExtraneousValues: true });
  }

  /**
   * Create DTO from array of FileInfo objects
   * @param fileInfos - Array of FileInfo objects
   * @returns Array of FileServerInfoDto instances
   */
  public static fromFileInfoArray(fileInfos: FileInfo[]): FileServerInfoDto[] {
    if (!fileInfos || !Array.isArray(fileInfos)) return [];
    return fileInfos.map((info) => FileServerInfoDto.fromFileInfo(info)).filter(Boolean);
  }

  /**
   * Convert to public response format
   * @param options - Options for public response
   * @returns Public file information
   */
  public toPublicResponse(options?: {
    showThumbnails?: boolean;
    showBlurImage?: boolean;
  }): any {
    const {
      showThumbnails = true,
      showBlurImage = true
    } = options || {};

    return {
      _id: this._id,
      type: this.type,
      name: this.name,
      mimeType: this.mimeType,
      size: this.size,
      width: this.width,
      height: this.height,
      duration: this.duration,
      status: this.status,
      processingStatus: this.processingStatus,
      url: this.url,
      thumbnails: showThumbnails ? this.getThumbnailUrls() : [],
      blurImage: showBlurImage ? this.blurImage : undefined,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * Convert to response format with all data (for admin use)
   * @returns Complete file information
   */
  public toResponse(): any {
    return {
      _id: this._id,
      type: this.type,
      name: this.name,
      originalName: this.originalName,
      fileExtension: this.fileExtension,
      mimeType: this.mimeType,
      size: this.size,
      originalFileSize: this.originalFileSize,
      width: this.width,
      height: this.height,
      duration: this.duration,
      status: this.status,
      processingStatus: this.processingStatus,
      storageType: this.storageType,
      acl: this.acl,
      isProtected: this.isProtected,
      uploadType: this.uploadType,
      url: this.url,
      thumbnails: this.thumbnails,
      blurImage: this.blurImage,
      processingError: this.processingError,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      uploadedAt: this.uploadedAt,
      processedAt: this.processedAt,
      metadata: this.metadata,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy
    };
  }

  /**
   * Check if file is an image
   * @returns True if file is an image
   */
  public isImage(): boolean {
    return (this.mimeType || '').toLowerCase().includes('image'); // TODO - check other formats like heic
  }

  public isPhoto(): boolean {
    return this.isImage();
  }

  /**
   * Check if file is a video
   * @returns True if file is a video
   */
  public isVideo(): boolean {
    return (this.mimeType || '').toLowerCase().includes('video'); // TODO - check other formats like heic
  }

  /**
   * Check if file processing is complete
   * @returns True if processing is complete
   */
  public isProcessingComplete(): boolean {
    return this.status === 'completed';
  }

  /**
   * Check if file processing failed
   * @returns True if processing failed
   */
  public isProcessingFailed(): boolean {
    return this.status === 'failed';
  }

  public getBlurImage(): string {
    if (!this.blurImage) return null;
    return this.blurImage; // Already a URL from file server
  }

  /**
   * Get file URL
   * @param secure - Whether to return secure URL (unused for compatibility)
   * @returns File URL
   */
  public async getUrl(_secure?: boolean): Promise<string> {
    return this.url || null;
  }

  public getThumbnails(): ThumbnailValue[] {
    return this.thumbnails || [];
  }

  public static normalizeThumbnailUrls(thumbnails?: ThumbnailValue[]): string[] {
    return (thumbnails || [])
      .map(thumbnail => typeof thumbnail === 'string'
        ? thumbnail
        : thumbnail.url || thumbnail.path)
      .filter((url): url is string => Boolean(url));
  }

  public getThumbnailUrls(): string[] {
    return FileServerInfoDto.normalizeThumbnailUrls(this.thumbnails);
  }
}

/**
 * Public File Server DTO for limited file information
 *
 * This DTO represents public file information with limited data exposure.
 * Used for public API responses and client-side operations.
 */
export class PublicFileServerInfoDto {
  @Expose()
  _id: string;

  @Expose()
  type: string;

  @Expose()
  name: string;

  @Expose()
  mimeType: string;

  @Expose()
  width?: number;

  @Expose()
  height?: number;

  @Expose()
  status: string;

  @Expose()
  processingStatus: string;

  @Expose()
  thumbnails?: ThumbnailValue[];

  @Expose()
  blurImage?: string;

  /**
   * Create DTO from PublicFileInfo interface
   * @param publicFileInfo - PublicFileInfo object from file server
   * @returns PublicFileServerInfoDto instance
   */
  public static fromPublicFileInfo(publicFileInfo: PublicFileInfo): PublicFileServerInfoDto {
    if (!publicFileInfo) return null;
    return plainToInstance(PublicFileServerInfoDto, publicFileInfo, { excludeExtraneousValues: true });
  }

  /**
   * Create DTO from FileInfo interface (converts to public format)
   * @param fileInfo - FileInfo object from file server
   * @returns PublicFileServerInfoDto instance
   */
  public static fromFileInfo(fileInfo: FileInfo): PublicFileServerInfoDto {
    if (!fileInfo) return null;

    const publicInfo: PublicFileInfo = {
      _id: fileInfo._id,
      type: fileInfo.type,
      name: fileInfo.name,
      mimeType: fileInfo.mimeType,
      width: fileInfo.width,
      height: fileInfo.height,
      status: fileInfo.status,
      processingStatus: fileInfo.processingStatus,
      thumbnails: fileInfo.thumbnails,
      blurImage: fileInfo.blurImage
    };

    return plainToInstance(PublicFileServerInfoDto, publicInfo, { excludeExtraneousValues: true });
  }

  /**
   * Convert to response format
   * @returns Public file information
   */
  public toResponse(): any {
    return {
      _id: this._id,
      type: this.type,
      name: this.name,
      mimeType: this.mimeType,
      width: this.width,
      height: this.height,
      status: this.status,
      processingStatus: this.processingStatus,
      thumbnails: this.thumbnails,
      blurImage: this.blurImage
    };
  }
}
