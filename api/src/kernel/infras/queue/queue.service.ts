import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  DefaultJobOptions,
  Job,
  Queue, Worker,
  WorkerOptions
} from 'bullmq';
import { createHash } from 'crypto';

import {
  CORE_QUEUE_MESSAGE_REDIS_CONNECTION,
  IQueueJobOptions,
  IRedisQueueParams
} from './constants';
import { QueueWorkerHolderSingleton } from './queue-workers-holder';

/**
 * Service for managing job queues using BullMQ
 * Provides functionality for creating queues, adding jobs, and processing workers
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  /** Map of queue names to Queue instances */
  protected _queues: Record<string, Queue> = {};

  /**
   * Placeholder to store queue and job name
   * Issue we have is to change or rename schedule, repeat job and restart application
   * it won't be deleted in redis and will be executed 2 times
   * Example:
   * 1. run this job: this.queueService.add('test_schedule', 'test_schedule1', { repeat: { pattern: '*\/5 * * * * *'} } as any);
   * 2. stop app while 1 is not done yet (processing but not done job)
   * 3. rename job: this.queueService.add('test_schedule', 'test_schedule2', { repeat: { pattern: '*\/5 * * * * *'} } as any);
   * log test function: console.log('data queue', data.name, data.id); will show 2 lines
   * data queue test_schedule1 repeat:9ee31f9e1d5840816190def2ced7ea47:1718866730000
   * data queue test_schedule2 repeat:470763aae1a95c9e3823804de441e86b:1718866745000
   */
  protected _activeQueueAndJobs: Record<string, any> = {};

  /** Array of unique job identifiers to prevent duplicates */
  protected _activeUniqueJobs: string[] = [];

  /**
   * Creates a new QueueService instance
   * @param redisQueueParams - Redis connection parameters for queue operations
   */
  constructor(
    @Inject(CORE_QUEUE_MESSAGE_REDIS_CONNECTION) private readonly redisQueueParams: IRedisQueueParams
  ) { }

  async onModuleDestroy() {
    const queues = Object.values(this._queues);
    await Promise.allSettled(queues.map((queue) => queue.close()));
    this._queues = {};
  }

  /**
   * Gets the active queue jobs
   * @returns Copy of the active queue and jobs record
   */
  public getActiveQueueJobs() {
    return { ...this._activeQueueAndJobs };
  }

  /**
   * Checks if a job is in the active queue job list or has an active worker
   *
   * This method validates jobs in two ways:
   * 1. Regular jobs added via add() - checks _activeQueueAndJobs
   * 2. Scheduler-based jobs (e.g., upsertJobScheduler) - checks if worker exists via QueueWorkerHolderSingleton
   *
   * @param job - The job to check
   * @returns True if the job is active (either tracked as job or has active worker), false otherwise
   */
  public isInActiveQueueJob(job: Job) {
    // Check if this specific job was added via add() method
    const props = Object.getOwnPropertyNames(this._activeQueueAndJobs);
    const isTrackedJob = props.includes(`${job.queueName}:${job.name}`);

    // Check if there's an active worker for this queue (handles scheduler-based jobs)
    const hasActiveWorker = QueueWorkerHolderSingleton.getByName(job.queueName) !== undefined;

    return isTrackedJob || hasActiveWorker;
  }

  /**
   * Checks if this unique job is in the active list
   * Do not apply with repeat job
   * @param job - The job to check
   * @returns True if the unique job is active, false otherwise
   */
  public isInActiveUniqueJob(job: Job) {
    const name = `${job.queueName}:${job.name}:${job.id}`;
    return this._activeUniqueJobs.includes(name);
  }

  /**
   * Creates a new queue with the specified name and options
   * @param name - The name of the queue to create
   * @param defaultJobOptions - Default options for jobs in this queue
   * @returns The created Queue instance
   */
  public createQueue(name: string, defaultJobOptions?: DefaultJobOptions) {
    if (this._queues[name]) {
      return this._queues[name];
    }

    const { redisConfig, skipVersionCheck } = this.redisQueueParams;
    const prefix = this.getQueuePrefix(name);

    const queue = new Queue(name, {
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: {
          // fail will be removed after 1h
          age: 3600,
          count: 10 // max 10 jobs
        },
        ...(defaultJobOptions || {})
      },
      connection: redisConfig,
      // https://docs.bullmq.io/bull/patterns/redis-cluster
      // Use curly braces for Redis cluster compatibility
      prefix: `{${prefix}}`,
      // New BullMQ features
      ...(skipVersionCheck && { skipVersionCheck: true })
    });

    this._queues[name] = queue;
    return queue;
  }

  /**
   * Adds a job to the queue without creating a new Queue instance
   * @param queueName - Name of the queue to add the job to
   * @param jobName - Name of the job
   * @param options - Job options including data and configuration
   */
  public async add(queueName: string, jobName: string, options?: IQueueJobOptions) {
    if (!this._queues[queueName]) {
      this._queues[queueName] = this.createQueue(queueName, options?.jobOptions);
    }

    // remove previous job if it is all there
    // due to shutdown of process, still have this key in the redis, so job cannot be run
    if (options?.removePreviousJob && options?.jobUnique && options?.jobOptions?.jobId) {
      try {
        // https://github.com/taskforcesh/bullmq/issues/374
        // wait until it is unlocked, up to 30 seconds (default value)
        await this.removeJobUtilDone(queueName, options.jobOptions.jobId);
      } catch {
        // TODO - do something here?
      }
    }

    await this._queues[queueName].add(jobName, options?.data, options?.jobOptions || {});
    this.addActiveQueueJob(queueName, jobName, options);
    this.addActiveUniqueJobName(queueName, jobName, options);
  }

  /**
   * Create and start a worker for processing jobs in a queue
   * Supports horizontal scaling - multiple instances can share the same queue
   *
   * Note: Workers registered here will be tracked by QueueWorkerHolderSingleton,
   * allowing scheduler-based jobs (e.g., upsertJobScheduler) to be recognized
   * as active in isInActiveQueueJob() checks.
   *
   * @param queueName - Name of the queue to process
   * @param handler - Job processing function
   * @param options - Worker configuration options
   */
  public processWorker(queueName: string, handler: any, options?: Partial<WorkerOptions>) {
    if (QueueWorkerHolderSingleton.getByName(queueName)) {
      return;
    }

    const { redisConfig, skipVersionCheck } = this.redisQueueParams;
    const prefix = this.getQueuePrefix(queueName);

    const worker = new Worker(queueName, handler, {
      ...(options || {}),
      autorun: false,
      connection: redisConfig,
      // https://docs.bullmq.io/bull/patterns/redis-cluster
      // Use curly braces for Redis cluster compatibility
      prefix: `{${prefix}}`,
      // New BullMQ features
      ...(skipVersionCheck && { skipVersionCheck: true })
    });
    worker.run();

    // Track worker in singleton - this enables isInActiveQueueJob() to recognize
    // scheduler-based jobs as active
    QueueWorkerHolderSingleton.addToList(worker);
  }

  /**
   * Sets up a handler for completed jobs in a queue
   * @param queueName - Name of the queue to monitor
   * @param handler - Function to handle completed jobs
   */
  public onCompleted(queueName: string, handler: any) {
    const worker = QueueWorkerHolderSingleton.getByName(queueName);
    if (!worker) throw new Error(`Worker ${queueName} is not ready!`);
    worker.on('completed', handler);
  }

  /**
   * Sets up a handler for failed jobs in a queue
   * @param queueName - Name of the queue to monitor
   * @param handler - Function to handle failed jobs
   */
  public onFailed(queueName: string, handler: any) {
    const worker = QueueWorkerHolderSingleton.getByName(queueName);
    if (!worker) throw new Error(`Worker ${queueName} is not ready!`);
    worker.on('failed', handler);
  }

  /**
   * Creates a shortened prefix using MD5 hash for Redis cluster compatibility
   * @param str - The string to hash
   * @param len - The length of the prefix to return (default: 5)
   * @returns A shortened hash prefix
   */
  protected shortenPrefix(str: string, len = 5) {
    return createHash('md5').update(str).digest('hex').substring(0, len);
  }

  /**
   * Gets queue prefix for Redis cluster compatibility
   * Combines environment prefix with queue-specific prefix to avoid overlap
   * @param queueName - Name of the queue
   * @returns Prefix string for Redis keys
   */
  protected getQueuePrefix(queueName: string): string {
    const { redisPrefix, prefixLength } = this.redisQueueParams;

    // Always generate queue-specific prefix for separation
    const queueSpecificPrefix = this.shortenPrefix(queueName, prefixLength || 5);

    if (redisPrefix) {
      // Combine environment prefix with queue-specific prefix
      // Example: "prod-a1b2c" for cleanup queue, "prod-d3e4f" for charging queue
      return `${redisPrefix}-${queueSpecificPrefix}`;
    }

    // Use only queue-specific prefix when no environment prefix is set
    return queueSpecificPrefix;
  }

  /**
   * Adds an active queue job to the tracking record
   * @param queueName - Name of the queue
   * @param jobName - Name of the job
   * @param options - Job options to store
   */
  protected addActiveQueueJob(queueName: string, jobName: string, options: any) {
    this._activeQueueAndJobs[`${queueName}:${jobName}`] = options;
  }

  /**
   * Adds a unique job name to the active tracking list
   * @param queueName - Name of the queue
   * @param jobName - Name of the job
   * @param options - Job options containing unique job configuration
   */
  protected addActiveUniqueJobName(queueName: string, jobName: string, options?: IQueueJobOptions) {
    if (!options?.jobUnique || !options?.jobOptions?.jobId) return;
    const name = `${queueName}:${jobName}:${options?.jobOptions?.jobId}`;

    if (!this._activeUniqueJobs.includes(name)) {
      this._activeUniqueJobs.push(name);
    }
  }

  /**
   * Recursively removes a job until it's completely done
   * @param queueName - Name of the queue
   * @param jobId - ID of the job to remove
   * @returns Promise that resolves when job is removed
   */
  private async removeJobUtilDone(queueName: string, jobId: string) {
    if (!this._queues[queueName]) return true;

    const job = await this._queues[queueName].getJob(jobId);
    if (!job) return true;

    await this._queues[queueName].remove(jobId);
    return new Promise((rs) => {
      setTimeout(async () => {
        rs(this.removeJobUtilDone(queueName, jobId));
      }, 1000);
    });
  }
}
