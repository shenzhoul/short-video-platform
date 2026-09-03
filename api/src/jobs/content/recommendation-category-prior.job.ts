import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService } from 'src/kernel';
import { RecommendationCategoryPriorService } from 'src/services/content/recommendation/recommendation-category-prior.service';

const SCHEDULE_JOB_REPEAT_PATTERN = '0 * * * *'; // Hourly — mirrors TagTrendingJob's cadence and rationale.

const RECOMMENDATION_CATEGORY_PRIOR_AGENDA = 'RECOMMENDATION_CATEGORY_PRIOR_AGENDA';

/**
 * Recomputes recommendation engagement-quality priors on a schedule.
 *
 * Structured identically to `TagTrendingJob`: a `upsertJobScheduler` cron
 * entry plus a single worker, because both jobs solve the same problem
 * (a derived aggregate that drifts as new stats accumulate, recomputed from a
 * bounded collection rather than on the request path).
 */
@Injectable()
export class RecommendationCategoryPriorJob {
  private readonly logger = new Logger(RecommendationCategoryPriorJob.name);

  constructor(
    private readonly priorService: RecommendationCategoryPriorService,
    private readonly queueService: QueueService
  ) {
    this.initializeJobs();
  }

  private initializeJobs(): void {
    this.defineJobs().catch((error) => {
      this.logger.error(`Failed to initialize recommendation category prior job: ${error.message}`, error.stack);
    });
  }

  private async addJobScheduler() {
    const queue = this.queueService.createQueue(RECOMMENDATION_CATEGORY_PRIOR_AGENDA);

    await queue.upsertJobScheduler(
      RECOMMENDATION_CATEGORY_PRIOR_AGENDA,
      { pattern: SCHEDULE_JOB_REPEAT_PATTERN },
      {
        name: RECOMMENDATION_CATEGORY_PRIOR_AGENDA,
        data: {},
        opts: {
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 }
        }
      }
    );
  }

  private async defineJobs() {
    await this.addJobScheduler();
    this.queueService.processWorker(
      RECOMMENDATION_CATEGORY_PRIOR_AGENDA,
      this.recalculate.bind(this),
      {
        lockDuration: 5 * 60 * 1000,
        lockRenewTime: 2 * 60 * 1000,
        concurrency: 1
      }
    );
  }

  private async recalculate(job: Job): Promise<void> {
    try {
      const updated = await this.priorService.recalculate();
      this.logger.log(`Recalculated ${updated} recommendation engagement priors (job ${job.id})`);
    } catch (error: any) {
      this.logger.error(`Recommendation category prior recalculation failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
