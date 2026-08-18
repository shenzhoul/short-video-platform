import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { POST_STATS_POLICY } from 'src/common/constants/community';
import { QueueService } from 'src/kernel';
import { PostStatsCoalescerService } from 'src/services/socket/post-stats-coalescer.service';

const SCHEDULE_POST_STATS_FLUSH = 'SCHEDULE_POST_STATS_FLUSH';

/**
 * Drives the shared-counter flush on a fixed interval.
 *
 * Scheduled through BullMQ rather than an in-process `setInterval`, which the
 * project forbids because every instance would run its own timer and drift.
 *
 * Even so, the drain itself is written to be safe if two instances ever do tick
 * together: `SPOP` hands out disjoint subsets, so overlapping flushes split the
 * work instead of duplicating it.
 */
@Injectable()
export class PostStatsFlushJob implements OnModuleInit {
  private readonly logger = new Logger(PostStatsFlushJob.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly postStatsCoalescerService: PostStatsCoalescerService
  ) { }

  async onModuleInit() {
    try {
      await this.defineJobs();
    } catch (e) {
      this.logger.error(`Failed to initialize post stats flush job: ${e.message}`, e.stack);
    }
  }

  private async defineJobs() {
    const queue = this.queueService.createQueue(SCHEDULE_POST_STATS_FLUSH);

    await queue.upsertJobScheduler(
      SCHEDULE_POST_STATS_FLUSH,
      // Sub-second, so `every` rather than a cron pattern.
      { every: POST_STATS_POLICY.FLUSH_INTERVAL_MS },
      {
        name: SCHEDULE_POST_STATS_FLUSH,
        data: {},
        opts: {
          removeOnComplete: true,
          removeOnFail: true,
          // A missed flush is corrected by the next one — the snapshot is an
          // absolute total — so retries would only add load for no benefit.
          attempts: 1
        }
      }
    );

    this.queueService.processWorker(SCHEDULE_POST_STATS_FLUSH, this.flush.bind(this));
  }

  private async flush(job: Job): Promise<void> {
    try {
      if (!this.queueService.isInActiveQueueJob(job)) return;
      await this.postStatsCoalescerService.flush();
    } catch (e) {
      // Swallowed on purpose: shared counters stay authoritative in the
      // database, so a failed flush delays a snapshot rather than losing state.
      this.logger.error(`Post stats flush failed: ${e.message}`, e.stack);
    }
  }
}
