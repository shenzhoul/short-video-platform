/**
 * Interface for file processing options
 *
 * Controls how files are processed after upload, including thumbnail generation,
 * format conversion, and processing timing.
 */
export interface IFileProcessingOptions {
  /** Whether to generate thumbnails for images and videos */
  generateThumbnail?: boolean;

  /** Whether to generate blur images (multiple thumbnails for videos) */
  generateBlurImage?: boolean;

  /**
   * Whether to process the file immediately or queue for background processing
   * - true: Process immediately (only supported for images/photos)
   * - false: Queue for background processing
   * - Videos are ALWAYS queued regardless of this setting
   * - Documents don't require processing, so this flag is ignored
   * - For photos specifically, defaults to immediate if not specified
   * @default false for videos, true for photos if not specified
   */
  immediateProcess?: boolean;

  /**
   * Whether to skip automatic processing entirely and handle manually
   * - true: Skip all automatic processing (upload only)
   * - false: Process according to other options (default)
   * Use for custom processing workflows or conditional processing
   * @default false
   */
  processManual?: boolean;

  /** Target video format for conversion */
  videoFormat?: 'mp4' | 'webm' | 'avi';

  /** Target image format for conversion */
  imageFormat?: 'webp' | 'jpeg' | 'png';

  /** Target audio format for conversion */
  audioFormat?: 'mp3' | 'wav' | 'ogg' | 'm4a' | 'aac';

  /** Target width for image resizing */
  resizeWidth?: number;

  /** Target height for image resizing */
  resizeHeight?: number;

  /** Quality setting for image/video compression (0-100) */
  quality?: number;

  /** Webhook URL to notify when processing is complete */
  webhookUrl?: string;
}

/**
 * Interface for signed upload request
 */
export interface ISignedUploadRequest {
  mediaType: 'image' | 'video' | 'document' | 'audio' | 'file';
  type: string;
  filename: string;
  acl: 'public-read' | 'private' | 'authenticated-read';
  contentType?: string;
  processingOptions?: IFileProcessingOptions;
  metadata?: Record<string, any>;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Interface for signed upload response
 */
export interface ISignedUploadResponse {
  uploadUrl: string;
  fileId: string;
  token: string;
  fields?: Record<string, string>;
  fieldName: string;
  expiresIn?: number;
  uploadType: 'tus' | 'normal';
  httpMethod: 'POST';
}