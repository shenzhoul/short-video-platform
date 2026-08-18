import {
  HttpException, Injectable, Logger,
  OnModuleInit
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  existsSync, promises as fsPromises
} from 'fs';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import {
  join
} from 'path';
import {
  FILE_STATUS,
  PROCESSING_STATUS
} from 'src/common/constants/content';
import { DBLoggerService } from 'src/common/lib/logger';
import { AppConfigService } from 'src/config/config.service';
import { FileDto } from 'src/dtos/file.dto';
import {
  QueueEvent, QueueMessageService
} from 'src/kernel';
import { File, FileDocument } from 'src/schemas/file.schema';

import { FileService } from './file.service';
import {
  FILE_EVENT,
  FILE_SERVER_PHOTO_QUEUE_CHANNEL,
  FILE_SERVER_VIDEO_QUEUE_CHANNEL
} from './file-manager.service';
import { FileProcessingService } from './file-processing.service';

@Injectable()
export class FileProcessListenerService implements OnModuleInit {
  private readonly logger = new Logger(FileProcessListenerService.name);

  constructor(
    @InjectModel(File.name) private readonly FileModel: Model<FileDocument>,
    private readonly queueEventService: QueueMessageService,
    private readonly configService: AppConfigService,
    private readonly fileProcessingService: FileProcessingService,
    private readonly fileService: FileService,
    private readonly dbLogger: DBLoggerService
  ) {
  }

  onModuleInit() {
    // Subscribe to video processing queue
    this.queueEventService.subscribe(
      FILE_SERVER_VIDEO_QUEUE_CHANNEL,
      'PROCESS_VIDEO',
      this._processVideo.bind(this)
    );

    // Subscribe to photo processing queue
    this.queueEventService.subscribe(
      FILE_SERVER_PHOTO_QUEUE_CHANNEL,
      'PROCESS_PHOTO',
      this._processPhoto.bind(this)
    );
  }

  private async _processVideo({ data: event }: QueueEvent<Record<string, any>>) {
    if (event.eventName !== 'PROCESS_VIDEO') return;
    const fileData = event.data.file as FileDto;
    const options = event.data.options || {};

    // Resolve video file path
    const { publicDir } = this.configService.file;
    let videoPath = fileData.absolutePath;
    if (existsSync(fileData.absolutePath)) {
      videoPath = fileData.absolutePath;
      // Use dir of the original file
    } else if (existsSync(join(publicDir, fileData.path))) {
      videoPath = join(publicDir, fileData.path);
    }

    try {
      if (!videoPath) {
        // eslint-disable-next-line no-throw-literal
        throw new Error(`File ${videoPath} cannot be found!`);
      }

      // Claim only live records. Discard marks the record deleted before
      // physical cleanup so queued work can stop without recreating files.
      const claimResult = await this.FileModel.updateOne(
        { _id: fileData._id, status: { $ne: FILE_STATUS.DELETED } },
        {
          $set: {
            processingStatus: PROCESSING_STATUS.PROCESSING
          }
        }
      );
      if (claimResult.matchedCount === 0) {
        await this.fileService.cleanupDiscardedFile(fileData);
        return;
      }

      // Use centralized video processing logic
      const processingResult = await this.fileProcessingService.processVideo(
        videoPath,
        fileData,
        options
      );

      // Update file record with processing results
      const updateResult = await this.FileModel.updateOne(
        { _id: fileData._id, status: { $ne: FILE_STATUS.DELETED } },
        {
          $set: {
            processingStatus: PROCESSING_STATUS.COMPLETED,
            absolutePath: processingResult.uploaded.absolutePath,
            path: processingResult.uploaded.path,
            thumbnails: processingResult.thumbnails,
            blurImagePath: processingResult.blurImagePath,
            duration: processingResult.duration,
            metadata: processingResult.metadata,
            storageType: processingResult.uploaded.storageType,
            width: processingResult.width,
            height: processingResult.height,
            mimeType: processingResult.mimeType,
            ...(processingResult.processedHash && { processedHash: processingResult.processedHash })
          }
        }
      );

      if (updateResult.matchedCount === 0) {
        await this.fileService.cleanupDiscardedFile({
          ...fileData,
          absolutePath: processingResult.uploaded.absolutePath,
          path: processingResult.uploaded.path,
          thumbnails: processingResult.thumbnails,
          blurImagePath: processingResult.blurImagePath,
          storageType: processingResult.uploaded.storageType
        } as FileDto);
      } else if (processingResult.deleteOriginalFile && processingResult.originalFileAbsolutePath) {
        // Persist the final path first, then remove the superseded source. A
        // short retry handles transient antivirus/media-reader locks on Windows.
        try {
          await this.removeConvertedSource(processingResult.originalFileAbsolutePath);
        } catch (cleanupError) {
          this.logger.warn(
            `Converted video was saved but its source could not be removed: ${processingResult.originalFileAbsolutePath}. ${cleanupError?.message || cleanupError}`
          );
        }
      }
    } catch (e) {
      this.logger.error('Video processing failed', e);

      const currentFile = await this.FileModel.findById(fileData._id).lean();
      if (!currentFile || currentFile.status === FILE_STATUS.DELETED) {
        // Discard can race an active FFmpeg/Sharp process on Windows. Once the
        // worker releases its handles, remove the whole detached video folder.
        await this.fileService.cleanupDiscardedFile(fileData);
        return;
      }

      // Enhanced error logging with detailed information
      const errorDetails = JSON.stringify({
        fileId: fileData._id,
        fileName: fileData.name,
        originalName: fileData.originalName,
        fileSize: fileData.fileSize,
        mimeType: fileData.mimeType,
        processingOptions: options,
        videoPath,
        error: e?.message || e,
        stack: e?.stack
      });
      this.dbLogger.error(`Video processing failed for file ${fileData._id}: ${e?.message || e}. Details: ${errorDetails}`, e?.stack, 'FileProcessListenerService');

      await this.FileModel.updateOne(
        { _id: fileData._id },
        {
          $set: {
            processingStatus: PROCESSING_STATUS.FAILED,
            status: FILE_STATUS.ERROR,
            processingError: e?.stack || e
          }
        }
      );

      // Clean up physical files since file is now in ERROR status
      await this.fileService.cleanupErroredFile(fileData._id.toString());

      throw new HttpException(e, 500);
    } finally {
      // Fire event to subscriber
      if (options.publishChannel) {
        await this.queueEventService.publish(
          options.publishChannel,
          {
            eventName: FILE_EVENT.VIDEO_PROCESSED,
            data: {
              meta: options.meta,
              fileId: fileData._id
            }
          }
        );
      }
    }
  }

