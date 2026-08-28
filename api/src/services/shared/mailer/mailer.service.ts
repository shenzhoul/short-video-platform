import { Inject, Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MailMessage, MAIL_PROVIDER, MailProvider } from 'src/common/interfaces/mailer';
import { QueueService } from 'src/kernel';

export const MAIL_QUEUE = 'MAIL_QUEUE';
const MAIL_JOB = 'SEND_MAIL';

/**
 * Hands a fully rendered message to the queue, and drains that queue.
 *
 * ## A work queue, not a fan-out
 *
 * `QueueMessageService` exists for pub/sub where one event reaches several
 * independent subscribers. Sending an email has exactly one consumer, and it
 * needs something pub/sub does not offer here: **per-job retry options**.
 * `QueueMessageService.publish` calls `queue.add(name, data, { priority })` and
 * nothing else, so a job would run once and be dropped. `QueueService.add`
 * accepts `jobOptions`, which is where `attempts` and `backoff` live.
 *
 * ## The job throws
 *
 * The implementation this replaces caught every error inside the handler and
 * logged it, so BullMQ recorded each job as completed and no retry ever ran — a
 * dead SMTP host produced a green application that delivered nothing. Here the
 * provider throws, the handler lets it through, and BullMQ retries with
 * exponential backoff.
 *
 * ## What travels through Redis
 *
 * The **rendered** message: recipient, subject, html, text. Not a template name
 * and not the variables that produced it. The action URL is inside the body, so
 * a token is in Redis for as long as the job exists — which is why
 * `removeOnComplete` is true (the queue default) and failures are aged out after
 * an hour. Rendering before enqueueing is also what keeps a provider from being
 * able to look a template up.
 *
 * ## Delivery is never guaranteed, and the product knows it
 *
 * On a host that sleeps when idle (Render Free is the deployment target), a job
 * enqueued moments before the process suspends is not processed until the next
 * request wakes it. Retries eventually drain it, but "eventually" is not a
 * promise the signup screen can make. Every flow that sends mail therefore
 * exposes a resend control rather than treating the first send as final.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(
    private readonly queueService: QueueService,
    @Inject(MAIL_PROVIDER) private readonly provider: MailProvider
  ) {
    this.queueService.processWorker(MAIL_QUEUE, this.process.bind(this), { concurrency: 2 });
  }

  /**
   * Enqueue a rendered message.
   *
   * Never throws for a delivery reason — it has not attempted delivery yet. It
   * can still throw if Redis is unreachable, and every caller treats that as
   * "the mail did not go out", not as "the operation failed".
   */
  public async send(message: MailMessage): Promise<void> {
    await this.queueService.add(MAIL_QUEUE, MAIL_JOB, {
      data: message,
      jobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: { age: 3600, count: 20 }
      }
    });
  }

  /**
   * Send immediately, bypassing the queue. Used only by verification tooling.
   */
  public async sendNow(message: MailMessage): Promise<void> {
    await this.provider.send(message);
  }

  private async process(job: Job<MailMessage>): Promise<void> {
    const message = job.data;
    // Deliberately no try/catch. A throw is what earns the retry, and the
    // provider has already logged the transport's own words.
    await this.provider.send(message);
    this.logger.log(`mail sent to=${message.to} subject=${JSON.stringify(message.subject)} via=${this.provider.kind}`);
  }
}
