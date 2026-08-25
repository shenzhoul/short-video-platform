import { INestApplication, Injectable, Logger } from "@nestjs/common";
import { AppConfigService, fileConfig } from "src/config";
import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store'
import { TusAuthService } from "src/services/tus/tus-auth.service";
import { FileService } from "src/services/file";
import { ALL_UPLOAD_REJECTION_CODES } from "src/services/file/upload-policy";

/**
 * Failures that are the uploader's to fix, and so are worth answering with.
 *
 * Every content rejection any policy can raise belongs here — a file that is not
 * a picture or not a video, one that is too many bytes, one whose resolution,
 * animation, duration, frame rate or codec is out of bounds, and an upload type
 * nothing in the registry claims. They reach the client as different
 * instructions, so losing any of them to the generic swallow below would turn
 * actionable advice into "upload failed".
 *
 * `UPLOAD_VALIDATION_BUSY` is here too, and it is the one that is *not* the
 * file's fault: it means the validator's concurrency gate was full. Swallowing
 * it would tell someone their perfectly good video is broken when the honest
 * answer is "try again in a moment".
 *
 * Taken from the policies rather than listed by hand: a new upload policy brings
 * its codes with it, and a list maintained separately is a list that will one
 * day be missing one.
 *
 * Everything else stays swallowed: the upload itself succeeded, and the retry
 * and sweep paths already cover a processing fault.
 */
const REJECTED_UPLOAD_CODES = [...ALL_UPLOAD_REJECTION_CODES, 'UPLOAD_VALIDATION_BUSY'];
import { FILE_STATUS } from "src/common/constants/content";
import * as fs from 'fs';
import * as path from 'path';
import { fromPosixPath } from "src/kernel/helpers/string.helper";

/**
 * TUS Server Service
 *
 * Handles TUS (resumable upload) server setup and integration with the file processing pipeline.
 * Provides secure, authenticated TUS uploads with proper file processing.
 */
@Injectable()
export class TusServerService {
  private readonly logger = new Logger(TusServerService.name);

  private tusServer: Server;

  private tusUploadDir: string;

  constructor(private readonly configService: AppConfigService) {
    // Load TUS upload directory from configuration and convert to platform-specific path
    this.tusUploadDir = fromPosixPath(
      this.configService.file?.tus?.uploadDir || fileConfig.tus.uploadDir
    );
    this.initializeTusServer();
  }

  /**
   * Setup TUS server routes on Express app
   */
  public setupRoutes(app: INestApplication): void {
    const expressApp = app.getHttpAdapter().getInstance();

    // Get CORS origins from environment
    const corsOrigins = process.env.CORS_ORIGIN?.split(',') || '*';

    // Add CORS middleware for TUS routes
    const addCorsHeaders = (req: any, res: any, next?: any) => {
      // Determine the correct origin to allow
      const origin = req.headers.origin;
      let allowedOrigin = '*';

      if (Array.isArray(corsOrigins)) {
        // Check if the request origin is in the allowed list
        if (corsOrigins.includes(origin)) {
          allowedOrigin = origin;
        } else if (corsOrigins.includes('*')) {
          allowedOrigin = '*';
        } else {
          allowedOrigin = corsOrigins[0]; // Fallback to first allowed origin
        }
      } else if (corsOrigins === '*' || corsOrigins === origin) {
        allowedOrigin = corsOrigins;
      }

      // Set CORS headers for TUS uploads
      res.header('Access-Control-Allow-Origin', allowedOrigin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, tus-resumable, upload-length, upload-metadata, upload-offset, upload-checksum');
      res.header('Access-Control-Expose-Headers', 'tus-resumable, tus-version, tus-max-size, tus-extension, upload-offset, upload-length, location');
      res.header('Access-Control-Allow-Credentials', 'true');

      // Handle preflight OPTIONS requests
      if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
      }

      if (next) next();
    };

    // Add TUS route to Express app with CORS
    expressApp.all('/tus-upload', (req: any, res: any) => {
      addCorsHeaders(req, res);
      this.tusServer.handle(req, res);
    });

    expressApp.all('/tus-upload/*', (req: any, res: any) => {
      addCorsHeaders(req, res);
      this.tusServer.handle(req, res);
    });
  }

