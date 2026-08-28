import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ObjectId } from 'mongodb';
import { REACTION_TARGET_TYPES, SHARE_CHANNELS, SHARE_EVENTS } from 'src/common/constants/community';
import { DuplicateShareException } from 'src/common/exceptions/message';
import { MessageDto } from 'src/dtos/community/message';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { QueueMessageService } from 'src/kernel';

import { CommunicationService } from '../communication.service';
import { MessageService } from '../message/message.service';
import { REDIS_KEYS } from 'src/kernel/infras/redis/redis-keys';

export interface PostShareResult {
  message: MessageDto;
  conversationId: ObjectId;
  /**
   * Whether this share moved the post's counter.
   *
   * False for a repeat share by the same person, because `totalShare` counts
   * distinct sharers. The client uses it to decide whether to advance its own
   * number rather than guessing.
   */
  shareCounted: boolean;
}

/** How long two identical share attempts are treated as the same click. */
const DUPLICATE_WINDOW_SECONDS = 10;

/**
 * Sharing a post into a direct message.
 *
 * An orchestrator, deliberately: the message domain should not know that shares
 * are stored as reactions, and the reaction domain should not know that a
 * message exists. Each keeps its own rules; this composes them in the one order
 * that is safe.
 *
 * That order matters. The message is created **first**, and the counter moves
 * only after it exists. A share that is refused — no permission, post deleted,
 * recipient blocked — throws before the counter is ever touched, so a failed
 * share cannot inflate the statistic. The reverse order would need a
 * compensating decrement, and a decrement that fails leaves the number wrong
 * forever.
 *
 * The counter itself is unchanged from every other kind of share: `totalShare`
 * counts *distinct sharers*, so sharing one post to five friends is one share,
 * and sharing it again next week is none. The alternative — counting events —
 * would make the number mean something different before and after this feature,
 * with no way to reconcile the history.
 */
@Injectable()
export class PostShareService {
  private readonly logger = new Logger(PostShareService.name);

  constructor(
    private readonly messageService: MessageService,
    private readonly communicationService: CommunicationService,
    private readonly queueMessageService: QueueMessageService,
    @InjectRedis() private readonly redisClient: Redis
  ) {}

  /**
   * Share one post with one recipient.
   *
   * Guarded against a double click by a short-lived Redis key rather than an
   * in-process flag: the app runs behind a load balancer, and a flag in one
   * process does not stop the second click landing on another instance. The key
   * is released if the send throws, so a genuine retry after a failure is not
   * swallowed along with the accidental double.
   */
  public async shareToMessage(
    postId: string | ObjectId,
    recipientId: string | ObjectId,
    sender: UserDto | AuthUserDto
  ): Promise<PostShareResult> {
    const guardKey = this.buildGuardKey(sender._id, postId, recipientId);
    const claimed = await this.redisClient.set(guardKey, '1', 'EX', DUPLICATE_WINDOW_SECONDS, 'NX');

    if (claimed !== 'OK') {
      // A second click within the window. Reported as a duplicate rather than
      // an error: the user's intent already succeeded, and showing them a
      // failure for it would be wrong.
      throw new DuplicateShareException();
    }

    let result;
    try {
      result = await this.messageService.sharePost(postId, recipientId, sender);
    } catch (error) {
      // Only an accidental double click should be blocked; a share that failed
      // must be retryable straight away.
      await this.redisClient.del(guardKey).catch(() => undefined);
      throw error;
    }

    // The message is written, so the share happened. Recording it is bookkeeping
    // and must not turn a delivered share into an error for the sender — but it
    // must not be dropped either. The inline attempt keeps the common case exact
    // (the response can say whether the counter moved); a failure hands the work
    // to the queue, which retries with backoff. Both paths call the same
    // idempotent write, so a retry that races the original cannot double count.
    let shareCounted = false;
    try {
      const recorded = await this.communicationService.recordShare(
        REACTION_TARGET_TYPES.POST,
        postId,
        sender
      );
      shareCounted = Boolean(recorded?.created);
    } catch (error) {
      this.logger.error(
        `Share counter not updated inline for post ${postId}, queued for retry: ${error.message}`,
        error.stack
      );
      await this.queueRecordRetry(postId, sender, result.message?._id);
    }

    return {
      message: result.message,
      conversationId: result.conversationId as ObjectId,
      shareCounted
    };
  }

  /**
   * Hand an unrecorded share to the queue.
   *
   * Best effort in turn: if even publishing fails there is nothing more to do
   * inline, and the reconciliation script
   * (`api/scripts/reconcile-post-share-counts.js`) is the backstop that
   * recomputes `totalShare` from the share rows.
   */
  private async queueRecordRetry(
    postId: string | ObjectId,
    sender: UserDto | AuthUserDto,
    messageId?: ObjectId
  ): Promise<void> {
    try {
      await this.queueMessageService.publish(SHARE_CHANNELS.SHARE, {
        eventName: SHARE_EVENTS.RECORD_REQUESTED,
        data: {
          postId: postId.toString(),
          sharerId: sender._id.toString(),
          messageId: messageId ? messageId.toString() : null
        }
      });
    } catch (error) {
      this.logger.error(
        `Could not queue the share record for post ${postId}: ${error.message}`,
        error.stack
      );
    }
  }

  private buildGuardKey(
    senderId: string | ObjectId,
    postId: string | ObjectId,
    recipientId: string | ObjectId
  ): string {
    return REDIS_KEYS.sharePost(`${senderId}:${postId}:${recipientId}`);
  }
}
