/**
 * Security configuration for authentication and authorization
 * Contains settings for API keys, JWT tokens, and other security features
 */
export default {
  /**
   * API secret key for internal API authentication.
   * Should be set via API_SECRET_KEY environment variable.
   */
  apiSecretKey: process.env.API_SECRET_KEY || 'default-api-secret-key-change-in-production',

  /**
   * JWT secret for token-based authentication
   * Should be set via JWT_SECRET environment variable
   */
  jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret-change-in-production',

  /**
   * JWT token expiration time
   * Default: 24 hours
   */
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',

  /**
   * API rate limiting settings
   */
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10) // 100 requests per window
  },

  /**
   * CORS settings for cross-origin requests
   */
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:8080'],
    credentials: true
  },

  /**
   * File upload security settings
   */
  upload: {
    maxFileSize: process.env.MAX_FILE_SIZE || '100MB',
    allowedMimeTypes: {
      image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/heic', 'image/heif'],
      video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm'],
      document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
    }
  }
};
