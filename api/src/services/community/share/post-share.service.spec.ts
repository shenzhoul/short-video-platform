import { ObjectId } from 'mongodb';
import { DuplicateShareException } from 'src/common/exceptions/message';

import { PostShareService } from './post-share.service';

/**
 * The order this service imposes is the whole point of it existing.
 *
 * A share must never move the post's counter unless a message was actually
 * written, and a double click must not write two messages. Both are easy to get
 * subtly wrong, and both are invisible until the numbers drift.
 */
function createService(overrides: Record<string, any> = {}) {
  const messageService = {
    sharePost: jest.fn().mockResolvedValue({
      message: { _id: new ObjectId() },
      conversationId: new ObjectId(),
      canSend: true,
      requestState: 'accepted',
      awaitingReplyFrom: null
    }),
    ...overrides.messageService
  };
  const communicationService = {
    recordShare: jest.fn().mockResolvedValue({ recorded: true, created: true }),
    ...overrides.communicationService
  };

  // Behaves like Redis SET NX: the first caller wins, later ones get null until
  // the key is deleted.
  const store = new Set<string>();
  const redisClient = {
    set: jest.fn(async (key: string) => {
      if (store.has(key)) return null;
      store.add(key);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    ...overrides.redisClient
  };

  const queueMessageService = {
    publish: jest.fn().mockResolvedValue(undefined),
    ...overrides.queueMessageService
  };

  return {
    service: new PostShareService(
      messageService as any,
      communicationService as any,
      queueMessageService as any,
      redisClient as any
    ),
    messageService,
    communicationService,
    queueMessageService,
    redisClient
  };
}

describe('PostShareService', () => {
  const postId = new ObjectId();
  const recipientId = new ObjectId();
  const sender = { _id: new ObjectId() } as any;

  it('writes the message before it touches the counter', async () => {
    const order: string[] = [];
    const { service } = createService({
      messageService: {
        sharePost: jest.fn(async () => {
          order.push('message');
          return { message: { _id: new ObjectId() }, conversationId: new ObjectId() };
        })
      },
      communicationService: {
        recordShare: jest.fn(async () => {
          order.push('counter');
          return { recorded: true, created: true };
        })
      }
    });

    await service.shareToMessage(postId, recipientId, sender);

    expect(order).toEqual(['message', 'counter']);
  });

  it('does not count a share that was refused', async () => {
    const { service, communicationService } = createService({
      messageService: { sharePost: jest.fn().mockRejectedValue(new Error('blocked')) }
    });

    await expect(service.shareToMessage(postId, recipientId, sender)).rejects.toThrow('blocked');
    expect(communicationService.recordShare).not.toHaveBeenCalled();
  });

  it('reports whether the counter actually moved', async () => {
    // `totalShare` counts distinct sharers, so a repeat share by the same person
    // is a real share that moves nothing. The client needs to be told.
    const { service } = createService({
      communicationService: {
        recordShare: jest.fn().mockResolvedValue({ recorded: true, created: false })
      }
    });

    await expect(service.shareToMessage(postId, recipientId, sender))
      .resolves.toMatchObject({ shareCounted: false });
  });

  it('refuses the second of two identical clicks', async () => {
    const { service, messageService } = createService();

    await service.shareToMessage(postId, recipientId, sender);
    await expect(service.shareToMessage(postId, recipientId, sender))
      .rejects.toBeInstanceOf(DuplicateShareException);

    expect(messageService.sharePost).toHaveBeenCalledTimes(1);
  });

  it('still allows the same post to go to a different person', async () => {
    const { service, messageService } = createService();

    await service.shareToMessage(postId, recipientId, sender);
    await service.shareToMessage(postId, new ObjectId(), sender);

    expect(messageService.sharePost).toHaveBeenCalledTimes(2);
  });

  it('lets a failed share be retried immediately', async () => {
    // The guard exists for accidental doubles, not to lock somebody out of a
    // share that did not happen.
    const sharePost = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ message: { _id: new ObjectId() }, conversationId: new ObjectId() });
    const { service } = createService({ messageService: { sharePost } });

    await expect(service.shareToMessage(postId, recipientId, sender)).rejects.toThrow('transient');
    await expect(service.shareToMessage(postId, recipientId, sender)).resolves.toBeDefined();
    expect(sharePost).toHaveBeenCalledTimes(2);
  });

  it('delivers the share even when the counter update fails', async () => {
    const { service } = createService({
      communicationService: {
        recordShare: jest.fn().mockRejectedValue(new Error('reaction store down'))
      }
    });

    await expect(service.shareToMessage(postId, recipientId, sender))
      .resolves.toMatchObject({ shareCounted: false });
  });

  it('hands a failed counter update to the queue rather than dropping it', async () => {
    // The message exists, so the share happened. Logging and moving on would
    // undercount it for good.
    const { service, queueMessageService } = createService({
      communicationService: {
        recordShare: jest.fn().mockRejectedValue(new Error('reaction store down'))
      }
    });

    await service.shareToMessage(postId, recipientId, sender);

    expect(queueMessageService.publish).toHaveBeenCalledTimes(1);
    const [, payload] = queueMessageService.publish.mock.calls[0];
    expect(payload).toMatchObject({
      eventName: 'share:record-requested',
      data: expect.objectContaining({
        postId: postId.toString(),
        sharerId: sender._id.toString()
      })
    });
  });

  it('queues nothing when the counter update succeeded', async () => {
    const { service, queueMessageService } = createService();

    await service.shareToMessage(postId, recipientId, sender);

    expect(queueMessageService.publish).not.toHaveBeenCalled();
  });

  it('still delivers when even queueing the retry fails', async () => {
    // The reconciliation script is the backstop past this point; the sender
    // must not see an error for a message that was written.
    const { service } = createService({
      communicationService: {
        recordShare: jest.fn().mockRejectedValue(new Error('reaction store down'))
      },
      queueMessageService: {
        publish: jest.fn().mockRejectedValue(new Error('queue down'))
      }
    });

    await expect(service.shareToMessage(postId, recipientId, sender))
      .resolves.toMatchObject({ shareCounted: false });
  });
});

