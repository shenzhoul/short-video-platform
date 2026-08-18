/**
 * File Server Integration Interfaces
 *
 * This file contains all TypeScript interfaces and types used for integrating
 * with the Douyin-Clone File Server API. These interfaces ensure type safety and
 * provide clear contracts for all file server operations.
 *
 * @author ShenZhoul
 * @version 1.0.0
 */

import { ObjectId } from 'mongodb';

/**
 * Media types supported by the file server
 */
export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'photo' | 'file';

/**
 * Upload methods supported by the file server
 */
export type UploadMethod = 'tus' | 'normal';

/**
 * Access Control Level for files
 */
export type ACL = 'public-read' | 'private' | 'authenticated-read';

/**
 * File processing status
 */
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Image formats supported for processing
 */
export type ImageFormat = 'webp' | 'jpeg' | 'png';

/**
 * Video formats supported for processing
 */
export type VideoFormat = 'mp4' | 'webm' | 'avi';

/**
 * Audio formats supported for processing
 */
export type AudioFormat = 'mp3' | 'wav' | 'ogg';

export interface GenerateUploadUrlOptions {
  /** Type of media being uploaded */
  mediaType: MediaType;

  /** Original filename */
  filename: string;

  /** Upload method - 'tus' for resumable uploads, 'normal' for standard uploads */
  uploadType?: UploadMethod;

  /** File size in bytes (required for TUS uploads) */
  fileSize?: number;

  /** File type category (avatar, post, product, etc.) */
  type?: string;

  /** Access control level */
  acl?: ACL;

  /** MIME type of the file */
  contentType?: string;

  /** File processing options */
  processingOptions?: ProcessingOptions;

  /** Additional metadata to store with the file */
  metadata?: Record<string, any>;

  /** User ID who created the file */
  createdBy?: string | ObjectId;

  /** User ID who last updated the file */
  updatedBy?: string | ObjectId;
}

/**
 * File processing configuration options
 *
 * Controls how files are processed after upload, including thumbnail generation,
 * format conversion, and processing timing.
 */
export interface ProcessingOptions {
  /** Generate thumbnail images for images and videos */
  generateThumbnail?: boolean;

  /** Generate blur images (multiple thumbnails for videos) */
  generateBlurImage?: boolean;

  /**
   * Whether to process the file immediately or queue for background processing
   * - true: Process immediately (only supported for images/photos)
   * - false: Queue for background processing
   * - Videos are ALWAYS queued regardless of this setting
   * - Documents don't require processing, so this flag is ignored
   * @default false for videos, true for images
   */
  immediateProcess?: boolean;

  /**
   * Whether to allow manual processing via API later
   * - true: File can be manually processed later via API
   * - false: File cannot be manually processed later
   * @default false
   */
  processManual?: boolean;

  /** Output image format for processed images */
  imageFormat?: ImageFormat;

  /** Output video format for processed videos */
  videoFormat?: VideoFormat;

  /** Image/video quality setting (1-100) */
  quality?: number;

  /** Target width for image resizing */
  resizeWidth?: number;

  /** Target height for image resizing */
  resizeHeight?: number;

  /** Webhook URL to notify when processing is complete */
  webhookUrl?: string;
}

/**
 * Response from upload URL generation
 */
export interface UploadUrlResponse {
  /** URL for uploading the file */
  uploadUrl: string;

  /** Generated file ID */
  fileId: string;

  /** Upload method used */
  uploadType: UploadMethod;

  /** JWT token for upload authentication */
  token: string;

  /** Form field name for the file (for normal uploads) */
  fieldName?: string;

  /** Additional form fields required for upload (for normal uploads) */
  fields?: Record<string, string>;

  /** Token expiration time in seconds */
  expiresIn: number;

  /** TUS-specific upload information */
  tusInfo?: TusUploadInfo;
}

/**
 * TUS upload specific information
 */
export interface TusUploadInfo {
  /** TUS upload location URL */
  location: string;

  /** TUS upload ID */
  uploadId: string;

  /** Maximum chunk size for TUS uploads */
  chunkSize: number;

  /** TUS protocol version */
  tusVersion: string;

  /** Supported TUS extensions */
  tusExtensions: string[];

  /** Upload expiration time */
  uploadExpires?: string;
}

/**
 * Thumbnail information
 */
export interface ThumbnailInfo {
  /** Thumbnail size identifier */
  size?: string;

  /** Thumbnail file path */
  path: string;

  /** Thumbnail URL */
  url?: string;

  /** Thumbnail width in pixels */
  width: number;

  /** Thumbnail height in pixels */
  height: number;

  /** Thumbnail file size in bytes */
  fileSize?: number;
}

/** File-server versions may return either a public URL or legacy metadata. */
export type ThumbnailValue = string | ThumbnailInfo;

/**
 * Complete file information
 */
export interface FileInfo {
  /** Unique file identifier */
  _id: string;

  /** File type (image, video, document) */
  type: string;

  /** File name */
  name: string;

  /** Original filename */
  originalName?: string;

  /** File extension */
  fileExtension?: string;

  /** MIME type */
  mimeType: string;

  /** File size in bytes */
  size: number;

  /** Original file size before processing */
  originalFileSize?: number;

  /** Image/video width in pixels */
  width?: number;

  /** Image/video height in pixels */
  height?: number;

  /** Video duration in seconds */
  duration?: number;

  /** Processing status */
  status: ProcessingStatus;

  /** Processing status detailed */
  processingStatus?: ProcessingStatus;

  /** Storage type used */
  storageType?: string;

  /** File path */
  path?: string;

  /** Absolute file path */
  absolutePath?: string;

  /** Access control level */
  acl?: ACL;

  /** Whether file is in protected folder */
  isProtected?: boolean;

  /** Upload method used */
  uploadType?: string;

  /** File access URL */
  url?: string;

  /** Array of thumbnail information */
  thumbnails?: ThumbnailValue[];

  /** Blur image URL */
  blurImage?: string;

  /** Processing error message if failed */
  processingError?: string;

  /** File creation timestamp */
  createdAt: string;

  /** File last update timestamp */
  updatedAt: string;

  /** File upload timestamp */
  uploadedAt?: string;

  /** Processing completion timestamp */
  processedAt?: string;

  /** Additional metadata */
  metadata?: Record<string, any>;

  /** User ID who created the file */
  createdBy?: string;

  /** User ID who last updated the file */
  updatedBy?: string;
}

/**
 * Public file information (limited data)
 */
export interface PublicFileInfo {
  /** Unique file identifier */
  _id: string;

  /** File type */
  type: string;

  /** File name */
  name: string;

  /** MIME type */
  mimeType: string;

  /** Image/video width */
  width?: number;

  /** Image/video height */
  height?: number;

  /** Processing status */
  status: ProcessingStatus;

  /** Processing status */
  processingStatus: ProcessingStatus;

  /** Public thumbnails */
  thumbnails: ThumbnailValue[];

  /** Public blur image */
  blurImage?: string;

  /** Public URL */
  url?: string;
}
