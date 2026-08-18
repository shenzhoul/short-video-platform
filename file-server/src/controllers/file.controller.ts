import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { AppConfigService, fileConfig } from "src/config";
import { FileService } from "src/services";
import { v4 as uuidv4 } from 'uuid';
import * as jwt from 'jsonwebtoken';
import { extname } from 'path';
import { diskStorage } from 'multer';
import { IMulterUploadedFile } from "src/common/lib/file/multer/multer.utils";
import { FILE_STATUS } from "src/common/constants/content";
import { DataResponse, PublicFileUploadResponseDto } from "src/dtos";
import { isImage, isVideo } from "src/lib/file-type";
import { unlink } from 'fs/promises'

/**
 * External File Controller
 * Handles public file operations including file uploads
 */
@ApiTags('Files')
@Controller('files')
export class FileController {
  private readonly logger = new Logger(FileController.name);

  constructor(
    private readonly fileService: FileService,
    private readonly configService: AppConfigService
  ) { }

  /**
   * Upload file using token from generate-upload-url
   */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Upload file',
    description: 'Upload a file using the token received from generate-upload-url endpoint'
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 200,
    description: 'File uploaded successfully',
    type: PublicFileUploadResponseDto
  })
  @ApiResponse({ status: 400, description: 'Bad request - invalid token or missing file' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, process.env.FILE_TEMP_DIR || fileConfig.tempDir);
        },
        filename: (_req, file, cb) => {
          // Generate UUID-based filename with original extension
          const uuid = uuidv4();
          const extension = extname(file.originalname);
          cb(null, `${uuid}${extension}`);
        }
      }),
      limits: {
        fileSize: fileConfig.limits.default // Use static config since 'this' is not available in decorators
      }
    })
  )
  async uploadFile(
    @Body('token') uploadToken: string,
    @UploadedFile() file: IMulterUploadedFile
  ) {
    try {
      if (!file) {
        throw new BadRequestException('No file uploaded');
      }

      if (!uploadToken) {
        // Clean up the uploaded file before throwing error
        await this.cleanupUploadedFile(file.path);
        throw new BadRequestException('Upload token is required');
      }

      // Validate file size based on file type
      const fileSizeLimit = this.getFileSizeLimit(file);
      if (file.size > fileSizeLimit) {
        // Clean up the uploaded file before throwing error
        await this.cleanupUploadedFile(file.path);
        throw new BadRequestException(
          `File size exceeds limit. Maximum allowed size for ${this.getFileTypeLabel(file)} files is ${Math.round(fileSizeLimit / (1024 * 1024))}MB`
        );
      }

      // Validate and decode upload token
      const tokenPayload = this.validateUploadToken(uploadToken);
      const fileDB = await this.fileService.findById(tokenPayload.fileId);
      if (!fileDB) {
        // Clean up the uploaded file before throwing error
        await this.cleanupUploadedFile(file.path);
        throw new BadRequestException('Invalid upload token: file not found');
      }
      if (fileDB.status !== FILE_STATUS.PENDING) {
        // Clean up the uploaded file before throwing error
        await this.cleanupUploadedFile(file.path);
        throw new BadRequestException('File is already being processed');
      }

      // Update file status to 'uploaded' before processing
      await this.fileService.updateFileStatus(tokenPayload.fileId, FILE_STATUS.UPLOADED);

      // Process the uploaded file
      await this.fileService.processUploadedFile(
        tokenPayload.fileId,
        file,
        {
          fileKey: tokenPayload.fileKey,
          acl: tokenPayload.acl,
          processingOptions: fileDB.metadata?.processingOptions || tokenPayload.processingOptions
        }
      );
      const results = await this.fileService.findById(tokenPayload.fileId);
      return DataResponse.ok(await results.toPublicResponse({ canView: true }));
    } catch (error) {
      // Clean up uploaded file on any error
      if (file?.path) {
        await this.cleanupUploadedFile(file.path);
      }

      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(error.message || 'Upload failed');
    }
  }

  /**
  * Clean up uploaded file when validation fails or errors occur
  */
  private async cleanupUploadedFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      // Log but don't throw - cleanup failure shouldn't prevent error response
      this.logger.warn(`Failed to cleanup uploaded file: ${filePath}`, error);
    }
  }

  /**
   * Get file size limit based on file type using proper file type detection
   */
  private getFileSizeLimit(file: IMulterUploadedFile): number {
    const config = this.configService.file.limits;

    if (isImage(file)) {
      return config.image;
    }
    if (isVideo(file)) {
      return config.video;
    }

    return config.default;
  }

  /**
   * Get human-readable file type label for error messages
   */
  private getFileTypeLabel(file: IMulterUploadedFile): string {
    if (isImage(file)) {
      return 'image';
    }
    if (isVideo(file)) {
      return 'video';
    }

    return 'file';
  }

  /**
   * Validate upload token and extract payload
   */
  private validateUploadToken(token: string) {
    try {
      const secret = this.configService.auth.jwtSecret;
      const payload = jwt.verify(token, secret) as any;

      if (!payload.fileId || !payload.fileKey) {
        throw new Error('Invalid token payload');
      }

      return {
        fileId: payload.fileId,
        fileKey: payload.fileKey,
        acl: payload.acl || 'private',
        processingOptions: payload.processingOptions
      };
    } catch {
      throw new BadRequestException('Invalid upload token');
    }
  }
}
