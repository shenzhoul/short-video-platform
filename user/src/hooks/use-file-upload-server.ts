import { toast } from '@douyin-clone/shared-toast';
import { describeRejectedUpload, describeUploadFailure } from '@lib/upload-policy';
import { useCallback, useState } from 'react';

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

  /**
   * The durable upload type this endpoint issues a URL for.
   *
   * When set, the file is judged against that type's policy from
   * `@douyin-clone/upload-policy` — the same table the API and the file server
   * read — and a rejected upload is reported with the policy's own message.
   *
   * Strongly preferred over `maxSizeMB`/`allowedTypes`, which were per-caller
   * guesses: the avatar picker refused above 50MB while nothing on the server
   * agreed, and the post-photo picker refused above 5MB while the server had no
   * opinion at all. Naming the type is how a picker gets the limits the upload
   * will actually be held to.
   */
  uploadType?: string;

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
    uploadType,
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

    // Validate file.
    //
    // An explicit `validateFile` still wins — a caller with a rule the registry
    // does not model keeps it. Otherwise the durable upload type decides, and
    // only callers that name neither fall back to the old per-caller numbers.
    let validation: string | null;
    if (validateFile) {
      validation = validateFile(file);
    } else if (uploadType) {
      validation = await describeRejectedUpload(file, uploadType);
    } else {
      validation = defaultValidateFile(file, maxSizeMB, allowedTypes);
    }

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

      // `uploadFileApi` resolves rather than throws when the server refuses a
      // file: a TUS failure comes back as `{ success: false, error, errorCode }`.
      // This branch used to ignore that and report success, so a picture the
      // file server had already deleted was announced as uploaded and the next
      // call — `updateAvatar(result.fileId)` — failed against a record that no
      // longer existed. The refusal is reported as a refusal instead, in the
      // policy's own words where it sent a code.
      if (!result.success) {
        const refusal = describeUploadFailure(result, result.error || errorMessage);
        setState({
          isUploading: false,
          progress: null,
          error: refusal,
          result,
          isSuccess: false,
          isError: true
        });

        if (showErrorMessage) {
          toast.error(refusal);
        }

        onUploadError?.(refusal, file);
        setCurrentUpload(null);

        const reported = new Error(refusal);
        (reported as any).__uploadRefusalReported = true;
        throw reported;
      }

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
      // The refusal branch above has already set state, toasted and notified.
      // Re-running all three here would show the same message twice, which is
      // exactly the double-toast the comment composer was fixed for.
      if ((error as any)?.__uploadRefusalReported) throw error;

      const errorMsg = describeUploadFailure(
        error,
        error instanceof Error ? error.message : errorMessage
      );
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
    uploadType,
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
