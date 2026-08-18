import { extname } from "path";
import { IMulterUploadedFile } from "src/common/lib/file/multer/multer.utils";

// File extensions
export const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.heic', '.heif', '.tiff', '.tif', '.avif'];
export const videoExtensions = ['.mp4', '.mpeg', '.mov', '.avi', '.wmv', '.webm', '.flv', '.mkv', '.ogg', '.m4v', '.hevc'];

// MIME type definitions - centralized source of truth
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/tif'
];

export const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/mpeg',
  'video/quicktime',
  'video/x-msvideo', // .avi
  'video/x-ms-wmv', // .wmv
  'video/webm',
  'video/ogg',
  'video/3gpp',
  'video/x-flv',
  'video/x-matroska', // .mkv
  'video/hevc',
  'video/x-hevc'
];

// MIME type validation functions
export const isValidImageMimeType = (mimeType: string): boolean => IMAGE_MIME_TYPES.includes(mimeType.toLowerCase());

export const isValidVideoMimeType = (mimeType: string): boolean => VIDEO_MIME_TYPES.includes(mimeType.toLowerCase());

// File type detection functions (for backward compatibility and security validation)
export const isImage = (multerData: IMulterUploadedFile): boolean => {
  const ext = extname(multerData.originalname).toLowerCase();
  return isValidImageMimeType(multerData.mimetype) || imageExtensions.includes(ext);
};

export const isVideo = (multerData: IMulterUploadedFile): boolean => {
  const ext = extname(multerData.originalname).toLowerCase();
  return isValidVideoMimeType(multerData.mimetype) || videoExtensions.includes(ext);
};
