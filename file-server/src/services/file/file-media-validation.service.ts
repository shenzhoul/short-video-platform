import { HttpException, Injectable, Logger } from '@nestjs/common';
import { existsSync, unlinkSync } from 'fs';

import {
  IMAGE_MIME_TYPES,
  isValidImageMimeType,
  isValidVideoMimeType,
  VIDEO_MIME_TYPES
} from '../../lib/file-type';

/**
 * Service for validating media type consistency between user selection and actual file MIME type
 */
@Injectable()
export class FileMediaValidationService {
  private readonly logger = new Logger(FileMediaValidationService.name);

  /**
   * Validates that the uploaded file's MIME type matches the selected mediaType
   * Also cleans up the uploaded file if validation fails
   *
   * @param selectedMediaType - The mediaType selected by the user ('image' or 'video')
   * @param actualMimeType - The actual MIME type detected from the uploaded file
   * @param filename - The filename for error reporting
   * @param filePath - Optional path to the uploaded file for cleanup on validation failure
   * @throws HttpException if validation fails (after cleaning up the file)
   */
  public validateMediaTypeConsistency(
    selectedMediaType: string,
    actualMimeType: string,
    filename: string,
    filePath?: string
  ): void {
    // Only validate for image and video mediaTypes
    if (!['image', 'video', 'audio'].includes(selectedMediaType)) {
      return; // Skip validation for document, file, etc.
    }

    const isValidImage = isValidImageMimeType(actualMimeType);
    const isValidVideo = isValidVideoMimeType(actualMimeType);

    let validationError: string | null = null;

    if (selectedMediaType === 'image' && !isValidImage) {
      validationError = `Media type validation failed: Selected 'image' but uploaded file '${filename}' has MIME type '${actualMimeType}'. Expected image formats: ${IMAGE_MIME_TYPES.join(', ')}`;
    } else if (selectedMediaType === 'video' && !isValidVideo) {
      validationError = `Media type validation failed: Selected 'video' but uploaded file '${filename}' has MIME type '${actualMimeType}'. Expected video formats: ${VIDEO_MIME_TYPES.join(', ')}`;
    } else if (selectedMediaType === 'image' && isValidVideo) {
      validationError = `Media type validation failed: Selected 'image' but uploaded file '${filename}' is a video file (${actualMimeType}). Please select 'video' as the media type.`;
    } else if (selectedMediaType === 'video' && isValidImage) {
      validationError = `Media type validation failed: Selected 'video' but uploaded file '${filename}' is an image file (${actualMimeType}). Please select 'image' as the media type.`;
    }

    // If validation failed, clean up the file and throw error
    if (validationError) {
      this.cleanupInvalidFile(filePath, filename);
      throw new HttpException(validationError, 400);
    }
  }

  /**
   * Check if a MIME type is a valid image type
   *
   * @param mimeType - MIME type to check
   * @returns true if it's a valid image MIME type
   */
  public isValidImageMimeType(mimeType: string): boolean {
    return isValidImageMimeType(mimeType);
  }

  /**
   * Check if a MIME type is a valid video type
   *
   * @param mimeType - MIME type to check
   * @returns true if it's a valid video MIME type
   */
  public isValidVideoMimeType(mimeType: string): boolean {
    return isValidVideoMimeType(mimeType);
  }

  /**
   * Get supported MIME types for a given mediaType
   *
   * @param mediaType - The media type ('image' or 'video')
   * @returns Array of supported MIME types
   */
  public getSupportedMimeTypes(mediaType: string): string[] {
    switch (mediaType) {
      case 'image':
        return [...IMAGE_MIME_TYPES];
      case 'video':
        return [...VIDEO_MIME_TYPES];
      default:
        return [];
    }
  }

  /**
   * Clean up uploaded file when validation fails
   *
   * @param filePath - Path to the uploaded file
   * @param filename - Filename for logging
   */
  private cleanupInvalidFile(filePath?: string, filename?: string): void {
    if (filePath && existsSync(filePath)) {
      try {
        unlinkSync(filePath);
        this.logger.warn(`Cleaned up invalid file: ${filename} at ${filePath}`);
      } catch (error) {
        this.logger.error(`Failed to cleanup invalid file: ${filename} at ${filePath}`, error);
      }
    }
  }
}