  private async removeConvertedSource(filePath: string): Promise<void> {
    const maximumAttempts = 5;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        await fsPromises.unlink(filePath);
        return;
      } catch (error) {
        if (error?.code === 'ENOENT') return;

        const isTransientWindowsLock = ['EBUSY', 'EPERM', 'EACCES'].includes(error?.code);
        if (!isTransientWindowsLock || attempt === maximumAttempts) throw error;

        await new Promise((resolveRetry) => setTimeout(resolveRetry, attempt * 150));
      }
    }
  }

  private async _processPhoto({ data: event }: QueueEvent<Record<string, any>>) {
    if (event.eventName !== 'PROCESS_PHOTO') {
      return;
    }
    const fileData = event.data.file as FileDto;
    const options = event.data.options || {};
    const { publicDir } = this.configService.file;
    let photoPath = join(publicDir, fileData.path);

    if (existsSync(fileData.absolutePath)) {
      photoPath = fileData.absolutePath;
    } else if (existsSync(join(publicDir, fileData.path))) {
      photoPath = join(publicDir, fileData.path);
    }

    try {
      // Claim only live records. A discarded queued photo is cleaned without
      // starting Sharp or writing generated output back to its tombstone.
      const claimResult = await this.FileModel.updateOne(
        { _id: fileData._id, status: { $ne: FILE_STATUS.DELETED } },
        {
          $set: {
            processingStatus: PROCESSING_STATUS.PROCESSING
          }
        }
      );
      if (claimResult.matchedCount === 0) {
        await this.fileService.cleanupDiscardedFile(fileData);
        return;
      }

      // Use centralized processing logic
      const processingResult = await this.fileProcessingService.processPhoto(
        photoPath,
        fileData,
        options
      );

      // Update file record with processing results
      const updateResult = await this.FileModel.updateOne(
        { _id: fileData._id, status: { $ne: FILE_STATUS.DELETED } },
        {
          $set: {
            processingStatus: PROCESSING_STATUS.COMPLETED,
            width: processingResult.imageMeta.width,
            height: processingResult.imageMeta.height,
            mimeType: processingResult.mimeType,
            metadata: processingResult.metadata,
            storageType: processingResult.uploaded.storageType,
            absolutePath: processingResult.uploaded.absolutePath,
            path: processingResult.uploaded.path,
            thumbnails: processingResult.thumbnails,
            blurImagePath: processingResult.blurImagePath,
            ...(processingResult.processedHash && { processedHash: processingResult.processedHash })
          }
        }
      );

      if (updateResult.matchedCount === 0) {
        await this.fileService.cleanupDiscardedFile({
          ...fileData,
          absolutePath: processingResult.uploaded.absolutePath,
          path: processingResult.uploaded.path,
          thumbnails: processingResult.thumbnails,
          blurImagePath: processingResult.blurImagePath,
          storageType: processingResult.uploaded.storageType
        } as FileDto);
      }
    } catch (e) {
      const currentFile = await this.FileModel.findById(fileData._id).lean();
      if (!currentFile || currentFile.status === FILE_STATUS.DELETED) {
        await this.fileService.cleanupDiscardedFile(fileData);
        return;
      }

      // Enhanced error logging with detailed information
      const errorDetails = JSON.stringify({
        fileId: fileData._id,
        fileName: fileData.name,
        originalName: fileData.originalName,
        fileSize: fileData.fileSize,
        mimeType: fileData.mimeType,
        processingOptions: options,
        photoPath,
        error: e?.message || e,
        stack: e?.stack
      });
      this.dbLogger.error(`Photo processing failed for file ${fileData._id}: ${e?.message || e}. Details: ${errorDetails}`, e?.stack, 'FileProcessListenerService');

      // Update status to error on failure
      await this.FileModel.updateOne(
        { _id: fileData._id },
        {
          $set: {
            processingStatus: PROCESSING_STATUS.FAILED,
            status: FILE_STATUS.ERROR,
            processingError: e?.stack || e
          }
        }
      );

      // Clean up physical files since file is now in ERROR status
      await this.fileService.cleanupErroredFile(fileData._id.toString());

      throw new HttpException(e, 500);
    } finally {
      // Publish completion event if requested
      if (options.publishChannel) {
        await this.queueEventService.publish(
          options.publishChannel,
          {
            eventName: FILE_EVENT.PHOTO_PROCESSED,
            data: {
              meta: options.meta,
              fileId: fileData._id
            }
          }
        );
      }
    }
  }
}
