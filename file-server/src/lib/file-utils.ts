import * as jwt from 'jsonwebtoken';
import { parse } from "path";

/**
 * Purpose claim carried by direct-upload tokens.
 *
 * Shared between the issuer (`generateUploadToken`) and the verifier
 * (`FileController.validateUploadToken`) so the two cannot drift apart.
 */
export const UPLOAD_TOKEN_PURPOSE = 'file-upload';

/**
 * File Utilities Library
 *
 * A collection of utility functions for file operations including:
 * - File type detection and MIME type mapping
 * - Unique filename generation
 * - JWT token generation for file access
 * - Upload token creation for secure uploads
 * - Directory path mapping for different file types
 */

/**
 * Get the base directory path for a specific file type
 *
 * Maps file types to their corresponding storage directory names.
 * This helps organize files into logical folders based on their content type.
 *
 * @param type - The file type/category (e.g., 'image', 'video', 'document', 'photo')
 * @returns The directory name for the file type, defaults to 'files' if type not found
 *
 * @example
 * ```typescript
 * getBaseDirectory('image')    // returns 'images'
 * getBaseDirectory('video')    // returns 'videos'
 * getBaseDirectory('document') // returns 'documents'
 * getBaseDirectory('unknown')  // returns 'files'
 * ```
 */
export function getBaseDirectory(type: string): string {
  const typeMap: Record<string, string> = {
    document: 'documents',
    image: 'images',
    video: 'videos',
    photo: 'photos',
    audio: 'audios',
    'post-audio': 'audios'
  };
  return typeMap[type] || 'files';
}

/**
 * Generate a unique filename with timestamp and random string
 *
 * Creates a unique filename by combining the current timestamp with a random string,
 * while preserving the original file extension. This prevents filename conflicts
 * and ensures each uploaded file has a unique identifier.
 *
 * @param originalFilename - The original filename with extension
 * @returns A unique filename in format: {timestamp}-{random}{extension}
 *
 * @example
 * ```typescript
 * generateUniqueFileName('avatar.jpg')     // returns '1632345678901-abc123.jpg'
 * generateUniqueFileName('document.pdf')   // returns '1632345678902-xyz789.pdf'
 * generateUniqueFileName('video.mp4')      // returns '1632345678903-def456.mp4'
 * ```
 */
export function generateUniqueFileName(originalFilename: string): string {
  const { ext } = parse(originalFilename);
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}${ext}`;
}

/**
 * Get MIME type from file extension
 *
 * Maps file extensions to their corresponding MIME types for proper content handling.
 * Supports common image, video, and document formats. Falls back to 'application/octet-stream'
 * for unknown extensions.
 *
 * @param filename - The filename with extension
 * @returns The MIME type string for the file
 *
 * @example
 * ```typescript
 * getMimeTypeFromExtension('image.jpg')     // returns 'image/jpeg'
 * getMimeTypeFromExtension('video.mp4')     // returns 'video/mp4'
 * getMimeTypeFromExtension('document.pdf')  // returns 'application/pdf'
 * getMimeTypeFromExtension('file.unknown')  // returns 'application/octet-stream'
 * ```
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = parse(filename).ext.toLowerCase();

  const mimeTypes: Record<string, string> = {
    // Image formats
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',

    // Video formats
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.webm': 'video/webm',
    '.flv': 'video/x-flv',
    '.mkv': 'video/x-matroska',
    '.hevc': 'video/hevc'
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Generate a secure upload token for file uploads
 *
 * Creates a JWT token containing file upload metadata that expires after 1 hour.
 * This token is used to authenticate and authorize file upload requests, ensuring
 * that only legitimate uploads with proper metadata can be processed.
 *
 * @param fileId - The unique file identifier
 * @param fileKey - The storage key/path for the file
 * @param acl - Access control level (e.g., 'private', 'public-read')
 * @param jwtSecret - The JWT secret key for signing the token
 * @returns A signed JWT token for the upload
 *
 * @example
 * ```typescript
 * const token = generateUploadToken(
 *   '507f1f77bcf86cd799439011',
 *   'images/1632345678901-abc123.jpg',
 *   'private',
 *   process.env.JWT_SECRET
 * );
 * // Returns a JWT token valid for 1 hour
 * ```
 */
export function generateUploadToken(
  fileId: string,
  fileKey: string,
  acl: string,
  jwtSecret: string
): string {
  const payload = {
    fileId,
    fileKey,
    acl,
    // Explicit purpose claim. Every token this service signs uses the same JWT_SECRET, so what a
    // token is allowed to do must be stated in the token and checked on use — not inferred from
    // which fields happen to be present. `TusAuthService` uses `tokenType: 'tus-upload'` for the
    // same reason.
    purpose: UPLOAD_TOKEN_PURPOSE,
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour expiration
  };
  return jwt.sign(payload, jwtSecret);
}