  /**
     * Setup TUS server with FileService integration
     */
  public setupWithFileService(app: INestApplication): void {
    // const expressApp = app.getHttpAdapter().getInstance();

    // Create new TUS server with FileService integration
    this.tusServer = new Server({
      path: '/tus-upload',
      datastore: new FileStore({ directory: this.tusUploadDir }),
      // Only trust forwarded headers in production or when explicitly enabled
      // This prevents issues in local development without nginx proxy
      respectForwardedHeaders: process.env.TRUST_PROXY === 'true',
      maxSize: this.configService.file?.tus?.maxFileSize || fileConfig.tus.maxFileSize, // Apply TUS file size limit
      onUploadCreate: async (req, res, upload) => {
        try {
          // Validate authentication using static import
          const tusAuthService = app.get(TusAuthService);
          const tokenPayload = tusAuthService.validateTusUploadRequest(req);

          // Get FileService using static import
          const fileService = app.get(FileService);

          // Update the existing file record (created by TUS auth service) with TUS ID
          // Instead of creating a new record, we update the existing one
          const { fileId } = tokenPayload;
          await fileService.updateFileWithTusId(fileId, upload.id, upload.size);
        } catch (error) {
          this.logger.error('TUS: Authentication or file record creation failed:', error);
          // For authentication failures, throw the error to let TUS server handle it
          if (error.message.includes('token') || error.message.includes('authentication')) {
            throw error;
          }
        }

        return res;
      },
      onUploadFinish: async (_req, res, upload) => {
        try {
          // Get FileService using static import
          const fileService = app.get(FileService);

          // Process the completed upload
          await fileService.processTusUpload(upload.id, this.tusUploadDir);
        } catch (error) {
          this.logger.error('TUS: Failed to process upload:', error);

          // A file rejected for not being an image is the uploader's problem,
          // not the server's, and they are still holding the connection. Told
          // now, the composer can refuse the attachment while the person is
          // still looking at the picker; swallowed, they find out at Send —
          // after choosing a file, seeing a preview and writing a comment.
          //
          // Only this rejection is re-raised. A genuine processing failure is
          // still absorbed, because the upload itself did succeed and the
          // existing retry and sweep paths already cover it.
          if (this.isRejectedContent(error)) {
            // The record and its bytes are already gone; nothing to mark.
            await this.cleanupTusUploadFiles(upload.id).catch(() => undefined);
            throw this.asTusError(error);
          }

          await this.handleUploadError(app, upload.id, error);
        }

        return res;
      }
    });

    // Setup routes
    this.setupRoutes(app);
  }

  /**
   * Initialize TUS server with file processing integration
   */
  private initializeTusServer(): void {
    // Ensure tus-uploads directory exists using platform-specific path
    const platformTusUploadDir = fromPosixPath(this.tusUploadDir);
    if (!fs.existsSync(platformTusUploadDir)) {
      fs.mkdirSync(platformTusUploadDir, { recursive: true });
    }

    this.tusServer = new Server({
      path: '/tus-upload',
      // Only trust forwarded headers in production or when explicitly enabled
      // This prevents issues in local development without nginx proxy
      respectForwardedHeaders: process.env.TRUST_PROXY === 'true',
      datastore: new FileStore({ directory: platformTusUploadDir }),
      maxSize: this.configService.file?.tus?.maxFileSize || fileConfig.tus.maxFileSize, // Apply TUS file size limit
      onUploadCreate: this.handleUploadCreate.bind(this),
      onUploadFinish: this.handleUploadFinish.bind(this)
    });
  }

  /**
  * Handle TUS upload errors - update file status and cleanup
  */
  /**
   * Restate a rejection in the shape the TUS server serialises.
   *
   * `@tus/server` reads `status_code` and `body` off the thrown error and falls
   * back to a generic 500 with the message appended when they are absent. A
   * NestJS `HttpException` has neither, so without this the client received
   * "Something went wrong with that request" — no status worth acting on and no
   * code to match, which is exactly what the stable code exists to avoid.
   */
  private asTusError(error: any): any {
    const body = typeof error?.getResponse === 'function' ? error.getResponse() : error?.response;
    const payload = typeof body === 'object' && body !== null ? body : { message: String(error?.message || error) };
    const rejection: any = new Error(payload.message || 'Invalid image');
    rejection.status_code = payload.statusCode || 400;
    rejection.body = JSON.stringify(payload);
    return rejection;
  }

