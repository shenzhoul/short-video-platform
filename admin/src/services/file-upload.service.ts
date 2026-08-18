import * as tus from 'tus-js-client';
import { APIRequest } from "@services/api-request";

/**
 * File Upload Service
 *
 * Provides a comprehensive file upload service that integrates with the file server.
 * Supports both TUS (resumable) and normal uploads with progress tracking and error handling.
 *
 * Features:
 * - Get upload URLs from the file server
 * - Upload files with progress tracking
 * - Support for both TUS and normal uploads
 * - Automatic retry on failure
 * - File validation and error handling
 * - Reusable across different components
 *
 * @author ShenZhoul
 * @version 1.0.0
 */

export interface UploadUrlOptions {
  /** Original filename */
  filename: string;

  /** File size in bytes (required for TUS uploads) */
  fileSize?: number;

  /** Upload method - 'tus' or 'normal' */
  uploadType?: 'tus' | 'normal';

  /** File type category */
  type?: string;

  /** Access control level */
  acl?: 'public-read' | 'private' | 'authenticated-read';

  /** Additional metadata */
  metadata?: Record<string, any>;
}

export interface UploadUrlResponse {
  /**
   * determined upload type - 'tus' or 'normal', default system will pick tus
   */
  uploadType?: 'tus' | 'normal';

  /** URL for uploading the file */
  uploadUrl?: string;

  tusUploadUrl?: string;

  /** Generated file ID */
  fileId: string;

  /** Upload method used */
  uploadMethod: 'tus' | 'normal';

  /** JWT token for upload authentication */
  token: string;

  /** Form field name for the file (for normal uploads) */
  fieldName?: string;

  /** Additional form fields required for upload (for normal uploads) */
  fields?: Record<string, string>;

  /** Token expiration time in seconds */
  expiresIn: number;

  /** TUS token for authentication */
  tusToken?: string;

  /** TUS-specific upload information */
  tusInfo?: {
    location: string;
    uploadId: string;
    chunkSize: number;
    tusVersion: string;
    tusExtensions: string[];
    uploadExpires?: string;
  };
}

export interface UploadProgress {
  /** Bytes uploaded */
  loaded: number;

  /** Total bytes to upload */
  total: number;

  /** Upload percentage (0-100) */
  percentage: number;

  /** Upload speed in bytes per second */
  speed?: number;

  /** Estimated time remaining in seconds */
  timeRemaining?: number;
}

export interface UploadResult {
  /** Success status */
  success: boolean;

  /** File ID from the server */
  _id: string;

  /** File ID from the server */
  fileId: string;

  /** File information */
  fileInfo?: {
    _id: string;
    fileId: string;
    name: string;
    size: number;
    type: string;
    url?: string;
  };

  url?: string;

  /** Error message if upload failed */
  error?: string;
}

