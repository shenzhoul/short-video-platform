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
import { randomUUID } from 'crypto';
import {
  extname, join
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
import { S3StorageService } from './s3-storage.service';
import { STORAGE_TYPES } from 'src/common/constants/content';

@Injectable()
export class FileProcessListenerService implements OnModuleInit {
  private readonly logger = new Logger(FileProcessListenerService.name);

  constructor(
    @InjectModel(File.name) private readonly FileModel: Model<FileDocument>,
    private readonly queueEventService: QueueMessageService,
    private readonly configService: AppConfigService,
    private readonly fileProcessingService: FileProcessingService,
    private readonly fileService: FileService,
    private readonly s3StorageService: S3StorageService,
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

    /*
     * Resolved before the try, so a source that cannot be produced at all fails
     * the job with an honest message. On a bucket deployment this downloads the
     * object to a scratch file; on disk it returns the existing local path and
     * does nothing.
     */
    let source: { path: string; workDir?: string; cleanup: () => Promise<void> };
    try {
      source = await this.materializeLocalSource(fileData);
    } catch (error) {
      await this.markProcessingFailed(fileData, error, 'video');
      return;
    }
    const videoPath = source.path;

    try {
      // `existsSync`, not a falsy check. The guard here used to be `!videoPath`,
      // which an object key satisfies — so a remote path was passed straight to
      // ffprobe and failed there instead of here.
      if (!existsSync(videoPath)) {
        throw new Error(`Source file for ${fileData._id} is not readable at ${videoPath}`);
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

      /*
       * `toDir` points the transcode output and the thumbnails at the scratch
       * directory when the source came from a bucket. Without it `processVideo`
       * falls back to `publicDir/videos`, which does not exist on an R2
       * deployment. On disk `workDir` is undefined and the original behaviour
       * is untouched.
       */
      const processingResult = await this.fileProcessingService.processVideo(
        videoPath,
        fileData,
        source.workDir ? { ...options, toDir: source.workDir } : options
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
      // Before the event, and unconditionally: the scratch copy is removed on
      // success, on failure and on the discard path. On disk this is a no-op.
      await source.cleanup();

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

  /**
   * A local path the processing pipeline can actually open, and how to clean up.
   *
   * `file-manager` uploads to storage BEFORE queueing work, commenting that this
   * "ensures queue jobs get the final storage path, not temp path". That holds
   * for the disk engine, where uploading means moving the file into `public/`.
   * It does not hold for a bucket: the bytes are in Cloudflare and the temp file
   * has been deleted, so `absolutePath` is an object key.
   *
   * Handing that key to FFmpeg is exactly what happened in production — ffprobe
   * reported "videos/<id>/<uuid>.mp4: No such file or directory" and the record
   * was marked failed, because a key is a non-empty string and passed the
   * falsy-path guard that was meant to catch this.
   *
   * Disk is untouched: both `existsSync` branches short-circuit before any
   * download, so nothing about local processing changes.
   */
  private async materializeLocalSource(fileData: FileDto): Promise<{
    path: string;
    workDir?: string;
    cleanup: () => Promise<void>;
  }> {
    const { publicDir, tempDir } = this.configService.file;
    const noop = async () => undefined;

    if (fileData.absolutePath && existsSync(fileData.absolutePath)) {
      return { path: fileData.absolutePath, cleanup: noop };
    }

    const publicPath = fileData.path ? join(publicDir, fileData.path) : '';
    if (publicPath && existsSync(publicPath)) {
      return { path: publicPath, cleanup: noop };
    }

    if (fileData.storageType !== STORAGE_TYPES.S3) {
      // Disk-backed and genuinely absent. Say so plainly rather than returning a
      // path that does not exist for FFmpeg to fail on later.
      throw new Error(
        `Source file for ${fileData._id} not found locally (storageType=${fileData.storageType || 'unknown'})`
      );
    }

    /*
     * Remote. Bring the bytes back for the duration of this job, into a
     * directory of their own.
     *
     * A directory rather than a bare file because the transcode and the
     * thumbnails need somewhere to be WRITTEN too. `processVideo` otherwise
     * derives that from `publicDir/videos`, which on a bucket deployment is a
     * path nothing ever creates — only `DiskStorageService` mkdirs that subtree.
     * FFmpeg was told to write there and failed identically on all three
     * thumbnail formats, which is what a missing output directory looks like.
     */
    const workDir = join(tempDir, `processing-${fileData._id}-${randomUUID()}`);
    await fsPromises.mkdir(workDir, { recursive: true });
    const scratch = join(workDir, `source${extname(fileData.path || '') || ''}`);
    this.logger.log(`Materializing ${fileData._id} from object storage for processing`);
    await this.s3StorageService.downloadToFile(fileData.path, scratch);

    return {
      path: scratch,
      workDir,
      // Runs in a `finally`, so it must never throw: the job's own outcome —
      // success or the real processing error — is what the caller needs to see.
      // Removes the source, the transcode output and the thumbnails together.
      // Safe in a `finally`: by then every artefact has been uploaded.
      cleanup: async () => {
        try {
          await fsPromises.rm(workDir, { recursive: true, force: true });
        } catch (error) {
          this.logger.warn(`Could not remove processing scratch dir ${workDir}: ${error?.message}`);
        }
      }
    };
  }

  /**
   * Mark a record failed when its source could not even be obtained.
   *
   * Separate from the in-flight catch blocks because there is nothing to clean
   * up yet and no processing event to publish — the job never started. Without
   * this the record would sit at `pending` forever and the seeder would wait out
   * its whole processing timeout before reporting something misleading.
   */
  private async markProcessingFailed(fileData: FileDto, error: any, kind: 'video' | 'photo'): Promise<void> {
    this.dbLogger.error(
      `${kind} source unavailable for file ${fileData._id}: ${error?.message || error}`,
      error?.stack,
      'FileProcessListenerService'
    );

    await this.FileModel.updateOne(
      { _id: fileData._id, status: { $ne: FILE_STATUS.DELETED } },
      {
        $set: {
          processingStatus: PROCESSING_STATUS.FAILED,
          status: FILE_STATUS.ERROR,
          processingError: error?.stack || String(error)
        }
      }
    );
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

    // Same materialization as video. Images usually process inline, while the
    // temp file still exists — which is why photos kept working on R2 and video
    // did not — but a queued photo takes this path and would fail identically.
    let source: { path: string; workDir?: string; cleanup: () => Promise<void> };
    try {
      source = await this.materializeLocalSource(fileData);
    } catch (error) {
      await this.markProcessingFailed(fileData, error, 'photo');
      return;
    }
    const photoPath = source.path;

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
      // See _processVideo: unconditional, and a no-op on disk.
      await source.cleanup();

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
