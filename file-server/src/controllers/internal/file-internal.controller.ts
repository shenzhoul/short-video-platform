import {
  Body,
  BadRequestException,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Get
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { InternalApiGuard } from 'src/common/guards/internal-api.guard';
import {
  DataResponse,
  FileInfoResponseDto,
  SignedUploadRequestDto,
  UpdateFileOwnershipDto,
  UpdateFileOwnershipResponseDto
} from 'src/dtos';
import { FileService } from 'src/services/file';
import { TusAuthService } from 'src/services/tus';

/**
 * Internal File Controller
 *
 * Provides internal API endpoints for file management operations.
 * All endpoints require authentication via API key or JWT token.
 *
 * Features:
 * - Generate signed upload URLs for secure file uploads
 * - Retrieve file information and metadata
 * - Generate signed download URLs
 * - Delete files and cleanup storage
 * - Support for different file types (image, video, document)
 */
@Controller('internal/files')
@UseGuards(InternalApiGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class FileInternalController {
  constructor(
    private readonly fileService: FileService,
    private readonly tusAuthService: TusAuthService
  ) { }

  /**
   * Generate signed upload URL
   *
   * Creates a secure upload URL that clients can use to upload files.
   * Pre-creates a file record with pending status.
   *
   * @param payload - Upload request parameters
   * @returns Signed upload URL and file ID
   */
  @Post('direct-upload-link')
  @HttpCode(HttpStatus.OK)
  async generateUploadUrl(@Body() payload: SignedUploadRequestDto) {
    try {
      const result = await this.fileService.generateSignedUploadUrl({
        mediaType: payload.mediaType,
        type: payload.type,
        filename: payload.filename,
        acl: payload.acl,
        contentType: payload.contentType,
        processingOptions: payload.processingOptions,
        metadata: payload.metadata,
        createdBy: payload.createdBy,
        updatedBy: payload.updatedBy
      });

      return DataResponse.ok(result);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(error.message || 'Failed to generate upload URL');
    }
  }

  /**
   * Generate TUS upload URL for resumable uploads
   *
   * Creates a secure TUS upload URL with authentication token for resumable file uploads.
   * Similar to generate-upload-url but for TUS protocol.
   *
   * @param payload - TUS upload request parameters
   * @returns TUS upload URL and authentication token
   */
  @Post('tus-upload-url')
  @HttpCode(HttpStatus.OK)
  async generateTusUploadUrl(@Body() payload: SignedUploadRequestDto) {
    try {
      const result = await this.tusAuthService.generateTusUploadUrl({
        filename: payload.filename,
        mediaType: payload.mediaType,
        type: payload.type,
        size: 0, // Size will be provided in TUS Upload-Length header
        acl: payload.acl,
        processingOptions: payload.processingOptions,
        metadata: payload.metadata,
        createdBy: payload.createdBy || null,
        updatedBy: payload.updatedBy || null
      });

      return DataResponse.ok(result);
    } catch (error) {
      return DataResponse.error(error.message);
    }
  }

  /**
   * Delete multiple files by IDs in batch (alias for delete-many)
   *
   * @param payload - Array of file IDs to delete
   * @returns Deletion results
   */
  @Post('batch-delete')
  @HttpCode(HttpStatus.OK)
  async batchDelete(@Body() payload: { fileIds: string[] }) {
    try {
      const result = await this.fileService.deleteManyByIds(payload.fileIds);
      return DataResponse.ok(result);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(error.message || 'Failed to delete files in batch');
    }
  }

  /**
   * Get file information by multiple IDs
   *
   * @param payload - Object containing array of file IDs and return format option
   * @returns File information for multiple files (array or object format)
   */
  @Post('find-by-ids')
  @HttpCode(HttpStatus.OK)
  async findByIds(@Body() payload: { fileIds: string[]; returnAsObject?: boolean }) {
    try {
      const { fileIds, returnAsObject = false } = payload;

      if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
        return DataResponse.error('fileIds must be a non-empty array');
      }

      const files = await this.fileService.findFilesByIds(fileIds);
      const validFiles = files.filter((file) => file !== null && file !== undefined);

      const fileInfosPromises = validFiles.map(async (file) => {
        const [url, thumbnails, blurImage] = await Promise.all([
          file.getUrl(true),
          file.getThumbnails(),
          file.getBlurImage()
        ]);

        const fileInfo: FileInfoResponseDto = {
          _id: file._id.toString(),
          type: file.type,
          name: file.name,
          mimeType: file.mimeType,
          size: file.fileSize,
          width: file.width,
          height: file.height,
          duration: file.duration,
          status: file.status,
          processingStatus: file.processingStatus,
          url,
          thumbnails,
          blurImage,
          metadata: file.metadata,
          refItems: file.refItems.map((ref) => ({
            itemId: ref.itemId.toString(),
            itemType: ref.itemType
          })),
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          createdBy: file.createdBy?.toString() || null,
          updatedBy: file.updatedBy?.toString() || null
        };

        return fileInfo;
      });

      const fileInfos = await Promise.all(fileInfosPromises);
      const fileInfoMap: Record<string, FileInfoResponseDto> = {};
      fileInfos.forEach((fileInfo) => {
        fileInfoMap[fileInfo._id] = fileInfo;
      });

      if (returnAsObject) {
        return DataResponse.ok(fileInfoMap);
      }
      return DataResponse.ok(fileInfos);
    } catch (error) {
      return DataResponse.error(error.message);
    }
  }

  /**
   * Add reference to a file
   *
   * @param fileId - File ID
   * @param payload - Reference information
   * @returns Success result
   */
  @Post(':fileId/add-ref')
  @HttpCode(HttpStatus.OK)
  async addRef(
    @Param('fileId') fileId: string,
    @Body() payload: { itemId: string; itemType: string }
  ) {
    try {
      await this.fileService.addRef(fileId, {
        itemId: new ObjectId(payload.itemId),
        itemType: payload.itemType
      });
      return DataResponse.ok({ message: 'Reference added successfully' });
    } catch (error) {
      return DataResponse.error(error.message || 'Failed to add reference');
    }
  }

  /**
   * Add references to multiple files in batch
   *
   * @param payload - Array of file references
   * @returns Success result
   */
  @Post('batch-add-ref')
  @HttpCode(HttpStatus.OK)
  async addRefBatch(@Body() payload: {
    fileRefs: Array<{
      fileId: string;
      ref: { itemId: string; itemType: string };
    }>;
  }) {
    try {
      const fileRefs = payload.fileRefs.map((fileRef) => ({
        fileId: fileRef.fileId,
        ref: {
          itemId: new ObjectId(fileRef.ref.itemId),
          itemType: fileRef.ref.itemType
        }
      }));

      await this.fileService.addRefBatch(fileRefs);
      return DataResponse.ok({
        message: 'References added successfully',
        count: fileRefs.length
      });
    } catch (error) {
      return DataResponse.error(error.message || 'Failed to add references in batch');
    }
  }

  /**
   * Add same reference to multiple files
   *
   * @param payload - File IDs and reference information
   * @returns Success result
   */
  @Post('add-ref-to-multiple-files')
  @HttpCode(HttpStatus.OK)
  async addRefToMultipleFiles(@Body() payload: {
    fileIds: string[];
    ref: { itemId: string; itemType: string };
  }) {
    try {
      await this.fileService.addRefToMultipleFiles(
        payload.fileIds,
        {
          itemId: new ObjectId(payload.ref.itemId),
          itemType: payload.ref.itemType
        }
      );
      return DataResponse.ok({
        message: 'Reference added to multiple files successfully',
        count: payload.fileIds.length
      });
    } catch (error) {
      return DataResponse.error(error.message || 'Failed to add reference to multiple files');
    }
  }

  /**
  * Remove unused files by types
  *
  * @param payload - File types and time threshold
  * @returns Success result
  */
  @Post('remove-unused-files')
  @HttpCode(HttpStatus.OK)
  async removeUnusedFilesByTypes(@Body() payload: {
    types: string[];
    timeInHours?: number;
  }) {
    try {
      const { types, timeInHours = 4 } = payload;
      await this.fileService.removeUnusedFilesByTypes(types, timeInHours);
      return DataResponse.ok({ message: 'Unused files removed successfully' });
    } catch (error) {
      return DataResponse.error(error.message || 'Failed to remove unused files');
    }
  }

  /**
   * Get file information by ID
   *
   * @param fileId - File ID to retrieve
   * @returns File information with metadata
   */
  @Get(':fileId')
  @HttpCode(HttpStatus.OK)
  async findById(@Param('fileId') fileId: string) {
    try {
      const file = await this.fileService.findById(fileId);
      if (!file) {
        return DataResponse.error('File not found');
      }

      const fileInfo: FileInfoResponseDto = {
        _id: file._id.toString(),
        type: file.type,
        name: file.name,
        mimeType: file.mimeType,
        size: file.fileSize,
        width: file.width,
        height: file.height,
        duration: file.duration,
        status: file.status,
        processingStatus: file.processingStatus,
        url: await file.getUrl(true),
        thumbnails: await file.getThumbnails(),
        blurImage: await file.getBlurImage(),
        metadata: file.metadata,
        refItems: file.refItems.map((ref) => ({
          itemId: ref.itemId.toString(),
          itemType: ref.itemType
        })),
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
        createdBy: file.createdBy?.toString() || null,
        updatedBy: file.updatedBy?.toString() || null
      };

      return DataResponse.ok(fileInfo);
    } catch (error) {
      return DataResponse.error(error.message);
    }
  }

  /**
   * Update file ownership (createdBy and updatedBy) for single or multiple files
   *
   * This endpoint allows updating the ownership of files, which is useful for scenarios like:
   * - Updating placeholder ownership after user registration
   * - Transferring file ownership between users
   * - Bulk ownership updates for administrative purposes
   *
   * @param payload - File ownership update request
   * @returns Update result with success/failure details
   */
  @Post('update-ownership')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async updateFileOwnership(@Body() payload: UpdateFileOwnershipDto): Promise<DataResponse<UpdateFileOwnershipResponseDto>> {
    try {
      let result: UpdateFileOwnershipResponseDto;

      // Convert ref if provided
      const ref = payload.ref ? {
        itemId: new ObjectId(payload.ref.itemId),
        itemType: payload.ref.itemType
      } : undefined;

      // Single file update
      if (payload.fileId) {
        const singleResult = await this.fileService.updateFileOwnership(
          payload.fileId,
          {
            createdBy: payload.createdBy,
            updatedBy: payload.updatedBy,
            ref
          },
          payload.currentCreatedBy
        );

        result = {
          updated: singleResult.updated ? 1 : 0,
          updatedFileIds: singleResult.updated ? [singleResult.fileId] : [],
          errors: singleResult.updated ? [] : [{ fileId: singleResult.fileId, error: 'File not found or no changes made' }],
          message: singleResult.updated ? 'File ownership updated successfully' : 'No files were updated'
        };
      } else if (payload.fileIds && payload.fileIds.length > 0) { // Multiple files update
        const multiResult = await this.fileService.updateMultipleFileOwnership(
          payload.fileIds,
          {
            createdBy: payload.createdBy,
            updatedBy: payload.updatedBy,
            ref
          },
          payload.currentCreatedBy
        );

        result = {
          updated: multiResult.updated,
          updatedFileIds: multiResult.updatedFileIds,
          errors: multiResult.errors,
          message: `${multiResult.updated} files updated successfully`
        };
      } else {
        return DataResponse.error('Either fileId or fileIds must be provided');
      }

      return DataResponse.ok(result);
    } catch (error) {
      return DataResponse.error(error.message || 'Failed to update file ownership');
    }
  }
}