  /**
   * Whether this failure means "that was not an image".
   *
   * Matched on the stable code rather than the message, so the text can be
   * reworded or translated without quietly turning a rejection back into a
   * swallowed error.
   */
  private isRejectedContent(error: any): boolean {
    const body = typeof error?.getResponse === 'function' ? error.getResponse() : error?.response;
    const code = body?.error || error?.error;
    return REJECTED_UPLOAD_CODES.includes(code);
  }

  private async handleUploadError(app: INestApplication, tusId: string, error: any): Promise<void> {
    try {
      // Get FileService using static import
      const fileService = app.get(FileService);

      // Update file status to error
      await fileService.updateFileStatusByTusId(tusId, FILE_STATUS.ERROR, {
        processingError: {
          message: error.message,
          stack: error.stack,
          timestamp: new Date(),
          stage: 'tus-upload'
        }
      });

      // Clean up TUS upload files
      await this.cleanupTusUploadFiles(tusId);
    } catch (cleanupError) {
      this.logger.error(`TUS: Failed to handle upload error for ${tusId}:`, cleanupError);
    }
  }

  /**
   * Handle TUS upload creation
   */
  // eslint-disable-next-line no-unused-vars
  private async handleUploadCreate(_req: any, res: any, _upload: any): Promise<any> {
    try {
      // Note: FileService integration will be handled when this service is used
    } catch (error) {
      this.logger.error('TUS: Failed to create pending file record:', error);
    }

    return res;
  }

  /**
   * Handle TUS upload completion
   */
  // eslint-disable-next-line no-unused-vars
  private async handleUploadFinish(_req: any, res: any, _upload: any): Promise<any> {
    return res;
  }

  /**
   * Clean up TUS upload files for a specific upload ID
   */
  private async cleanupTusUploadFiles(tusId: string): Promise<void> {
    try {
      // Use platform-specific paths for file operations
      const platformTusUploadDir = fromPosixPath(this.tusUploadDir);
      const uploadFilePath = path.join(platformTusUploadDir, tusId);
      const infoFilePath = path.join(platformTusUploadDir, `${tusId}.info`);

      // Remove upload file if exists - don't throw error if already deleted
      try {
        if (fs.existsSync(uploadFilePath)) {
          fs.unlinkSync(uploadFilePath);
        }
      } catch (error) {
        this.logger.warn(`TUS: Failed to delete upload file ${uploadFilePath}:`, error.message);
      }

      // Remove info file if exists - don't throw error if already deleted
      try {
        if (fs.existsSync(infoFilePath)) {
          fs.unlinkSync(infoFilePath);
        }
      } catch (error) {
        this.logger.warn(`TUS: Failed to delete info file ${infoFilePath}:`, error.message);
      }

      // Check if TUS upload directory is empty and remove if so
      // (but don't remove the main tus-uploads directory itself)
      try {
        await this.removeEmptyTusDirectories();
      } catch (error) {
        this.logger.warn('TUS: Failed to remove empty directories:', error.message);
      }
    } catch (error) {
      this.logger.error(`TUS: Failed to cleanup files for ${tusId}:`, error);
    }
  }

  /**
   * Remove empty TUS directories (but preserve the main tus-uploads directory)
   */
  private async removeEmptyTusDirectories(): Promise<void> {
    try {
      // Only check subdirectories within tus-uploads, not the main directory itself
      // Use platform-specific path for directory operations
      const platformTusUploadDir = fromPosixPath(this.tusUploadDir);
      const files = fs.readdirSync(platformTusUploadDir);

      // If there are any files or directories, don't remove anything
      if (files.length > 0) {
        return;
      }

      // The tus-uploads directory is empty, but we should keep it
      // as it's the main storage directory for TUS uploads
      // this.logger.log('TUS upload directory is empty but preserving it for future uploads');
    } catch (error) {
      this.logger.warn(`Failed to check TUS directories: ${error.message}`);
    }
  }
}