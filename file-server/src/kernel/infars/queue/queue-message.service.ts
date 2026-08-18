import { Inject, Injectable } from '@nestjs/common';
import { Processor, Queue, Worker } from 'bullmq';
import { createHash } from 'crypto';
import {
  CORE_QUEUE_MESSAGE_REDIS_CONNECTION,
  IRedisQueueParams,
  QueueEvent
} from './constants';
import { QueueWorkerHolderSingleton } from './queue-workers-holder';

@Injectable()
export class QueueMessageService {
  public static _availableChannelTopics = {} as Record<string, Array<string>>;

  private _queues = {} as Record<string, Queue>;

  private _workers = [] as Array<string>;

  constructor(
    @Inject(CORE_QUEUE_MESSAGE_REDIS_CONNECTION) private readonly redisQueueParams: IRedisQueueParams
  ) { }
  /**
   * create new Queue
   * @param name
   * @returns
   */
  public createQueue(name: string) {
    if (this._queues[name]) return this._queues[name];

    const { redisQueueConnection, skipVersionCheck } = this.redisQueueParams;
    const prefix = this.getQueuePrefix(name);

    const queue = new Queue(name, {
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: {
          // fail will be removed after 1h
          age: 3600,
          count: 10 // max 10 jobs
        }
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
   *
   * @param channel
   * @param data
   * @param jobName
   * @returns
   */
  async publish(channel: string, data: QueueEvent<any>, jobName = ''): Promise<void> {
    const topics = await this.getTopicsByChannel(channel);
    if (!topics?.length) {
      // eslint-disable-next-line no-console
      console.info(`No subscribers in queue message channel ${channel}!`);
      return;
    }

    await Promise.all(topics.map((queueName) => {
      const channelQueue = this.createQueue(queueName);
      return channelQueue.add(jobName || data.eventName, data);
    }));
  }

  async subscribe(channel: string, topic: string, handler: Processor<any, any, string>, options = {} as Record<string, any>) {
    // TODO - recheck and define if we need to create, define topic / channel list manually
    // avoid key is deleted
    await this.setChannelTopic(channel, topic);
    const { redisQueueConnection, skipVersionCheck } = this.redisQueueParams;

    const workerName = `${channel}_${topic}`;
    if (!this._workers.includes(workerName)) {
      this._workers.push(workerName);
      const prefix = this.getQueuePrefix(workerName);

      const worker = new Worker(workerName, handler, {
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
  }

  private async getTopicsByChannel(channel: string) {
    return QueueMessageService._availableChannelTopics[channel];
    // const key = `${QUEUE_SUBSCRIBE_CHANNELS_TOPICS_PREFIX}${channel}`;
    // const { redisQueueConnection } = this.redisQueueParams;
    // const topics = await redisQueueConnection.smembers(key);
    // return topics.map((t) => `${channel}_${t}`);
  }

  private async setChannelTopic(channel: string, topic: string) {
    // const { redisQueueConnection } = this.redisQueueParams;
    // // create channel if not exist
    // await redisQueueConnection.sadd(QUEUE_SUBSCRIBE_CHANNELS_SET, channel);

    // // add topic to that channel if not exist
    // const key = `${QUEUE_SUBSCRIBE_CHANNELS_TOPICS_PREFIX}${channel}`;
    // await redisQueueConnection.sadd(key, topic);

    // add to _availableChannelTopics
    if (!QueueMessageService._availableChannelTopics[channel]) {
      QueueMessageService._availableChannelTopics[channel] = [];
    }
    const topicKey = `${channel}_${topic}`;
    if (!QueueMessageService._availableChannelTopics[channel].includes(topicKey)) {
      QueueMessageService._availableChannelTopics[channel].push(topicKey);
    }
  }

  /**
   * hash md5 and get first N characters as new prefix
   * @param str
   * @param len - length of prefix, defaults to configured prefixLength
   * @returns
   */
  private shortenPrefix(str: string, len?: number) {
    const prefixLength = len || this.redisQueueParams.prefixLength || 5;
    return createHash('md5').update(str).digest('hex').substring(0, prefixLength);
  }

  /**
   * Get the prefix for a queue name
   * @param queueName
   * @returns
   */
  private getQueuePrefix(queueName: string): string {
    // Use custom prefix if provided, otherwise use shortened hash
    if (this.redisQueueParams.redisPrefix) {
      return this.redisQueueParams.redisPrefix;
    }
    return this.shortenPrefix(queueName);
  }
}
