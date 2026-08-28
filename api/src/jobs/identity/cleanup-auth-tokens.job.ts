import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QueueService } from 'src/kernel';
import { AuthTokenService } from 'src/services/identity/auth/auth-token.service';

/** Once a day, a few minutes past the hour so it does not pile onto midnight. */
const SCHEDULE_JOB_REPEAT_PATTERN = '17 3 * * *';

const AUTH_TOKEN_CLEANUP_AGENDA = 'AUTH_TOKEN_CLEANUP_AGENDA';

/** Rows are removed a week after they expired — long enough to inspect one. */
const RETENTION_DAYS = 7;

/**
 * Sweeps expired verification and reset tokens.
 *
 * `auth_tokens` also carries a TTL index, so this is belt and braces rather than
 * the only mechanism — and neither of them is load-bearing. Expiry is enforced
 * inside the atomic claim, which checks `expiresAt` in the same statement that
 * consumes the token. What this job protects is disk, not correctness.
 *
 * It exists because the TTL monitor is a background process that can lag, can be
 * disabled, and is not guaranteed on every managed MongoDB tier. On the
 * deployment target (an Atlas free cluster behind a web service that sleeps when
 * idle) it is worth not depending on.
 *
 * Cluster-safe by construction: a BullMQ job scheduler runs the job once
 * cluster-wide rather than once per process.
 */
@Injectable()
export class CleanupAuthTokensJob {
  private readonly logger = new Logger(CleanupAuthTokensJob.name);

  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly queueService: QueueService
  ) {
    this.initializeJobs();
  }

  private initializeJobs(): void {
    this.defineJobs().catch((error) => {
      this.logger.error(`Failed to initialize auth token cleanup job: ${error.message}`, error.stack);
    });
  }

  private async addJobScheduler() {
    const queue = this.queueService.createQueue(AUTH_TOKEN_CLEANUP_AGENDA);

    await queue.upsertJobScheduler(
      AUTH_TOKEN_CLEANUP_AGENDA,
      { pattern: SCHEDULE_JOB_REPEAT_PATTERN },
      {
        name: AUTH_TOKEN_CLEANUP_AGENDA,
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
      AUTH_TOKEN_CLEANUP_AGENDA,
      this.purge.bind(this),
      { concurrency: 1 }
    );
  }

  private async purge(job: Job): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const removed = await this.authTokenService.purgeExpired(cutoff);
      if (removed) this.logger.log(`Purged ${removed} expired auth tokens (job ${job.id})`);
    } catch (error: any) {
      this.logger.error(`Auth token cleanup failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
