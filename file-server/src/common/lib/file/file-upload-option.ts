import { ObjectId } from 'mongodb';
import { S3AccessControl, UploadMethod } from 'src/common/constants/content';
import { SharpGravity } from "src/config/image";
import { ProcessingPriority } from "src/config/processing";

/**
 * Thumbnail size configuration for multi-size thumbnail generation
 */
export interface IThumbnailSize {
  /** Target width in pixels, null to maintain aspect ratio */
  width?: number;
  /** Target height in pixels, null to maintain aspect ratio */
  height?: number;
  /** Suffix for the thumbnail filename (e.g., 'small', 'medium', 'large') */
  suffix?: string;
  /** Custom quality for this specific thumbnail size */
  quality?: number;
}

/**
 * Advanced thumbnail generation options
 */
export interface IThumbnailOptions {
  /** Whether to generate thumbnails */
  enabled?: boolean;
  /** Single thumbnail size or array of sizes for multiple thumbnails */
  sizes?: IThumbnailSize | IThumbnailSize[];
  /** Sharp gravity mode for image positioning */
  gravity?: SharpGravity;
  /** Thumbnail quality (0-100) */
  quality?: number;
  /** Output format for thumbnails */
  format?: 'webp' | 'jpeg' | 'png';
  /** Whether to generate blur preview image */
  generateBlur?: boolean;
  /** Blur intensity (sigma value) */
  blurIntensity?: number;
}

/**
 * Video processing options
 */
export interface IVideoProcessingOptions {
  /** Whether to convert video to MP4 format */
  convertToMp4?: boolean;
  /** Target video quality (CRF value) */
  quality?: number;
  /** Maximum resolution for video conversion */
  maxResolution?: { width: number; height: number };
  /** Whether to generate multiple resolutions */
  multiResolution?: boolean;
  /** Target resolutions for multi-resolution conversion */
  targetResolutions?: Array<{ width: number; height: number; name: string }>;
  /** Whether to delete original after conversion */
  deleteOriginal?: boolean;
  /** Video thumbnail extraction options */
  thumbnails?: {
    /** Number of thumbnails to extract */
    count?: number;
    /** Thumbnail size */
    size?: string;
    /** Extract at specific timestamps (seconds) */
    timestamps?: number[];
    /** Extract at percentage of video duration */
    atPercentage?: number;
  };
}

/**
 * MD5 hashing options
 */
export interface IMD5Options {
  /** Whether to generate MD5 hashes */
  enabled?: boolean;
  /** Hash original file before processing */
  hashOriginal?: boolean;
  /** Hash processed file after processing */
  hashProcessed?: boolean;
  /** Verify file integrity using hashes */
  verifyIntegrity?: boolean;
}

/**
 * File processing queue options
 */
export interface IProcessingQueueOptions {
  /** Processing priority level */
  priority?: ProcessingPriority;
  /** Custom queue name */
  queueName?: string;
  /** Job timeout in milliseconds */
  timeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Delay between retries in milliseconds */
  retryDelay?: number;
}

/**
 * File Upload Options Interface
 *
 * Comprehensive configuration options for file upload operations across the platform.
 * This interface provides fine-grained control over file processing, storage, and access permissions.
 *
 * @example Basic image upload with enhanced thumbnail generation
 * ```typescript
 * const options: IFileUploadOptions = {
 *   uploader: currentUser,
 *   thumbnails: {
 *     enabled: true,
 *     sizes: [
 *       { width: 150, height: 150, suffix: 'small' },
 *       { width: 300, height: 300, suffix: 'medium' }
 *     ],
 *     gravity: 'center',
 *     quality: 85
 *   },
 *   uploadImmediately: true,
 *   acl: 'public-read'
 * };
 * ```
 *
 * @example Video upload with multi-resolution conversion
 * ```typescript
 * const options: IFileUploadOptions = {
 *   uploader: creator,
 *   videoProcessing: {
 *     convertToMp4: true,
 *     multiResolution: true,
 *     targetResolutions: [
 *       { width: 1920, height: 1080, name: '1080p' },
 *       { width: 1280, height: 720, name: '720p' }
 *     ],
 *     thumbnails: { count: 3, atPercentage: 10 }
 *   },
 *   uploadImmediately: true, // Upload to storage immediately
 *   processingOptions: { immediateProcess: false }, // Queue processing
 *   acl: 'authenticated-read'
 * };
 * ```
 *
 * @example Content reference tracking with MD5 hashing
 * ```typescript
 * const options: IFileUploadOptions = {
 *   uploader: user,
 *   refItem: {
 *     itemId: new ObjectId('...'),
 *     itemType: 'feed'
 *   },
 *   md5Hashing: {
 *     enabled: true,
 *     hashOriginal: true,
 *     hashProcessed: true
 *   },
 *   uploadImmediately: true, // Upload to storage immediately
 *   processingOptions: { immediateProcess: true } // Process immediately
 * };
 * ```
 */
