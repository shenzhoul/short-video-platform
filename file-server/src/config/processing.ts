/**
 * File processing configuration for queue management, background processing, and optimization
 * Defines settings for file processing workflows, queue priorities, and resource management
 */

/**
 * Processing priority levels for queue management
 */
export const PROCESSING_PRIORITY = {
  /** Critical priority - process immediately */
  CRITICAL: 1,
  /** High priority - process within 1 minute */
  HIGH: 2,
  /** Normal priority - process within 5 minutes */
  NORMAL: 3,
  /** Low priority - process within 30 minutes */
  LOW: 4,
  /** Background priority - process when resources available */
  BACKGROUND: 5
} as const;

export type ProcessingPriority = typeof PROCESSING_PRIORITY[keyof typeof PROCESSING_PRIORITY];

/**
 * File processing job types
 */
export const JOB_TYPES = {
  /** Image thumbnail generation */
  IMAGE_THUMBNAIL: 'image_thumbnail',
  /** Image blur generation */
  IMAGE_BLUR: 'image_blur',
  /** Image format conversion */
  IMAGE_CONVERT: 'image_convert',
  /** Video thumbnail extraction */
  VIDEO_THUMBNAIL: 'video_thumbnail',
  /** Video format conversion */
  VIDEO_CONVERT: 'video_convert',
  /** Multi-resolution video generation */
  VIDEO_MULTI_RES: 'video_multi_res',
  /** MD5 hash generation */
  MD5_HASH: 'md5_hash',
  /** File cleanup */
  FILE_CLEANUP: 'file_cleanup'
} as const;

export type JobType = typeof JOB_TYPES[keyof typeof JOB_TYPES];

/**
 * Default processing settings
 */
export default {
  /** Queue processing settings */
  queue: {
    /** Whether queue processing is enabled */
    enabled: process.env.PROCESSING_QUEUE_ENABLED !== 'false',
    /** Default queue name for file processing */
    defaultQueue: 'file-processing',
    /** Maximum number of concurrent jobs */
    concurrency: parseInt(process.env.PROCESSING_CONCURRENCY, 10) || 3,
    /** Job retry attempts */
    maxRetries: parseInt(process.env.PROCESSING_MAX_RETRIES, 10) || 3,
    /** Job timeout (milliseconds) */
    jobTimeout: parseInt(process.env.PROCESSING_JOB_TIMEOUT, 10) || 1800000, // 30 minutes
    /** Delay between retries (milliseconds) */
    retryDelay: parseInt(process.env.PROCESSING_RETRY_DELAY, 10) || 60000 // 1 minute
  },

  /** Processing priorities by file type */
  priorities: {
    /** Avatar images - high priority for user experience */
    avatar: PROCESSING_PRIORITY.HIGH,
    /** Video thumbnails - normal priority */
    videoThumbnail: PROCESSING_PRIORITY.NORMAL,
    /** Product images - high priority for commerce */
    productThumbnail: PROCESSING_PRIORITY.HIGH,
    /** Cover images - normal priority */
    coverThumbnail: PROCESSING_PRIORITY.NORMAL,
    /** Photo thumbnails - normal priority */
    photoThumbnail: PROCESSING_PRIORITY.NORMAL,
    /** Video conversion - low priority (resource intensive) */
    videoConversion: PROCESSING_PRIORITY.LOW,
    /** MD5 hashing - background priority */
    md5Hashing: PROCESSING_PRIORITY.BACKGROUND,
    /** Normal priority for general processing */
    normal: PROCESSING_PRIORITY.NORMAL,
    /** Avatar resize priority */
    avatarResize: PROCESSING_PRIORITY.HIGH,
    /** Video multi-resolution conversion */
    videoMultiRes: PROCESSING_PRIORITY.LOW,
    /** Video format conversion */
    videoConvert: PROCESSING_PRIORITY.LOW
  },

  /** Background processing settings */
  background: {
    /** Whether to process files in background by default */
    enabled: true,
    /** File size threshold for background processing (bytes) */
    sizeThreshold: parseInt(process.env.BACKGROUND_SIZE_THRESHOLD, 10) || 10485760, // 10MB
    /** Process immediately for files smaller than threshold */
    immediateProcessingThreshold: parseInt(process.env.IMMEDIATE_PROCESSING_THRESHOLD, 10) || 1048576 // 1MB
  },

  /** Background processing settings (alias for compatibility) */
  backgroundProcessing: {
    /** File size threshold for background processing (bytes) */
    fileSizeThreshold: parseInt(process.env.PROCESSING_BACKGROUND_THRESHOLD, 10) || 50 * 1024 * 1024 // 50MB
  },

  /** Resource management */
  resources: {
    /** Maximum memory usage per job (MB) */
    maxMemoryPerJob: parseInt(process.env.MAX_MEMORY_PER_JOB, 10) || 512,
    /** Maximum CPU usage percentage */
    maxCpuUsage: parseInt(process.env.MAX_CPU_USAGE, 10) || 80,
    /** Temporary file cleanup interval (milliseconds) */
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL, 10) || 3600000, // 1 hour
    /** Maximum age for temporary files (milliseconds) */
    tempFileMaxAge: parseInt(process.env.TEMP_FILE_MAX_AGE, 10) || 86400000 // 24 hours
  },

  /** MD5 hashing configuration */
  hashing: {
    /** Whether to generate MD5 hashes by default */
    enabled: process.env.MD5_HASHING_ENABLED !== 'false',
    /** Hash algorithm to use */
    algorithm: 'md5',
    /** Whether to hash original files */
    hashOriginal: true,
    /** Whether to hash processed files */
    hashProcessed: true,
    /** Whether to verify file integrity using hashes */
    verifyIntegrity: true,
    /** Chunk size for hashing large files (bytes) */
    chunkSize: parseInt(process.env.HASH_CHUNK_SIZE, 10) || 65536 // 64KB
  },

  /** File size calculation settings */
  sizeCalculation: {
    /** Whether to calculate real file sizes after processing */
    enabled: true,
    /** Whether to update database with real sizes */
    updateDatabase: true,
    /** Whether to track size differences */
    trackDifferences: true
  },

  /** Cleanup settings */
  cleanup: {
    /** Whether to clean up temporary files automatically */
    autoCleanup: true,
    /** Whether to clean up failed processing files */
    cleanupFailedFiles: true,
    /** Whether to clean up original files when replaced */
    cleanupReplacedFiles: true,
    /** Grace period before cleanup (milliseconds) */
    gracePeriod: parseInt(process.env.CLEANUP_GRACE_PERIOD, 10) || 300000 // 5 minutes
  }
};
