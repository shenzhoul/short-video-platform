/**
 * File Server Integration Configuration
 *
 * This configuration module provides settings for integrating with the Douyin Clone File Server.
 * It includes base URLs, authentication settings, and webhook configurations.
 *
 * Environment Variables:
 * - FILE_SERVER_BASE_URL: Base URL of the file server (default: http://localhost:8000)
 * - FILE_SERVER_API_KEY: API key for file server authentication
 * - INTERNAL_API_KEY: Internal API key for file server internal-only routes
 * - FILE_SERVER_JWT_SECRET: JWT secret for token generation
 * - FILE_SERVER_UPLOAD_METHOD: Upload method - 'tus' or 'normal' (default: tus)
 * - BASE_URL_WEBHOOK_INTERNAL: Internal API base URL for file-server callbacks in Docker
 * - WEBHOOK_BASE_URL: Legacy webhook base URL override
 * - FILE_SERVER_TIMEOUT: Request timeout in milliseconds (default: 30000)
 * - FILE_SERVER_MAX_RETRIES: Maximum retry attempts for failed requests (default: 3)
 * - TUS_CHUNK_SIZE: TUS upload chunk size in bytes (default: 1MB)
 * - TUS_MAX_FILE_SIZE: Maximum file size for TUS uploads (default: 5GB)
 *
 * @author ShenZhoul
 * @version 1.0.0
 */

export default {
  /** Base URL of the file server API */
  baseUrl: process.env.FILE_SERVER_BASE_URL || 'http://localhost:8000',

  /** Internal API endpoints prefix */
  internalPrefix: '/internal/files',

  /** Upload configuration */
  upload: {
    /** Default upload method - 'tus' for resumable uploads, 'normal' for standard uploads */
    method: (process.env.FILE_SERVER_UPLOAD_METHOD || 'tus') as 'tus' | 'normal',

    /** Public upload endpoint for normal uploads */
    normalEndpoint: '/files/upload',

    /** TUS upload endpoint for resumable uploads */
    tusEndpoint: '/tus-upload'
  },

  /** Authentication configuration */
  auth: {
    /** API key for server-to-server authentication */
    apiKey: process.env.FILE_SERVER_API_KEY || '',

    /** Internal API key for routes protected by InternalOnlyGuard */
    internalApiKey: process.env.INTERNAL_API_KEY || '',

    /** JWT secret for token generation and validation */
    jwtSecret: process.env.FILE_SERVER_JWT_SECRET || '',

    /** Token expiration time in seconds (default: 1 hour) */
    tokenExpiresIn: parseInt(process.env.FILE_SERVER_TOKEN_EXPIRES_IN || '3600', 10)
  },

  /** Webhook configuration */
  webhook: {
    /** Base URL for webhook callbacks */
    baseUrl: process.env.BASE_URL_WEBHOOK_INTERNAL
      || process.env.WEBHOOK_BASE_URL
      || process.env.BASE_URL
      || `http://localhost:${process.env.HTTP_PORT || process.env.PORT || 8080}`,

    /** Webhook endpoint paths */
    endpoints: {
      fileProcessed: '/webhooks/file-processed',
      fileUploaded: '/webhooks/file-uploaded',
      fileDeleted: '/webhooks/file-deleted',
      processingFailed: '/webhooks/processing-failed'
    }
  },

  /** TUS (Tus Resumable Upload) configuration */
  tus: {
    /** TUS upload chunk size in bytes (default: 1MB) */
    chunkSize: parseInt(process.env.TUS_CHUNK_SIZE || '1048576', 10),

    /** Maximum file size for TUS uploads in bytes (default: 5GB) */
    maxFileSize: parseInt(process.env.TUS_MAX_FILE_SIZE || '5368709120', 10),

    /** TUS protocol version */
    version: '1.0.0',

    /** TUS extensions supported */
    extensions: ['creation', 'expiration', 'checksum', 'termination']
  },

  /** HTTP client configuration */
  http: {
    /** Request timeout in milliseconds */
    timeout: parseInt(process.env.FILE_SERVER_TIMEOUT || '30000', 10),

    /** Maximum retry attempts for failed requests */
    maxRetries: parseInt(process.env.FILE_SERVER_MAX_RETRIES || '3', 10),

    /** Retry delay in milliseconds */
    retryDelay: parseInt(process.env.FILE_SERVER_RETRY_DELAY || '1000', 10)
  },

  /** File processing defaults */
  defaults: {
    /** Default ACL for uploaded files */
    acl: 'public-read' as const,

    /** Default image processing options */
    image: {
      quality: 85,
      generateThumbnail: true,
      generateBlurImage: true,
      imageFormat: 'webp' as const
    },

    /** Default video processing options */
    video: {
      generateThumbnail: true,
      videoFormat: 'mp4' as const,
      immediateProcess: false
    }
  },

  /** File size limits (in bytes) */
  limits: {
    /** Maximum image file size (100MB) */
    image: 100 * 1024 * 1024,

    /** Maximum video file size (1GB) */
    video: 1024 * 1024 * 1024,
  },

  /** Supported file formats */
  formats: {
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'],
    video: ['mp4', 'avi', 'mov', 'wmv', 'webm']
  }
};
