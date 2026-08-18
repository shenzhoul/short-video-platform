import { useCallback, useState } from 'react';
import { toast } from 'react-toastify';

import {
  uploadFile as uploadFileApi,
  UploadProgress,
  UploadResult,
  UploadUrlOptions
} from '../services/file-upload.service';

/**
 * File Upload Hook
 *
 * A comprehensive React hook for handling file uploads with the file server.
 * Provides state management, progress tracking, and error handling for file uploads.
 *
 * Features:
 * - Upload state management (idle, uploading, success, error)
 * - Progress tracking with percentage and speed
 * - Error handling with user-friendly messages
 * - Support for both TUS and normal uploads
 * - Automatic retry on failure
 * - File validation
 * - Reusable across components
 *
 * @author ShenZhoul
 * @version 1.0.0
 */

export interface UseFileUploadOptions {
  /** API endpoint to get upload URL from */
  endpoint: string;

  /** Upload configuration options */
  uploadOptions?: Omit<UploadUrlOptions, 'filename' | 'fileSize'>;

  /** Show success message on completion */
  showSuccessMessage?: boolean;

  /** Show error message on failure */
  showErrorMessage?: boolean;

  /** Custom success message */
  successMessage?: string;

  /** Custom error message */
  errorMessage?: string;

  /** File validation function */
  validateFile?: (file: File) => string | null;

  /** Maximum file size in MB */
  maxSizeMB?: number;

  /** Allowed file types */
  allowedTypes?: string[];

  /** Callback when upload starts */
  onUploadStart?: (file: File) => void;

  /** Callback when upload completes successfully */
  onUploadSuccess?: (result: UploadResult, file: File) => void;

  /** Callback when upload fails */
  onUploadError?: (error: string, file: File) => void;

  /** Callback for upload progress updates */
  onProgress?: (progress: UploadProgress) => void;
}

export interface UseFileUploadState {
  /** Current upload state */
  isUploading: boolean;

  /** Upload progress information */
  progress: UploadProgress | null;

  /** Error message if upload failed */
  error: string | null;

  /** Upload result if successful */
  result: UploadResult | null;

  /** Whether upload was successful */
  isSuccess: boolean;

  /** Whether upload failed */
  isError: boolean;
}

export interface UseFileUploadReturn {
  /** Current upload state */
  state: UseFileUploadState;

  /** Function to upload a file */
  uploadFile: (file: File) => Promise<UploadResult>;

  /** Function to reset upload state */
  reset: () => void;

  /** Function to cancel current upload */
  cancel: () => void;
}

/**
 * Default file validation function
 * Validates file size and type based on options
 */
const defaultValidateFile = (
  file: File,
  maxSizeMB: number = 50,
  allowedTypes: string[] = []
): string | null => {
  // Check file size
  const fileSizeMB = file.size / (1024 * 1024);
  if (fileSizeMB > maxSizeMB) {
    return `File size must be less than ${maxSizeMB}MB`;
  }

  // Check file type if specified
  if (allowedTypes.length > 0) {
    const fileType = file.type.toLowerCase();
    const fileName = file.name.toLowerCase();

    const isAllowed = allowedTypes.some((type) => {
      if (type.startsWith('.')) {
        // Extension check
        return fileName.endsWith(type.toLowerCase());
      }
      // MIME type check
      return fileType.includes(type.toLowerCase());
    });

    if (!isAllowed) {
      return `File type not allowed. Allowed types: ${allowedTypes.join(', ')}`;
    }
  }

  return null;
};

/**
 * Custom hook for file uploads with comprehensive state management
 *
 * @param options - Configuration options for the upload hook
 * @returns Upload state and control functions
 *
 * @example
 * ```typescript
 * const { state, uploadFile, reset } = useFileUpload({
 *   endpoint: '/api/files/upload-url',
 *   uploadOptions: {
 *     mediaType: 'image',
 *     acl: 'public-read'
 *   },
 *   showSuccessMessage: true,
 *   maxSizeMB: 10,
 *   allowedTypes: ['image/jpeg', 'image/png']
 * });
 *
 * const handleFileSelect = async (file: File) => {
 *   try {
 *     const result = await uploadFile(file);
 *
 *   } catch {
 *
 *   }
 * };
 * ```
 */
