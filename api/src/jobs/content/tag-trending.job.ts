import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService } from 'src/kernel';
import { TagTrendingService } from 'src/services/content/tag';

/** Hourly is ample: this is a personal project, not a real-time trend feed. */
const SCHEDULE_JOB_REPEAT_PATTERN = '0 * * * *';

const TAG_TRENDING_AGENDA = 'TAG_TRENDING_AGENDA';

/**
 * Recomputes hashtag trending scores and ranks on a schedule.
 *
 * Runs as a job rather than on every post write because the score depends on recency, so it drifts
 * with the passage of time even when no posts change.
 */
@Injectable()
export class TagTrendingJob {
  private readonly logger = new Logger(TagTrendingJob.name);

  constructor(
    private readonly tagTrendingService: TagTrendingService,
    private readonly queueService: QueueService
  ) {
    this.initializeJobs();
  }

  private initializeJobs(): void {
    this.defineJobs().catch((error) => {
      this.logger.error(`Failed to initialize tag trending jobs: ${error.message}`, error.stack);
    });
  }

  private async addJobScheduler() {
    const queue = this.queueService.createQueue(TAG_TRENDING_AGENDA);

    await queue.upsertJobScheduler(
      TAG_TRENDING_AGENDA,
      { pattern: SCHEDULE_JOB_REPEAT_PATTERN },
      {
        name: TAG_TRENDING_AGENDA,
        data: {},
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

  private async defineJobs() {
    await this.addJobScheduler();
    this.queueService.processWorker(
      TAG_TRENDING_AGENDA,
      this.recalculateTrending.bind(this),
      {
        lockDuration: 5 * 60 * 1000,
        lockRenewTime: 2 * 60 * 1000,
        concurrency: 1
      }
    );
  }

  private async recalculateTrending(job: Job): Promise<void> {
    try {
      const updated = await this.tagTrendingService.recalculateTrending();
      this.logger.log(`Recalculated trending scores for ${updated} tags (job ${job.id})`);
    } catch (error: any) {
      this.logger.error(`Tag trending recalculation failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}