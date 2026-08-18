export const FILE_PROCESSING_STATUS = {
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