describe('duplicate guard scope', () => {
  const postId = new ObjectId();
  const sender = { _id: new ObjectId() } as any;

  it('lets the same post go to a second person immediately', async () => {
    // The key names the recipient, so sharing onwards is never mistaken for a
    // double click.
    const { service, messageService, redisClient } = createService();
    const bob = new ObjectId();
    const carol = new ObjectId();

    await service.shareToMessage(postId, bob, sender);
    await service.shareToMessage(postId, carol, sender);

    expect(messageService.sharePost).toHaveBeenCalledTimes(2);
    const keys = redisClient.set.mock.calls.map((call: any[]) => call[0]);
    expect(new Set(keys).size).toBe(2);
  });

  it('lets a different post go to the same person immediately', async () => {
    const { service, messageService } = createService();
    const bob = new ObjectId();

    await service.shareToMessage(postId, bob, sender);
    await service.shareToMessage(new ObjectId(), bob, sender);

    expect(messageService.sharePost).toHaveBeenCalledTimes(2);
  });

  it('keys the guard on sender, post and recipient together', async () => {
    const { service, redisClient } = createService();
    const bob = new ObjectId();

    await service.shareToMessage(postId, bob, sender);

    const [key, , mode, ttl, flag] = redisClient.set.mock.calls[0];
    expect(key).toBe(`share:post:${sender._id}:${postId}:${bob}`);
    // Set-if-absent with an expiry: the whole guard in one round trip, and it
    // cannot outlive the click it is protecting.
    expect(mode).toBe('EX');
    expect(ttl).toBe(10);
    expect(flag).toBe('NX');
  });

  it('does not let one sender block another', async () => {
    const { service, messageService } = createService();
    const bob = new ObjectId();
    const other = { _id: new ObjectId() } as any;

    await service.shareToMessage(postId, bob, sender);
    await service.shareToMessage(postId, bob, other);

    expect(messageService.sharePost).toHaveBeenCalledTimes(2);
  });

  it('creates one message when two tabs fire at the same instant', async () => {
    const { service, messageService } = createService();
    const bob = new ObjectId();

    const outcomes = await Promise.allSettled([
      service.shareToMessage(postId, bob, sender),
      service.shareToMessage(postId, bob, sender)
    ]);

    expect(messageService.sharePost).toHaveBeenCalledTimes(1);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1);
  });
});
