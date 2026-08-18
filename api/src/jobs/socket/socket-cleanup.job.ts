import { Injectable, Logger } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import {
  SOCKET_CHANNELS, SOCKET_EVENTS,
  SOCKET_ROOMS
} from 'src/common/constants/community';
import { QueueMessageService, QueueService } from 'src/kernel';

export const CONNECTED_USER_REDIS_KEY = 'connected_users';
const SCHEDULE_OFFLINE_SOCKETS = 'SCHEDULE_OFFLINE_SOCKETS';

/** Cron pattern for socket cleanup job - runs every 2 minutes */
const SCHEDULE_JOB_REPEAT_PATTERN = '*/2 * * * *';

/**
 * Socket Cleanup Job
 *
 * Background job service for cleaning up stale socket connections and maintaining
 * accurate online user status. Runs every 2 minutes to validate socket connections
 * against actual connected sockets and removes disconnected ones.
 *
 * Key Features:
 * - Scheduled cleanup of stale socket connections
 * - Real-time online/offline status updates
 * - Redis-based connection state validation
 * - Automatic offline event publishing
 * - Multi-socket support per user
 * - Horizontal scaling compatibility
 *
 * Process:
 * 1. Gets all users marked as online in Redis
 * 2. Checks each user's socket connections against actual connected sockets
 * 3. Removes stale socket IDs from Redis
 * 4. If user has no remaining connections, marks as offline and publishes events
 * 5. Broadcasts offline status to global room
 *
 * Note: Currently handles single-node deployments only. For multi-node setups,
 * see: https://stackoverflow.com/questions/58977848/socket-io-with-socket-io-redis-get-all-socket-object-in-a-room
 */
@Injectable()
@WebSocketGateway()
export class SocketCleanupJob {
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(SocketCleanupJob.name);

  constructor(
    @InjectRedis() private readonly redisClient: Redis,
    private readonly queueMessageService: QueueMessageService,
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
      this.logger.error(`Failed to initialize socket cleanup jobs: ${error.message}`, error.stack);
    });
  }

  /**
   * Add socket cleanup job scheduler with recurring schedule
   *
   * Uses the new BullMQ v5.16+ Job Scheduler pattern for better horizontal scaling.
   * Creates a recurring job that runs every 2 minutes to clean up stale
   * socket connections and maintain accurate online user status.
   *
   * @private
   */
  private async addJobScheduler() {
    // Get the queue instance to use the new upsertJobScheduler method
    const queue = this.queueService.createQueue(SCHEDULE_OFFLINE_SOCKETS);

    // Use the new Job Scheduler pattern (replaces repeatable jobs)
    await queue.upsertJobScheduler(
      SCHEDULE_OFFLINE_SOCKETS, // scheduler ID
      { pattern: SCHEDULE_JOB_REPEAT_PATTERN }, // repeat options
      {
        name: SCHEDULE_OFFLINE_SOCKETS, // job template name
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
   * Define and initialize scheduled jobs
   *
   * Sets up the job queue and worker for handling offline socket cleanup.
   * Called during service initialization.
   *
   * @private
   */
  private async defineJobs() {
    await this.addJobScheduler();

    this.queueService.processWorker(SCHEDULE_OFFLINE_SOCKETS, this.scheduleOfflineSockets.bind(this));
  }

  /**
   * Scheduled job to clean up offline socket connections
   *
   * Runs every 2 minutes to validate socket connections and clean up stale entries.
   * Compares Redis-stored socket IDs with actual connected sockets and removes
   * disconnected ones. Publishes offline events for users with no remaining connections.
   *
   * Process:
   * 1. Validates job is active and has correct pattern
   * 2. Gets all users marked as online in Redis
   * 3. Checks each user's socket connections against actual connected sockets
   * 4. Removes stale socket IDs from Redis
   * 5. If user has no remaining connections, marks as offline and publishes events
   * 6. Broadcasts offline status to global room
   *
   * Note: Currently handles single-node deployments only. For multi-node setups,
   * see: https://stackoverflow.com/questions/58977848/socket-io-with-socket-io-redis-get-all-socket-object-in-a-room
   *
   * @param job - BullMQ job instance with scheduling information
   * @private
   */
  private async scheduleOfflineSockets(job: Job): Promise<void> {
    try {
      // Validate this job is from an active worker (handles both add() and scheduler-based jobs)
      if (!this.queueService.isInActiveQueueJob(job)) {
        return;
      }

      // For Job Scheduler pattern, validate by job name instead of deprecated jobId
      if (job.name !== SCHEDULE_OFFLINE_SOCKETS) return;

      // Additional validation: ensure this is a scheduled job (has repeat metadata)
      const { repeat } = job.opts;
      if (!repeat || repeat.pattern !== SCHEDULE_JOB_REPEAT_PATTERN) return;
      // get all online users in the redis and check if socket is exist
      const onlineUserIds = await this.redisClient.smembers(
        CONNECTED_USER_REDIS_KEY
      );
      await onlineUserIds.reduce(async (previousPromise, userId) => {
        await previousPromise;

        const socketIds = await this.redisClient.smembers(userId);
        // handle for single node only, for multi nodes, please check here
        // https://stackoverflow.com/questions/58977848/socket-io-with-socket-io-redis-get-all-socket-object-in-a-room
        const sockets = await this.server.fetchSockets();
        const connectedSockets = sockets.map((socket) => socket.id);
        // remove keys doesn't have in connected list and update status
        let hasOnline = false;
        await socketIds.reduce(async (lP, socketId) => {
          await lP;
          if (connectedSockets.includes(socketId)) {
            hasOnline = true;
          } else {
            await this.redisClient.srem(userId, socketId);
          }

          return Promise.resolve();
        }, Promise.resolve());

        if (!hasOnline) {
          await this.redisClient.srem(CONNECTED_USER_REDIS_KEY, userId);

          /**
           * emit offline, in this case we will send 2 events for both user and creator temperatyly
           */
          await this.queueMessageService.publish(SOCKET_CHANNELS.USER_CONNECTED, {
            eventName: SOCKET_EVENTS.DISCONNECTED,
            data: {
              userId
            }
          });

          // Emit to global room using server instance
          this.server.to(SOCKET_ROOMS.GLOBAL).emit('online', {
            userId,
            online: false
          });
        }

        return Promise.resolve();
      }, Promise.resolve());
    } catch (e) {
      this.logger.error(e.stack || e, { context: 'SocketCleanupJob' });
    }
  }
}
