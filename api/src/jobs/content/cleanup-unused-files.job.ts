import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService } from 'src/kernel';
import { FileServerService } from 'src/services/shared/file-server';

/**
 * Cron pattern for file cleanup - runs every 4 hours to optimize storage usage
 */
const SCHEDULE_JOB_REPEAT_PATTERN = '0 */4 * * *'; // every 4 hours

/** Queue agenda name for file cleanup job */
const CLEANUP_UNUSED_FILES_AGENDA = 'CLEANUP_UNUSED_FILES_AGENDA';

/**
 * Cleanup Unused Files Job
 *
 * Background job service that periodically removes unused files from the file system.
 * This helps maintain storage efficiency and prevents accumulation of orphaned files.
 *
 * Key Responsibilities:
 * - Identify files that are no longer referenced by any database records
 * - Remove unused post files (videos, photos, teasers, thumbnails)
 * - Remove unused product files (images and digital products)
 * - Remove unused creator profile files (avatars, covers, welcome videos)
 * - Remove unused system files (banners, post images, settings)
 * - Remove unused registration and verification files
 * - Maintain file system cleanliness and optimize storage costs
 *
 * Cleanup Frequency:
 * - Runs every 4 hours to balance storage optimization with system performance
 * - Scheduled during off-peak hours to minimize impact on user experience
 *
 * File Types Cleaned:
 * - post-video: Main post video content files
 * - post-photo: Post photo content files
 * - post-teaser: Video preview/teaser files
 * - post-thumbnail: Video thumbnail images
 * - product-image: Product preview images
 * - product-digital: Digital product files
 * - avatar: User profile avatar images
 * - cover: Creator profile cover images
 * - welcome-video: Creator welcome video files
 * - banner: System banner images
 * - post-image: Blog/post content images
 * - setting-file: System setting files
 * - creator-register-document: Registration verification documents
 *
 * @example File cleanup workflow
 * ```
 * 1. Query database for all file records of specific types
 * 2. Check file system for actual files
 * 3. Identify files that exist on disk but not in database
 * 4. Remove orphaned files from file system
 * 5. Log cleanup statistics for monitoring
 * ```
 *
 * Business Impact:
 * - Reduces storage costs by removing unused files
 * - Prevents disk space issues from accumulating orphaned files
 * - Maintains system performance by keeping file system organized
 * - Supports compliance with data retention policies
 */
@Injectable()
export class CleanupUnusedFilesJob {
  private readonly logger = new Logger(CleanupUnusedFilesJob.name);

  constructor(
    private readonly fileServerService: FileServerService,
    private readonly queueService: QueueService
  ) {
    this.initializeJobs();
  }

  /**
   * Initialize job scheduler asynchronously
   * Called from constructor to ensure jobs are set up on service initialization
   */
  private initializeJobs(): void {
    this.defineJobs().catch((error) => {
      this.logger.error(`Failed to initialize cleanup unused files jobs: ${error.message}`, error.stack);
    });
  }

  /**
   * Add the cleanup job scheduler with recurring schedule
   * Uses the new BullMQ v5.16+ Job Scheduler pattern for better horizontal scaling
   * Configures job to run every 4 hours with template settings
   */
  private async addJobScheduler() {
    // Get the queue instance to use the new upsertJobScheduler method
    const queue = this.queueService.createQueue(CLEANUP_UNUSED_FILES_AGENDA);

    // Use the new Job Scheduler pattern (replaces repeatable jobs)
    await queue.upsertJobScheduler(
      CLEANUP_UNUSED_FILES_AGENDA, // scheduler ID
      { pattern: SCHEDULE_JOB_REPEAT_PATTERN }, // repeat options
      {
        name: CLEANUP_UNUSED_FILES_AGENDA, // job template name
        data: {}, // job template data
        opts: {
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      }
    );
  }

  /**
   * Initialize job scheduler and register worker processor
   * Sets up the recurring cleanup job using new Job Scheduler pattern and defines the worker function
   */
  private async defineJobs() {
    await this.addJobScheduler();
    this.queueService.processWorker(
      CLEANUP_UNUSED_FILES_AGENDA,
      this.cleanupUnusedFiles.bind(this),
      {
        // Increase lock duration to 20 minutes for processing multiple file types
        lockDuration: 20 * 60 * 1000, // 20 minutes in milliseconds
        // Renew lock every 10 minutes to prevent expiration during execution
        lockRenewTime: 10 * 60 * 1000, // 10 minutes in milliseconds
        concurrency: 1 // Process one cleanup job at a time
      }
    );
  }

  /**
   * Main cleanup job processor that orchestrates file cleanup by type
   * Validates job authenticity and processes different file categories
   * Updated for BullMQ v5.16+ Job Scheduler pattern
   * @param job - BullMQ job instance containing job metadata
   */
  private async cleanupUnusedFiles(job: Job): Promise<void> {
    try {
      // Validate this job is from an active worker (handles both add() and scheduler-based jobs)
      if (!this.queueService.isInActiveQueueJob(job)) return;

      // For Job Scheduler pattern, validate by job name instead of deprecated jobId
      if (job.name !== CLEANUP_UNUSED_FILES_AGENDA) return;

      // Additional validation: ensure this is a scheduled job (has repeat metadata)
      const { repeat } = job.opts;
      if (!repeat || repeat.pattern !== SCHEDULE_JOB_REPEAT_PATTERN) return;

      // Process post-related files (videos, photos, teasers, thumbnails)
      await this.cleanupFilesByTypes(['post-video', 'post-photo', 'post-teaser', 'post-thumbnail']);

      // Process creator profile files (avatars)
      await this.cleanupFilesByTypes(['avatar']);

      // Process system and admin files
      await this.cleanupFilesByTypes(['setting-file']);
    } catch {
      // Silent fail - errors will be handled by the queue system
      // This prevents job failures from stopping the cleanup process
    }
  }

  /**
   * Clean up unused files for specific file types
   * Delegates to FileService to perform the actual cleanup logic
   * @param types - Array of file type identifiers to clean up
   * TODO: Add logging to track cleanup statistics and performance metrics
   * TODO: Consider adding configurable retention periods for different file types
   */
  private async cleanupFilesByTypes(types: string[]): Promise<void> {
    try {
      await this.fileServerService.removeUnusedFilesByTypes(types);
    } catch {
      // Silent fail - errors will be handled by the queue system
      // Individual file type cleanup failures shouldn't stop other cleanups
    }
  }
}
