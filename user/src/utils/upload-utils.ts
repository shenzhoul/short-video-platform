/**
 * Upload Utilities for User Application
 *
 * Provides utilities for handling file uploads with parallel processing,
 * progress tracking, and error handling for better user experience.
 *
 * Features:
 * - Parallel file uploads with concurrency control
 * - Progress aggregation across multiple files
 * - Individual file error handling
 * - Support for different file types (photos, videos, thumbnails, teasers)
 * - Comprehensive error reporting
 *
 * @author ShenZhoul
 * @version 1.0.0
 */

import { getUserFriendlyUploadErrorMessage } from './file-validation';

export interface UploadProgress {
  percentage: number;
  bytesUploaded: number;
  totalBytes: number;
  speed?: number;
}

export interface FileUploadItem {
  file: File;
  type: 'photo' | 'video' | 'thumbnail' | 'teaser' | 'image';
}

export interface UploadResult {
  success: boolean;
  fileId: string;
  error?: string;
  file: File;
  type: string;
}

export interface ParallelUploadOptions {
  maxConcurrency?: number;
  onProgress?: (progress: { percentage: number; completed: number; total: number }) => void;
  onFileComplete?: (result: UploadResult) => void;
  onFileError?: (error: string, file: File) => void;
}

export interface ParallelUploadResult {
  successful: UploadResult[];
  failed: UploadResult[];
  summary: {
    total: number;
    successful: number;
    failed: number;
  };
}

/**
 * Upload multiple files in parallel with concurrency control
 *
 * @param files Array of files with their types to upload
 * @param uploadFunction Function to upload individual files
 * @param options Upload configuration options
 * @returns Promise resolving to upload results summary
 *
 * @example
 * ```typescript
 * const uploadFunction = async (file: File, type: string, onProgress?: Function) => {
 *   if (type === 'photo') {
 *     return await postService.uploadPhoto(file, onProgress);
 *   } else {
 *     return await postService.uploadVideo(file, onProgress);
 *   }
 * };
 *
 * const result = await uploadFilesInParallel(
 *   selectedFiles,
 *   uploadFunction,
 *   {
 *     maxConcurrency: 3,
 *     onProgress: (progress) => setUploadProgress(progress),
 *     onFileComplete: (result) => {
 *       if (result.success) {
 *         console.log(`Uploaded: ${result.file.name}`);
 *       }
 *     }
 *   }
 * );
 * ```
 */
export async function uploadFilesInParallel(
  files: FileUploadItem[],
  uploadFunction: (file: File, type: string, onProgress?: (progress: UploadProgress) => void) => Promise<any>,
  options: ParallelUploadOptions = {}
): Promise<ParallelUploadResult> {
  const {
    maxConcurrency = 3,
    onProgress,
    onFileComplete,
    onFileError
  } = options;

  const successful: UploadResult[] = [];
  const failed: UploadResult[] = [];
  const concurrency = Math.max(1, Math.floor(maxConcurrency));
  let completed = 0;
  const total = files.length;

  // Track progress for each file
  const fileProgress = new Map<string, number>();
  files.forEach((item, index) => {
    fileProgress.set(`file-${index}`, 0);
  });

  const updateOverallProgress = () => {
    const totalProgress = Array.from(fileProgress.values()).reduce((sum, progress) => sum + progress, 0);
    const averageProgress = files.length > 0 ? totalProgress / files.length : 0;

    if (onProgress) {
      onProgress({
        percentage: Math.round(averageProgress),
        completed,
        total
      });
    }
  };

  const uploadItem = async (item: FileUploadItem, index: number) => {
    const fileKey = `file-${index}`;

    try {
      const result = await uploadFunction(
        item.file,
        item.type,
        (progress: UploadProgress) => {
          fileProgress.set(fileKey, progress.percentage);
          updateOverallProgress();
        }
      );

      const uploadResult: UploadResult = {
        success: result.success !== false,
        fileId: result.fileId || result._id || '',
        file: item.file,
        type: item.type
      };

      if (!uploadResult.success || !uploadResult.fileId) {
        uploadResult.success = false;
        uploadResult.error = getUserFriendlyUploadErrorMessage(result.error, 'Upload failed - no file ID returned');
      }

      if (uploadResult.success) {
        successful.push(uploadResult);
      } else {
        failed.push(uploadResult);
        if (onFileError) {
          onFileError(uploadResult.error || 'Upload failed', item.file);
        }
      }

      completed++;
      if (onFileComplete) {
        onFileComplete(uploadResult);
      }

      return uploadResult;
    } catch (error) {
      const uploadResult: UploadResult = {
        success: false,
        fileId: '',
        error: getUserFriendlyUploadErrorMessage(error),
        file: item.file,
        type: item.type
      };

      failed.push(uploadResult);
      completed++;

      if (onFileError) {
        onFileError(uploadResult.error || 'Upload failed', item.file);
      }

      if (onFileComplete) {
        onFileComplete(uploadResult);
      }

      return uploadResult;
    }
  };

  // Execute uploads with concurrency control
  const results: UploadResult[] = [];
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => uploadItem(item, i + batchIndex))
    );
    results.push(...batchResults);
  }

  return {
    successful,
    failed,
    summary: {
      total,
      successful: successful.length,
      failed: failed.length
    }
  };
}

/**
 * Calculate total size of files for progress tracking
 */
export function calculateTotalFileSize(files: FileUploadItem[]): number {
  return files.reduce((total, item) => total + item.file.size, 0);
}

/**
 * Validate file types and sizes before upload
 */
export function validateFiles(files: FileUploadItem[], options: {
  maxFileSize?: number;
  allowedTypes?: string[];
} = {}): { valid: FileUploadItem[]; invalid: { file: File; error: string }[] } {
  const { maxFileSize = 100 * 1024 * 1024, allowedTypes = [] } = options; // 100MB default

  const valid: FileUploadItem[] = [];
  const invalid: { file: File; error: string }[] = [];

  files.forEach(item => {
    // Check file size
    if (item.file.size > maxFileSize) {
      invalid.push({
        file: item.file,
        error: getUserFriendlyUploadErrorMessage('file size exceeds upload size')
      });
      return;
    }

    // Check file type if specified
    if (allowedTypes.length > 0) {
      const isValidType = allowedTypes.some(type => {
        if (type.endsWith('/*')) {
          return item.file.type.startsWith(type.slice(0, -1));
        }
        return item.file.type === type;
      });

      if (!isValidType) {
        invalid.push({
          file: item.file,
          error: `File type ${item.file.type} is not allowed`
        });
        return;
      }
    }

    valid.push(item);
  });

  return { valid, invalid };
}
