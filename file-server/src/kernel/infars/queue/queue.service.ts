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

@Injectable()
export class QueueService implements OnModuleDestroy {
  private _queues: Record<string, Queue> = {};

  /**
   * placeholder to store queue and job name
   * issue we have is to change or rename schedule, repeat job and restart application
   * it wont be deleted in redis and will be executed 2 times
   * example
   * 1. run this job: this.queueService.add('test_schedule', 'test_schedule1', { repeat: { pattern: '*\/5 * * * * *'} } as any);
   * 2. stop app while 1 is not done yet (processing but not done job)
   * 3. rename job: this.queueService.add('test_schedule', 'test_schedule2', { repeat: { pattern: '*\/5 * * * * *'} } as any);
   * log test function: console.log('data queue', data.name, data.id); will show 2 lines
   * data queue test_schedule1 repeat:9ee31f9e1d5840816190def2ced7ea47:1718866730000
   * data queue test_schedule2 repeat:470763aae1a95c9e3823804de441e86b:1718866745000
   */
  private _activeQueueAndJobs: Record<string, any> = {};

  private _activeUniqueJobs: string[] = [];

  constructor(
    @Inject(CORE_QUEUE_MESSAGE_REDIS_CONNECTION) private readonly redisQueueParams: IRedisQueueParams
  ) { }

  async onModuleDestroy() {
    const queues = Object.values(this._queues);
    await Promise.allSettled(queues.map((queue) => queue.close()));
    this._queues = {};
  }

  public getActiveQueueJobs() {
    return { ...this._activeQueueAndJobs };
  }

  public isInActiveQueueJob(job: Job) {
    const props = Object.getOwnPropertyNames(this._activeQueueAndJobs);
    return props.includes(`${job.queueName}:${job.name}`);
  }

  /**
   * check if this unique job is in the active list
   * do not apply with repeat job
   * @param job
   * @returns
   */
  public isInActiveUniqueJob(job: Job) {
    const name = `${job.queueName}:${job.name}:${job.id}`;
    return this._activeUniqueJobs.includes(name);
  }

  /**
   * create new Queue
   * @param name
   * @returns
   */
  public createQueue(name: string, defaultJobOptions?: DefaultJobOptions) {
    if (this._queues[name]) {
      return this._queues[name];
    }

    const { redisQueueConnection, skipVersionCheck } = this.redisQueueParams;
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
      connection: redisQueueConnection as any,
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
   * add queue without create Queue
   * @param queueName
   * @param jobName
   * @param options
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
   * @param queueName - Name of the queue to process
   * @param handler - Job processing function
   * @param options - Worker configuration options
   */
  public processWorker(queueName: string, handler: any, options?: Partial<WorkerOptions>) {
    if (QueueWorkerHolderSingleton.getByName(queueName)) {
      return;
    }

    const { redisQueueConnection, skipVersionCheck } = this.redisQueueParams;
    const prefix = this.getQueuePrefix(queueName);

    const worker = new Worker(queueName, handler, {
      ...(options || {}),
      autorun: false,
      connection: redisQueueConnection as any,
      // https://docs.bullmq.io/bull/patterns/redis-cluster
      // Use curly braces for Redis cluster compatibility
      prefix: `{${prefix}}`,
      // New BullMQ features
      ...(skipVersionCheck && { skipVersionCheck: true })
    });
    worker.run();

    // add placeholder
    QueueWorkerHolderSingleton.addToList(worker);
  }

  public onCompleted(queueName: string, handler: any) {
    const worker = QueueWorkerHolderSingleton.getByName(queueName);
    if (!worker) throw new Error(`Worker ${queueName} is not ready!`);
    worker.on('completed', handler);
  }

  public onFailed(queueName: string, handler: any) {
    const worker = QueueWorkerHolderSingleton.getByName(queueName);
    if (!worker) throw new Error(`Worker ${queueName} is not ready!`);
    worker.on('failed', handler);
  }

  /**
   * hash md5 and get first 5 characters as new prefix
   * @param str
   * @returns
   */
  private shortenPrefix(str: string, len = 5) {
    return createHash('md5').update(str).digest('hex').substring(0, len);
  }

  /**
   * Get queue prefix for Redis cluster compatibility
   * Combines environment prefix with queue-specific prefix to avoid overlap
   * @param queueName - Name of the queue
   * @returns Prefix string for Redis keys
   */
  private getQueuePrefix(queueName: string): string {
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

  private addActiveQueueJob(queueName: string, jobName: string, options: any) {
    this._activeQueueAndJobs[`${queueName}:${jobName}`] = options;
  }

  private addActiveUniqueJobName(queueName: string, jobName: string, options: IQueueJobOptions) {
    if (!options.jobUnique || !options?.jobOptions?.jobId) return;
    const name = `${queueName}:${jobName}:${options?.jobOptions?.jobId}`;

    if (!this._activeUniqueJobs.includes(name)) {
      this._activeUniqueJobs.push(name);
    }
  }

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
