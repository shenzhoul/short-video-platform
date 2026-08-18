/**
 * Image processing configuration defining thumbnail sizes, quality settings, and processing options
 * Used for automatic image resizing, optimization, and thumbnail generation across the platform
 */

/**
 * Sharp gravity modes for image positioning during resize operations
 * @see https://sharp.pixelplumbing.com/api-resize#resize
 */
export const SHARP_GRAVITY = {
  /** Position image at the center (default) */
  CENTER: 'center',
  /** Position image at the top center */
  NORTH: 'north',
  /** Position image at the top right */
  NORTHEAST: 'northeast',
  /** Position image at the center right */
  EAST: 'east',
  /** Position image at the bottom right */
  SOUTHEAST: 'southeast',
  /** Position image at the bottom center */
  SOUTH: 'south',
  /** Position image at the bottom left */
  SOUTHWEST: 'southwest',
  /** Position image at the center left */
  WEST: 'west',
  /** Position image at the top left */
  NORTHWEST: 'northwest',
  /** Smart crop focusing on the most interesting region */
  ATTENTION: 'attention',
  /** Smart crop focusing on detected entropy */
  ENTROPY: 'entropy'
} as const;

export type SharpGravity = typeof SHARP_GRAVITY[keyof typeof SHARP_GRAVITY];

/**
 * Image quality presets for different use cases
 */
export const IMAGE_QUALITY = {
  /** High quality for important images (90-95%) */
  HIGH: 90,
  /** Standard quality for general use (80-85%) */
  STANDARD: 85,
  /** Medium quality for thumbnails (70-75%) */
  MEDIUM: 75,
  /** Low quality for previews (50-60%) */
  LOW: 60,
  /** Very low quality for blur images (30-40%) */
  VERY_LOW: 40
} as const;

/**
 * Default thumbnail generation settings
 */
export const THUMBNAIL_DEFAULTS = {
  /** Default thumbnail generation enabled */
  enabled: true,
  /** Default gravity mode for thumbnail positioning */
  gravity: SHARP_GRAVITY.CENTER,
  /** Default quality for thumbnails */
  quality: IMAGE_QUALITY.STANDARD,
  /** Default format for thumbnails */
  format: 'webp',
  /** Whether to generate multiple thumbnail sizes */
  multipleSizes: false,
  /** Maximum number of thumbnail sizes to generate */
  maxSizes: 3
} as const;

export default {
  /** Global thumbnail settings */
  thumbnails: THUMBNAIL_DEFAULTS,

  /** Blur image settings for preview images */
  blur: {
    enabled: process.env.IMAGE_BLUR_ENABLED === 'true' || true,
    intensity: parseInt(process.env.IMAGE_BLUR_INTENSITY || '10', 10)
  },

  /** Avatar image dimensions - square format for user profile pictures */
  avatar: {
    width: 220,
    height: 220,
    quality: IMAGE_QUALITY.HIGH,
    gravity: SHARP_GRAVITY.CENTER,
    replaceOriginal: true, // Save storage space for avatars
    generateBlur: false
  },

  /** Video thumbnail dimensions - landscape format for video previews */
  videoThumbnail: {
    width: 350,
    // Height is calculated automatically to maintain aspect ratio
    quality: IMAGE_QUALITY.STANDARD,
    gravity: SHARP_GRAVITY.CENTER,
    generateBlur: true,
    multipleSizes: false
  },

  /** Product thumbnail dimensions - square format for marketplace items */
  productThumbnail: {
    width: 300,
    height: 300,
    quality: IMAGE_QUALITY.HIGH,
    gravity: SHARP_GRAVITY.CENTER,
    generateBlur: false,
    multipleSizes: true,
    sizes: [
      { width: 150, height: 150, suffix: 'small' },
      { width: 300, height: 300, suffix: 'medium' },
      { width: 600, height: 600, suffix: 'large' }
    ]
  },

  /** Cover image dimensions - wide format for banners and headers */
  coverThumbnail: {
    width: 1600,
    height: 480,
    quality: IMAGE_QUALITY.HIGH,
    gravity: SHARP_GRAVITY.CENTER,
    generateBlur: true,
    multipleSizes: true,
    sizes: [
      { width: 800, height: 240, suffix: 'medium' },
      { width: 1600, height: 480, suffix: 'large' }
    ]
  },

  /** Photo thumbnail dimensions - landscape format for gallery previews */
  photoThumbnail: {
    width: 280,
    height: 220,
    quality: IMAGE_QUALITY.STANDARD,
    gravity: SHARP_GRAVITY.CENTER,
    generateBlur: true,
    multipleSizes: true,
    sizes: [
      { width: 140, height: 110, suffix: 'small' },
      { width: 280, height: 220, suffix: 'medium' },
      { width: 560, height: 440, suffix: 'large' }
    ]
  },

  /** Blur image settings for preview images */
  blurImage: {
    width: 100,
    height: 100,
    sigma: 10, // Blur intensity
    quality: IMAGE_QUALITY.VERY_LOW,
    format: 'webp'
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

  /** Maximum file size for images (20MB) */
  maxFileSize: parseInt(process.env.IMAGE_MAX_FILE_SIZE || '20971520', 10)
};
