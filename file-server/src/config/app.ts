/**
 * Application configuration settings
 * Contains basic server and URL configuration
 */
export default {
  /** HTTP server port - defaults to 3001 if not specified in environment */
  port: parseInt(process.env.PORT || process.env.HTTP_PORT || '3001', 10),
  /** Server host */
  host: process.env.HOST || 'localhost',
  /** API prefix */
  apiPrefix: process.env.API_PREFIX || '',
  /** Environment */
  environment: process.env.NODE_ENV || 'development',
  /** Base URL for the application - used for generating absolute URLs */
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || process.env.HTTP_PORT || 3001}`,
  /** Upload endpoint path */
  uploadPath: '/internal/files/upload',
  /** File field name for uploads */
  fileFieldName: 'file',
  /** Supported upload methods - can be 'normal', 'tus', or both */
  supportedUploadMethods: (process.env.SUPPORTED_UPLOAD_METHODS || 'normal,tus').split(',').map((m) => m.trim())
};
