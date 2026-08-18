import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * File processing options for resize and conversion
 */
export class FileProcessingOptionsDto {
  @IsOptional()
  @IsBoolean()
  generateThumbnail?: boolean = true;

  @IsOptional()
  @IsBoolean()
  generateBlurImage?: boolean = true;

  @IsOptional()
  @IsBoolean()
  immediateProcess?: boolean = false;

  @IsOptional()
  @IsBoolean()
  processManual?: boolean = false;

  @IsOptional()
  @IsString()
  @IsIn(['mp4', 'webm', 'avi'])
  videoFormat?: 'mp4' | 'webm' | 'avi' = 'mp4';

  @IsOptional()
  @IsString()
  @IsIn(['webp', 'jpeg', 'png'])
  imageFormat?: 'webp' | 'jpeg' | 'png' = 'webp';

  @IsOptional()
  @IsString()
  @IsIn(['mp3', 'wav', 'ogg', 'm4a', 'aac'])
  audioFormat?: 'mp3' | 'wav' | 'ogg' | 'm4a' | 'aac' = 'mp3';

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(4096)
  resizeWidth?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(4096)
  resizeHeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  quality?: number = 80;

  @IsOptional()
  @IsString()
  webhookUrl?: string;
}

/**
 * Request DTO for generating signed upload URLs
 */
export class SignedUploadRequestDto {
  @IsString()
  @IsIn(['image', 'video', 'document', 'audio', 'file'])
  mediaType: 'image' | 'video' | 'document' | 'audio' | 'file';

  @IsString()
  type: string;

  @IsString()
  filename: string;

  @IsString()
  @IsIn(['public-read', 'private', 'authenticated-read'])
  acl: 'public-read' | 'private' | 'authenticated-read' = 'private';

  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FileProcessingOptionsDto)
  processingOptions?: FileProcessingOptionsDto;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsString()
  updatedBy?: string;
}

/**
 * Response DTO for file information
 */
export class FileInfoResponseDto {
  _id: string;

  type: string;

  name: string;

  mimeType: string;

  size: number;

  width?: number;

  height?: number;

  duration?: number;

  status: string;

  processingStatus?: string;

  url?: string;

  thumbnails?: string[];

  blurImage?: string; // blur image URL

  metadata?: Record<string, any>;

  refItems?: Array<{
    itemId: any;
    itemType: string;
  }>;

  createdAt: Date;

  updatedAt: Date;

  createdBy?: string;

  updatedBy?: string;
}

/**
 * Public file upload response DTO
 * Contains only safe, public information about uploaded files
 */
export class PublicFileUploadResponseDto {
  /** File unique identifier */
  fileId: string;

  /** Original filename */
  filename: string;

  /** File MIME type */
  mimeType: string;

  /** File size in bytes */
  size: number;

  /** File type category (image, video, document, etc.) */
  type: string;

  /** Upload status */
  status: string;

  /** Image dimensions (if applicable) */
  width?: number;

  height?: number;

  /** Video duration in seconds (if applicable) */
  duration?: number;

  /** Public access URL (if file is public) */
  url?: string;

  /** Thumbnail URLs (if generated) */
  thumbnails?: string[];

  /** Blur image URL (if generated) */
  blurImage?: string;

  /** Upload timestamp */
  uploadedAt: Date;

  /**
   * Create public response from FileDto
   */
  static fromFileDto(fileDto: any): PublicFileUploadResponseDto {
    return {
      fileId: fileDto._id,
      filename: fileDto.name,
      mimeType: fileDto.mimeType,
      size: fileDto.fileSize,
      type: fileDto.type,
      status: fileDto.status,
      width: fileDto.width,
      height: fileDto.height,
      duration: fileDto.duration,
      url: fileDto.url,
      thumbnails: fileDto.thumbnails,
      blurImage: fileDto.blurImagePath,
      uploadedAt: fileDto.createdAt
    };
  }
}