export function useFileUpload(options: UseFileUploadOptions): UseFileUploadReturn {
  const {
    endpoint,
    uploadOptions = {},
    showSuccessMessage = true,
    showErrorMessage = true,
    successMessage = 'File uploaded successfully',
    errorMessage = 'Upload failed. Please try again.',
    validateFile,
    maxSizeMB = 50,
    allowedTypes = [],
    onUploadStart,
    onUploadSuccess,
    onUploadError,
    onProgress
  } = options;

  // Upload state
  const [state, setState] = useState<UseFileUploadState>({
    isUploading: false,
    progress: null,
    error: null,
    result: null,
    isSuccess: false,
    isError: false
  });

  // Current upload controller for cancellation
  const [currentUpload, setCurrentUpload] = useState<{
    cancel:() => void;
  } | null>(null);

  /**
   * Reset upload state to initial values
   */
  const reset = useCallback(() => {
    setState({
      isUploading: false,
      progress: null,
      error: null,
      result: null,
      isSuccess: false,
      isError: false
    });
    setCurrentUpload(null);
  }, []);

  /**
   * Cancel current upload if in progress
   */
  const cancel = useCallback(() => {
    if (currentUpload) {
      currentUpload.cancel();
      setCurrentUpload(null);
      setState((prev) => ({
        ...prev,
        isUploading: false,
        error: 'Upload cancelled',
        isError: true
      }));
    }
  }, [currentUpload]);

  /**
   * Upload a file with comprehensive error handling and progress tracking
   */
  const uploadFile = useCallback(async (file: File): Promise<UploadResult> => {
    // Reset previous state
    reset();

    // Validate file
    const validation = validateFile
      ? validateFile(file)
      : defaultValidateFile(file, maxSizeMB, allowedTypes);

    if (validation) {
      const errorResult: UploadResult = {
        success: false,
        fileId: '',
        _id: '',
        error: validation
      };

      setState({
        isUploading: false,
        progress: null,
        error: validation,
        result: errorResult,
        isSuccess: false,
        isError: true
      });

      if (showErrorMessage) {
        toast.error(validation);
      }

      onUploadError?.(validation, file);
      throw new Error(validation);
    }

    // Start upload
    setState({
      isUploading: true,
      progress: null,
      error: null,
      result: null,
      isSuccess: false,
      isError: false
    });

    onUploadStart?.(file);

    try {
      const result = await uploadFileApi(
        endpoint,
        file,
        uploadOptions,
        (progress: UploadProgress) => {
          setState((prev) => ({
            ...prev,
            progress
          }));
          onProgress?.(progress);
        }
      );

      // Success
      setState({
        isUploading: false,
        progress: null,
        error: null,
        result,
        isSuccess: true,
        isError: false
      });

      if (showSuccessMessage) {
        toast.success(successMessage);
      }

      onUploadSuccess?.(result, file);
      setCurrentUpload(null);

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : errorMessage;
      const errorResult: UploadResult = {
        success: false,
        fileId: '',
        _id: '',
        error: errorMsg
      };

      setState({
        isUploading: false,
        progress: null,
        error: errorMsg,
        result: errorResult,
        isSuccess: false,
        isError: true
      });

      if (showErrorMessage) {
        toast.error(errorMsg);
      }

      onUploadError?.(errorMsg, file);
      setCurrentUpload(null);

      throw error;
    }
  }, [
    endpoint,
    uploadOptions,
    showSuccessMessage,
    showErrorMessage,
    successMessage,
    errorMessage,
    validateFile,
    maxSizeMB,
    allowedTypes,
    onUploadStart,
    onUploadSuccess,
    onUploadError,
    onProgress,
    reset
  ]);

  return {
    state,
    uploadFile,
    reset,
    cancel
  };
}

export default useFileUpload;
