/**
 * Storage types
 * Available storage backends for file uploads
 */
export const STORAGE_TYPES = {
  /** Local disk storage */
  DISK_STORAGE: 'diskStorage',
  /** In-memory storage (temporary) */
  MEMORY_STORAGE: 'memoryStorage',
  /** Amazon S3 storage */
  S3: 's3',
  /** External link storage */
  EXTERNAL_LINK: 'externalLink'
} as const;

/**
 * S3 object access control levels
 * Access permissions for S3 stored files
 */
export const S3_ACCESS_CONTROL = {
  /** Publicly readable */
  PUBLIC_READ: 'public-read',
  /** Requires authentication to read */
  AUTHENTICATED_READ: 'private', // compatible with other S3 service such as R2, Bunny, DO storage...

  PRIVATE: 'private'
} as const;

export type S3AccessControl = typeof S3_ACCESS_CONTROL[keyof typeof S3_ACCESS_CONTROL];

/**
 * File processing status
 * Tracks the current processing state of uploaded files
 */
export const PROCESSING_STATUS = {
  /** File is pending processing (not yet queued) */
  PENDING: 'pending',
  /** File is queued for processing */
  IN_QUEUE: 'in-queue',
  /** File is currently being processed */
  PROCESSING: 'processing',
  /** File processing completed successfully */
  COMPLETED: 'completed',
  /** File processing failed */
  FAILED: 'failed'
} as const;

/**
 * Upload methods
 * Different ways files can be uploaded to the system
 */
export const UPLOAD_METHODS = {
  /** Regular multipart upload */
  REGULAR: 'regular',
  /** TUS resumable upload */
  TUS: 'tus',
  /** Direct URL upload */
  DIRECT: 'direct'
} as const;

/**
 * File status
 * Overall status of the file record (upload lifecycle)
 */
export const FILE_STATUS = {
  /** File record created, upload not started */
  PENDING: 'pending',
  /** File is currently being uploaded */
  UPLOADING: 'uploading',
  /** File upload completed successfully */
  UPLOADED: 'uploaded',
  /** File upload or processing failed */
  ERROR: 'error',
  /** File is active and available (legacy - same as uploaded) */
  ACTIVE: 'active',
  /** File is archived */
  ARCHIVED: 'archived',
  /** File is deleted (soft delete) */
  DELETED: 'deleted'
} as const;

// ===== TYPE EXPORTS =====

export type StorageType = typeof STORAGE_TYPES[keyof typeof STORAGE_TYPES];
export type ProcessingStatus = typeof PROCESSING_STATUS[keyof typeof PROCESSING_STATUS];
export type UploadMethod = typeof UPLOAD_METHODS[keyof typeof UPLOAD_METHODS];
export type FileStatus = typeof FILE_STATUS[keyof typeof FILE_STATUS];
