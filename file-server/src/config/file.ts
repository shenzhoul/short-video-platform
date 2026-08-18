import { join } from 'path';

/**
 * File storage directory configuration
 * Defines paths for different types of uploaded and generated files
 * TODO: Consider implementing cloud storage integration (AWS S3, Google Cloud Storage)
 * TODO: Add file size limits and validation rules for each directory type
 */
export default {
  /** Root public directory for all publicly accessible files */
  publicDir: join(__dirname, '..', '..', 'public'),
  /** Public directory for video content */
  videoDir: join(__dirname, '..', '..', 'public', 'videos'),
  /** Public directory for audio content */
  audioDir: join(__dirname, '..', '..', 'public', 'audios'),
  /** General file storage directory */
  fileDir: join(__dirname, '..', '..', 'public', 'files'),
  /** Temporary directory for file processing */
  tempDir: process.env.FILE_TEMP_DIR || join(__dirname, '..', '..', 'temp'),

  /** File size limits in bytes */
  limits: {
    /** Maximum image file size (default: 100MB) */
    image: parseInt(process.env.FILE_MAX_SIZE_IMAGE || '104857600', 10),
    /** Maximum video file size (default: 5GB) */
    video: parseInt(process.env.FILE_MAX_SIZE_VIDEO || '5368709120', 10),
    /** Maximum document file size (default: 5GB) */
    document: parseInt(process.env.FILE_MAX_SIZE_DOCUMENT || '5368709120', 10),
    /** Maximum audio file size (default: 200MB) */
    audio: parseInt(process.env.FILE_MAX_SIZE_AUDIO || '209715200', 10),
    /** Default maximum file size for other types (default: 5GB) */
    default: parseInt(process.env.FILE_MAX_SIZE_DEFAULT || '5368709120', 10)
  },

  /** TUS (Resumable Upload) configuration */
  tus: {
    /** TUS upload directory for temporary resumable uploads */
    uploadDir: process.env.TUS_UPLOAD_DIR || join(__dirname, '..', '..', 'storage', 'tus-uploads'),
    /** TUS upload chunk size in bytes (default: 1MB) */
    chunkSize: parseInt(process.env.TUS_CHUNK_SIZE || '1048576', 10),
    /** Maximum file size for TUS uploads in bytes (default: 5GB) */
    maxFileSize: parseInt(process.env.TUS_MAX_FILE_SIZE || '5368709120', 10)
  },

  /** Legacy maximum file size in bytes (deprecated - use limits.default instead) */
  maxFileSize: parseInt(process.env.FILE_MAX_SIZE || '104857600', 10)
};
