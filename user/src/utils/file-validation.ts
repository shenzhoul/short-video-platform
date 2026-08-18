export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

export const UPLOAD_SIZE_LIMIT_ERROR_MESSAGE = 'The selected file exceeds the maximum allowed upload size. Please upload a file smaller than the supported limit.';

const UPLOAD_SIZE_LIMIT_ERROR_PATTERNS = [
  /413/,
  /payload too large/i,
  /maximum size exceeded/i,
  /file size exceeds/i,
  /size .*exceeds .*maximum/i,
  /exceeds .*upload size/i
];

function getErrorText(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;

  const maybeError = error as {
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    response?: {
      status?: unknown;
      data?: { message?: unknown };
    };
  };

  return [
    maybeError.message,
    maybeError.status,
    maybeError.statusCode,
    maybeError.response?.status,
    maybeError.response?.data?.message
  ]
    .filter(value => value !== undefined && value !== null)
    .join(' ');
}

export function isUploadSizeLimitError(error: unknown): boolean {
  const errorText = getErrorText(error);
  return UPLOAD_SIZE_LIMIT_ERROR_PATTERNS.some(pattern => pattern.test(errorText));
}

export function getUserFriendlyUploadErrorMessage(error: unknown, fallback = 'Upload failed. Please try again.'): string {
  if (isUploadSizeLimitError(error)) {
    return UPLOAD_SIZE_LIMIT_ERROR_MESSAGE;
  }

  const errorText = getErrorText(error).trim();
  return errorText || fallback;
}

/**
 * Validate file size
 */
export function validateFileSize(file: File, maxSizeMB: number): ValidationResult {
  const fileSizeMB = file.size / 1024 / 1024;
  if (fileSizeMB > maxSizeMB) {
    return {
      isValid: false,
      error: UPLOAD_SIZE_LIMIT_ERROR_MESSAGE
    };
  }
  return { isValid: true };
}

/**
 * Common validation presets
 */
export const FILE_VALIDATION_PRESETS = {
  IMAGE: {
    maxSizeMB: 5,
    allowedTypes: ['image/*'],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'tiff', 'tif']
  },
  VIDEO: {
    maxSizeMB: 2048,
    allowedTypes: ['video/*'],
    allowedExtensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv']
  },
  TEASER_VIDEO: {
    maxSizeMB: 200,
    allowedTypes: ['video/*'],
    allowedExtensions: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'],
    maxDurationSeconds: 60
  }
};