export interface IFileUploadOptions {
  /**
   * The user who is uploading the file
   * Used for ownership tracking, permissions, and audit trails
   * @optional If not provided, file will be treated as system/admin uploaded
   */
  uploader?: Record<string, any>;

  /**
   * User's explicit choice for file processing behavior
   * Determines how the file should be processed regardless of mime type
   * @example 'image', 'photo', 'video', 'document', 'file'
   */
  mediaType?: string;

  /**
   * Reference category for document association
   * Used for organizing files by their purpose/context
   * @example 'feed', 'banner', 'avatar', 'user-data'
   */
  referenceType?: string;

  /**
   * Advanced thumbnail generation options
   * Supports multiple sizes, quality settings, and positioning
   * @example
   * ```typescript
   * thumbnails: {
   *   enabled: true,
   *   sizes: [
   *     { width: 150, height: 150, suffix: 'small' },
   *     { width: 300, height: 300, suffix: 'medium' }
   *   ],
   *   gravity: 'center',
   *   quality: 85,
   *   generateBlur: true
   * }
   * ```
   */
  thumbnails?: IThumbnailOptions;

  /**
   * Video processing configuration
   * Handles conversion, multi-resolution, and thumbnail extraction
   * @example
   * ```typescript
   * videoProcessing: {
   *   convertToMp4: true,
   *   multiResolution: true,
   *   targetResolutions: [
   *     { width: 1920, height: 1080, name: '1080p' },
   *     { width: 1280, height: 720, name: '720p' }
   *   ],
   *   thumbnails: { count: 3, atPercentage: 10 }
   * }
   * ```
   */
  videoProcessing?: IVideoProcessingOptions;

  /**
   * MD5 hashing configuration for file integrity
   * @example
   * ```typescript
   * md5Hashing: {
   *   enabled: true,
   *   hashOriginal: true,
   *   hashProcessed: true,
   *   verifyIntegrity: true
   * }
   * ```
   */
  md5Hashing?: IMD5Options;

  /**
   * Background processing queue configuration
   * @example
   * ```typescript
   * queueOptions: {
   *   priority: 'high',
   *   timeout: 1800000, // 30 minutes
   *   maxRetries: 3
   * }
   * ```
   */
  queueOptions?: IProcessingQueueOptions;

  /**
   * Whether to replace the original file with processed version
   * Useful for avatars and other cases where original is not needed
   * @default false
   * @warning Original file will be permanently deleted
   */
  replaceOriginal?: boolean;

  /**
   * Whether to calculate and store real file sizes after processing
   * @default true
   */
  calculateRealSize?: boolean;

  /**
   * Reference to the content item this file belongs to
   * Used for establishing relationships and cleanup operations
   * @example { itemId: feedId, itemType: 'feed' }
   * @example { itemId: productId, itemType: 'product' }
   */
  refItem?: {
    /** MongoDB ObjectId of the referenced item */
    itemId: ObjectId;
    /** Type of the referenced item (feed, product, message, etc.) */
    itemType: string;
  };

  /**
   * Custom filename for the uploaded file
   * If not provided, a system-generated name will be used
   * Should include file extension for proper handling
   */
  fileName?: string;

  /**
   * Target directory/path for file storage
   * Relative to the configured storage root
   * @example 'feeds/images', 'products/digital', 'messages/attachments'
   */
  destination?: string;

  /**
   * Target server or storage endpoint
   * Used in multi-server or CDN configurations
   * If not specified, default storage configuration is used
   */
  server?: string;

  /**
   * Whether to upload the file to storage (S3, disk) immediately
   * - true: File is written to storage synchronously during request
   * - false: File upload is deferred (useful for temporary processing)
   * @default true for API uploads
   * @note This controls STORAGE upload behavior, not file processing.
   * For processing behavior, use processingOptions.immediateProcess
   */
  uploadImmediately?: boolean;

  /**
   * S3 Access Control List (ACL) permissions
   * Controls who can access the uploaded file
   * @default 'public-read' for public content, 'authenticated-read' for private content
   * @see S3AccessControl enum for available options
   */
  acl?: S3AccessControl;

  /**
   * Processing options for immediate processing decisions
   * Contains flags like immediateProcess for controlling processing behavior
   */
  processingOptions?: any;

  /**
   * Upload method used for this file
   * Tracks how the file was uploaded to the system
   * @default 'regular' for standard multipart uploads
   * @see UploadMethod enum for available options
   */
  uploadMethod?: UploadMethod;

  /**
   * ref fileId - if not provided it will create a new file record
   */
  fileId?: string | ObjectId;
}