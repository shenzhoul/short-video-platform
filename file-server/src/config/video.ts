/**
 * Video processing configuration for encoding, transcoding, thumbnail generation, and optimization
 * Uses FFmpeg for video manipulation and sets quality/size constraints
 */

/**
 * Video quality presets for different use cases
 */
export const VIDEO_QUALITY = {
  /** High quality (CRF 18-23) */
  HIGH: 20,
  /** Standard quality (CRF 23-28) */
  STANDARD: 25,
  /** Medium quality (CRF 28-32) */
  MEDIUM: 30,
  /** Low quality (CRF 32-40) */
  LOW: 35
} as const;

/**
 * Video resolution presets
 */
export const VIDEO_RESOLUTIONS = {
  /** 4K Ultra HD */
  UHD_4K: { width: 3840, height: 2160, name: '4K' },
  /** 2K Quad HD */
  QHD_2K: { width: 2560, height: 1440, name: '2K' },
  /** Full HD 1080p */
  FHD_1080P: { width: 1920, height: 1080, name: '1080p' },
  /** HD 720p */
  HD_720P: { width: 1280, height: 720, name: '720p' },
  /** Standard Definition */
  SD_480P: { width: 854, height: 480, name: '480p' },
  /** Low Definition */
  LD_360P: { width: 640, height: 360, name: '360p' }
} as const;

/**
 * Default video thumbnail settings
 */
export const VIDEO_THUMBNAIL_DEFAULTS = {
  /** Default number of thumbnails to generate */
  count: 1,
  /** Maximum number of thumbnails allowed */
  maxCount: 5,
  /** Default thumbnail size */
  size: '640x360',
  /** Default thumbnail format */
  format: 'webp',
  /** Default thumbnail quality */
  quality: 85,
  /** Whether to extract thumbnails at specific timestamps */
  useTimestamps: false,
  /** Default timestamps (in seconds) for thumbnail extraction */
  timestamps: [10, 30, 60] // Extract at 10s, 30s, 60s
} as const;

export default {
  /** Path to FFmpeg executable - should be installed on the system */
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',

  /** Path to FFprobe executable - should be installed on the system */
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',

  /** Maximum allowed video resolution to prevent excessive resource usage */
  maxResolution: {
    /** Maximum video width in pixels (default 2K) */
    width: parseInt(process.env.VIDEO_MAX_WIDTH, 10) || VIDEO_RESOLUTIONS.QHD_2K.width,
    /** Maximum video height in pixels (default 2K) */
    height: parseInt(process.env.VIDEO_MAX_HEIGHT, 10) || VIDEO_RESOLUTIONS.QHD_2K.height
  },

  /** Multi-resolution conversion settings */
  multiResolution: {
    /** Whether to generate multiple resolutions by default */
    enabled: false,
    /** Whether to delete original after conversion */
    deleteOriginal: true,
    /** Available resolution targets */
    resolutions: [
      VIDEO_RESOLUTIONS.FHD_1080P,
      VIDEO_RESOLUTIONS.HD_720P,
      VIDEO_RESOLUTIONS.SD_480P
    ],
    /** Quality setting for multi-resolution conversion */
    quality: VIDEO_QUALITY.STANDARD
  },

  /** Video thumbnail generation settings */
  thumbnails: {
    ...VIDEO_THUMBNAIL_DEFAULTS,
    /** Whether thumbnail generation is enabled */
    enabled: process.env.VIDEO_THUMBNAILS_ENABLED !== 'false',
    /** Default thumbnail extraction settings */
    extraction: {
      /** Extract thumbnail from percentage of video duration */
      atPercentage: 10, // Extract at 10% of video duration
      /** Fallback to specific second if percentage fails */
      fallbackSecond: 5,
      /** Skip initial seconds to avoid black frames */
      skipInitialSeconds: 2
    }
  },

  /** Video conversion settings */
  conversion: {
    /** Default video codec */
    videoCodec: 'libx264',
    /** Default audio codec */
    audioCodec: 'aac',
    /** Default container format */
    format: 'mp4',
    /** Default quality setting */
    quality: VIDEO_QUALITY.STANDARD,
    /** Whether to maintain aspect ratio */
    maintainAspectRatio: true,
    /** Maximum bitrate (in kbps) */
    maxBitrate: 5000,
    /** Audio bitrate (in kbps) */
    audioBitrate: 128
  },

  /** Hardware acceleration settings */
  hardwareAcceleration: {
    /** Enable hardware acceleration when available (auto-detect) */
    enabled: process.env.VIDEO_HWACCEL_ENABLED !== 'false',
    /** Prefer specific hardware accelerator: 'auto' | 'nvidia' | 'amd' | 'intel' | 'vaapi' | 'qsv' | 'cpu' */
    prefer: (process.env.VIDEO_HWACCEL_PREFER as any) || 'auto',
    /** Fallback to software encoding if hardware fails */
    allowFallback: true
  },

  /** Performance settings */
  performance: {
    /** CPU usage limit for FFmpeg (percentage) */
    cpuLimit: parseInt(process.env.FFMPEG_CPU_LIMIT, 10) || 50,
    /** Memory limit for FFmpeg (MB) */
    memoryLimit: parseInt(process.env.FFMPEG_MEMORY_LIMIT, 10) || 1024,
    /** Timeout for video processing (seconds) */
    timeout: parseInt(process.env.VIDEO_PROCESSING_TIMEOUT, 10) || 1800, // 30 minutes
    /** FFmpeg preset for software encoding: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' */
    preset: (process.env.FFMPEG_PRESET as any) || 'fast',
    /** Enable multi-threading for CPU encoding. Default false to avoid starving other processes (DB, API, etc.). Set VIDEO_MAX_THREADS=true to enable. */
    maxThreads: process.env.VIDEO_MAX_THREADS === 'true'
  },

  /** MD5 hashing settings */
  hashing: {
    /** Whether to generate MD5 hashes by default */
    enabled: true,
    /** Hash original file before processing */
    hashOriginal: true,
    /** Hash processed file after processing */
    hashProcessed: true
  },

  /** Maximum file size for videos (500MB) */
  maxFileSize: parseInt(process.env.VIDEO_MAX_FILE_SIZE || '524288000', 10)
};