export class FileUploadService extends APIRequest {
  /**
   * Get upload URL for file upload
   *
   * Requests a secure upload URL from the server for file uploads.
   * The URL can be used to upload files directly to the file server.
   *
   * @param endpoint - API endpoint to get upload URL from
   * @param options - Upload configuration options
   * @returns Promise resolving to upload URL data
   */
  async getUploadUrl(endpoint: string, options: UploadUrlOptions): Promise<UploadUrlResponse> {
    try {
      const response = await this.post(endpoint, options);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get upload URL: ${error.message}`);
    }
  }

  /**
   * Upload file using normal (non-resumable) method
   *
   * Uploads a file using the standard multipart/form-data method.
   * Suitable for smaller files that don't require resumable upload.
   *
   * @param uploadData - Upload URL data from getUploadUrl
   * @param file - File to upload
   * @param onProgress - Progress callback function
   * @returns Promise resolving to upload result
   */
  async uploadFileNormal(
    uploadData: UploadUrlResponse,
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    try {
      const formData = new FormData();

      // Add form fields if provided
      if (uploadData.fields) {
        Object.entries(uploadData.fields).forEach(([key, value]) => {
          formData.append(key, value);
        });
      }

      // Add the token as a form field (required by file-server)
      if (uploadData.token) {
        formData.append('token', uploadData.token);
      }

      // Add the file
      const fieldName = uploadData.fieldName || 'file';
      formData.append(fieldName, file);

      // Headers for the request
      const headers: Record<string, string> = {};

      const response = await this.uploadWithProgress(
        uploadData.uploadUrl!,
        formData,
        {
          headers,
          onProgress: (progressEvent) => {
            if (onProgress && progressEvent.total) {
              const progress: UploadProgress = {
                loaded: progressEvent.loaded,
                total: progressEvent.total,
                percentage: Math.round((progressEvent.loaded / progressEvent.total) * 100)
              };
              onProgress(progress);
            }
          }
        }
      );
      const responseBody = response.data;
      if (responseBody?.success === false) {
        throw new Error(responseBody.error || responseBody.message || 'Upload failed');
      }

      return {
        success: true,
        _id: uploadData.fileId,
        fileId: uploadData.fileId,
        fileInfo: {
          _id: uploadData.fileId,
          fileId: uploadData.fileId,
          name: file.name,
          size: file.size,
          type: file.type,
          ...(responseBody?.data || {})
        }
      };
    } catch (error) {
      return {
        success: false,
        _id: uploadData.fileId,
        fileId: uploadData.fileId,
        error: error.message || 'Upload failed'
      };
    }
  }

  /**
   * Upload file using TUS (resumable) method with tus-js-client
   *
   * Uploads a file using the TUS protocol for resumable uploads.
   * Uses the official tus-js-client library for better reliability and features.
   *
   * @param uploadData - Upload URL data from getUploadUrl
   * @param file - File to upload
   * @param onProgress - Progress callback function
   * @returns Promise resolving to upload result
   */
  async uploadFileTus(
    uploadData: UploadUrlResponse,
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    return new Promise((resolve) => {
      try {
        // Check if we have TUS upload URL (new API format)
        if (!uploadData.tusUploadUrl && !uploadData.uploadUrl) {
          resolve({
            success: false,
            _id: uploadData.fileId,
            fileId: uploadData.fileId,
            error: 'TUS upload URL not provided'
          });
          return;
        }

        // Prepare metadata
        const metadata = {
          filename: file.name,
          filetype: file.type,
          fileId: uploadData.fileId
        };

        // Add custom metadata if provided from tusInfo (legacy format)
        if (uploadData.tusInfo?.uploadId) {
          metadata['uploadId'] = uploadData.tusInfo.uploadId;
        }

        // Determine the authentication token to use
        const authToken = uploadData.tusToken || uploadData.token;

        const endpoint = uploadData.tusUploadUrl || uploadData.uploadUrl;

        // Create TUS upload instance
        const upload = new tus.Upload(file, {
          endpoint,
          retryDelays: [0, 3000, 5000, 10000, 20000], // Retry delays in milliseconds
          chunkSize: uploadData.tusInfo?.chunkSize || 1024 * 1024 * 5, // Default 5MB chunks
          metadata,
          headers: {
            'Authorization': `Bearer ${authToken}`
          },
          // Disable resume functionality to prevent protocol issues from cached URLs
          storeFingerprintForResuming: false,
          removeFingerprintOnSuccess: true,

          // Progress callback
          onProgress: (bytesUploaded: number, bytesTotal: number) => {
            if (onProgress) {
              const percentage = Math.round((bytesUploaded / bytesTotal) * 100);
              const progress: UploadProgress = {
                loaded: bytesUploaded,
                total: bytesTotal,
                percentage
              };
              onProgress(progress);
            }
          },

          // Success callback
          onSuccess: () => {
            resolve({
              success: true,
              _id: uploadData.fileId,
              fileId: uploadData.fileId,
              fileInfo: {
                _id: uploadData.fileId,
                fileId: uploadData.fileId,
                name: file.name,
                size: file.size,
                type: file.type
              }
            });
          },

          // Error callback
          onError: (error: Error) => {
            resolve({
              success: false,
              _id: uploadData.fileId,
              fileId: uploadData.fileId,
              error: error.message || 'TUS upload failed'
            });
          },

          // Chunk complete callback (optional, for debugging)
          onChunkComplete: (chunkSize: number, bytesAccepted: number, bytesTotal: number) => {
            console.log(`TUS chunk complete: ${chunkSize} bytes, ${bytesAccepted}/${bytesTotal} total`);
          }
        });

        // Start the upload
        upload.start();

        // Store upload instance for potential pause/resume functionality
        (upload as any)._uploadInstance = upload;

      } catch (error) {
        resolve({
          success: false,
          _id: uploadData.fileId,
          fileId: uploadData.fileId,
          error: error instanceof Error ? error.message : 'TUS upload failed'
        });
      }
    });
  }

  /**
     * Complete file upload workflow
     *
     * Performs the complete upload workflow:
     * 1. Get upload URL from server
     * 2. Upload file using appropriate method
     * 3. Return result with file ID
     *
     * @param endpoint - API endpoint to get upload URL from
     * @param file - File to upload
     * @param options - Upload configuration options
     * @param onProgress - Progress callback function
     * @returns Promise resolving to upload result
     */
  async uploadFile(
    endpoint: string,
    file: File,
    options: Omit<UploadUrlOptions, 'filename' | 'fileSize'> = {},
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    try {
      // Step 1: Get upload URL
      const uploadOptions: UploadUrlOptions = {
        filename: file.name,
        fileSize: file.size,
        ...options
      };

      const uploadData = await this.getUploadUrl(endpoint, uploadOptions);

      // Determine upload method based on response or options
      let method = uploadData.uploadType || options.uploadType || 'tus';

      // Auto-detect TUS if tusUploadUrl is present
      if (uploadData.tusUploadUrl && !uploadData.uploadUrl) {
        method = 'tus';
      }

      // Step 2: Upload file using appropriate method
      if (method === 'tus') {
        return await this.uploadFileTus(uploadData, file, onProgress);
      } else {
        return await this.uploadFileNormal(uploadData, file, onProgress);
      }
    } catch (error) {
      return {
        success: false,
        _id: '',
        fileId: '',
        error: error.message || 'Upload workflow failed'
      };
    }
  }

  /**
   * Upload with progress tracking (for normal uploads)
   *
   * @private
   */
  private async uploadWithProgress(
    url: string,
    data: FormData,
    options: {
      headers?: Record<string, string>;
      onProgress?: (progressEvent: { loaded: number; total?: number }) => void;
    } = {}
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Set up progress tracking
      if (options.onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            options.onProgress!({
              loaded: event.loaded,
              total: event.total
            });
          }
        });
      }

      // Set up response handling
      xhr.addEventListener('load', () => {
        let response: any = xhr.responseText;
        try {
          response = JSON.parse(xhr.responseText);
        } catch {
          // Keep raw response text for non-JSON responses.
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          if (response?.success === false) {
            reject(new Error(response.error || response.message || 'Upload failed'));
            return;
          }

          resolve({ data: response });
        } else {
          const message = response?.message || response?.error || xhr.statusText;
          reject(new Error(`HTTP ${xhr.status}: ${message}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error occurred'));
      });

      // Open and send request
      xhr.open('POST', url);

      // Set headers
      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          xhr.setRequestHeader(key, value);
        });
      }

      xhr.send(data);
    });
  }
}

export const fileUploadService = new FileUploadService();
