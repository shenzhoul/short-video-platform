import { ForbiddenException } from '@nestjs/common';
import { MessageRequestPendingException } from 'src/common/exceptions/message';
import { ObjectId } from 'mongodb';

import { MessageService } from './message.service';

describe('MessageService', () => {
  const conversationId = new ObjectId();
  let sender: any;
  let recipientId: ObjectId;

  const buildService = (overrides: Record<string, any> = {}) => {
    const conversation = {
      _id: conversationId,
      recipientIds: [sender._id, recipientId],
      toObject() { return this; }
    };

    const messageModel = {
      create: jest.fn(async (doc: any) => ({ ...doc, _id: new ObjectId() })),
      find: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
      ...overrides.messageModel
    };
    const conversationService = {
      findForMember: jest.fn().mockResolvedValue(conversation),
      applyLastMessage: jest.fn().mockResolvedValue(undefined),
      ...overrides.conversationService
    };
    const participantService = {
      recordMessage: jest.fn().mockResolvedValue(undefined),
      markConversationRead: jest.fn().mockResolvedValue({ cleared: 2 }),
      markAllRead: jest.fn().mockResolvedValue({ updated: 3 }),
      getUnreadTotals: jest.fn().mockResolvedValue({
        totalUnreadMessages: 0, totalUnreadConversations: 0
      }),
      ...overrides.participantService
    };
    const permissionService = {
      claimSendSlot: jest.fn().mockResolvedValue({
        allowed: true, isMutualFollow: false, requestState: 'waiting', restrictionReason: null,
        transition: 'request-sent', previousPendingSenderId: null
      }),
      releaseSendSlot: jest.fn().mockResolvedValue(true),
      ...overrides.permissionService
    };
    const contentFileService = {
      validateAndRetrieveOwnedFiles: jest.fn().mockResolvedValue([]),
      ...overrides.contentFileService
    };
    const fileServerService = {
      findByIds: jest.fn().mockResolvedValue([]),
      addRefToMultipleFiles: jest.fn().mockResolvedValue(undefined),
      ...overrides.fileServerService
    };
    const queueMessageService = { publish: jest.fn().mockResolvedValue(undefined) };
    const sharedPostService = {
      resolveMany: jest.fn().mockResolvedValue(new Map()),
      resolveOne: jest.fn(),
      assertShareable: jest.fn(),
      ...overrides.sharedPostService
    };

    return {
      service: new MessageService(
        messageModel as any,
        conversationService as any,
        participantService as any,
        permissionService as any,
        sharedPostService as any,
        contentFileService as any,
        fileServerService as any,
        queueMessageService as any
      ),
      messageModel,
      conversationService,
      participantService,
      permissionService,
      sharedPostService,
      contentFileService,
      queueMessageService
    };
  };

  beforeEach(() => {
    sender = { _id: new ObjectId(), isAdmin: false };
    recipientId = new ObjectId();
  });

  describe('send', () => {
    it('claims the send slot before writing the message', async () => {
      const order: string[] = [];
      const { service } = buildService({
        permissionService: {
          claimSendSlot: jest.fn(async () => {
            order.push('claim');
            return {
              allowed: true, isMutualFollow: false, requestState: 'waiting',
              restrictionReason: null, transition: 'request-sent', previousPendingSenderId: null
            };
          })
        },
        messageModel: {
          create: jest.fn(async (doc: any) => {
            order.push('insert');
            return { ...doc, _id: new ObjectId() };
          })
        }
      });

      await service.send(conversationId, { text: 'hello' } as any, sender);

      // Inserting first would let two concurrent sends both write a message
      // before either claim resolved, which is the whole race the claim exists
      // to prevent.
      expect(order).toEqual(['claim', 'insert']);
    });

    it('refuses to write anything when the claim is denied', async () => {
      const { service, messageModel, participantService, queueMessageService } = buildService({
        permissionService: {
          claimSendSlot: jest.fn().mockResolvedValue({
            allowed: false, isMutualFollow: false, requestState: 'waiting',
            restrictionReason: 'awaiting_reply', transition: 'none', previousPendingSenderId: null
          })
        }
      });

      await expect(service.send(conversationId, { text: 'again' } as any, sender))
        .rejects.toBeInstanceOf(MessageRequestPendingException);

      expect(messageModel.create).not.toHaveBeenCalled();
      expect(participantService.recordMessage).not.toHaveBeenCalled();
      expect(queueMessageService.publish).not.toHaveBeenCalled();
    });

    it('validates attachment ownership before spending the sender\'s one message', async () => {
      const fileId = new ObjectId().toString();
      const { service, permissionService } = buildService({
        contentFileService: {
          validateAndRetrieveOwnedFiles: jest.fn().mockRejectedValue(new ForbiddenException())
        }
      });

      await expect(service.send(conversationId, { text: '', fileIds: [fileId] } as any, sender))
        .rejects.toBeInstanceOf(ForbiddenException);

      // A rejected file must not consume the restricted send slot — otherwise a
      // bad upload would silently cost the sender their only message.
      expect(permissionService.claimSendSlot).not.toHaveBeenCalled();
    });

    it('releases the claim when the insert fails, so the sender is not falsely blocked', async () => {
      const previous = new ObjectId();
      const failure = new Error('write failed');
      const { service, permissionService } = buildService({
        permissionService: {
          claimSendSlot: jest.fn().mockResolvedValue({
            allowed: true, isMutualFollow: false, requestState: 'waiting',
            restrictionReason: null, transition: 'request-sent', previousPendingSenderId: previous
          })
        },
        messageModel: { create: jest.fn().mockRejectedValue(failure) }
      });

      await expect(service.send(conversationId, { text: 'hi' } as any, sender)).rejects.toBe(failure);

      // The whole claim is handed back, so the release knows which transition to
      // undo rather than guessing from a bare id.
      expect(permissionService.releaseSendSlot).toHaveBeenCalledWith(
        conversationId, sender._id,
        expect.objectContaining({ transition: 'request-sent', previousPendingSenderId: previous })
      );
    });

    it('does not let a failed rollback mask the original error', async () => {
      const failure = new Error('write failed');
      const { service } = buildService({
        messageModel: { create: jest.fn().mockRejectedValue(failure) },
        permissionService: {
          claimSendSlot: jest.fn().mockResolvedValue({
            allowed: true, isMutualFollow: false, requestState: 'waiting',
            restrictionReason: null, transition: 'request-sent', previousPendingSenderId: null
          }),
          releaseSendSlot: jest.fn().mockRejectedValue(new Error('rollback also failed'))
        }
      });

      await expect(service.send(conversationId, { text: 'hi' } as any, sender)).rejects.toBe(failure);
    });

    it('reports the sender as waiting after sending the request message', async () => {
      const { service } = buildService();

      const result = await service.send(conversationId, { text: 'hi' } as any, sender);

      expect(result.canSend).toBe(false);
      expect(result.awaitingReplyFrom).toBe('me');
    });

    it('reports a replier as free once their reply accepted the request', async () => {
      const { service } = buildService({
        permissionService: {
          claimSendSlot: jest.fn().mockResolvedValue({
            allowed: true, isMutualFollow: false, requestState: 'accepted',
            restrictionReason: null, transition: 'request-accepted', previousPendingSenderId: new ObjectId()
          })
        }
      });

      const result = await service.send(conversationId, { text: 'reply' } as any, sender);

      // The correction: answering a request frees the replier too, rather than
      // handing the restriction back to them.
      expect(result.canSend).toBe(true);
      expect(result.requestState).toBe('accepted');
      expect(result.awaitingReplyFrom).toBeNull();
    });

    it('reports a mutual sender as still able to send', async () => {
      const { service } = buildService({
        permissionService: {
          claimSendSlot: jest.fn().mockResolvedValue({
            allowed: true, isMutualFollow: true, requestState: 'mutual',
            restrictionReason: null, transition: 'none', previousPendingSenderId: null
          })
        }
      });

      const result = await service.send(conversationId, { text: 'hi' } as any, sender);

      expect(result.canSend).toBe(true);
      expect(result.awaitingReplyFrom).toBeNull();
    });

    it('publishes delivery separately from creation', async () => {
      const { service, queueMessageService } = buildService();

      await service.send(conversationId, { text: 'hi' } as any, sender);

      const [channel, event] = queueMessageService.publish.mock.calls[0];
      expect(channel).toBe('MESSAGE_CHANNELS.MESSAGE');
      expect(event.eventName).toBe('message:created');
      // The payload names both sides, so the delivery subscriber never has to
      // reload the conversation just to learn who to emit to.
      expect(event.data.senderId).toBe(sender._id.toString());
      expect(event.data.recipientId).toBe(recipientId.toString());
    });

    it('derives the stored type from the uploaded file, not from the request', async () => {
      const fileId = new ObjectId().toString();
      const { service, messageModel } = buildService({
        contentFileService: {
          validateAndRetrieveOwnedFiles: jest.fn().mockResolvedValue([{
            _id: fileId,
            isVideo: () => true,
            isImage: () => false,
            toPublicResponse: () => ({ _id: fileId })
          }])
        }
      });

      // The client claimed "image"; the file server says it is a video.
      await service.send(conversationId, { type: 'image', text: '', fileIds: [fileId] } as any, sender);

      expect(messageModel.create.mock.calls[0][0].type).toBe('video');
    });
  });

  /**
   * What happens to the consent state when the row does not get written.
   *
   * The claim moves conversation state before the insert, so a failed insert
   * leaves that state describing a message that does not exist. The compensation
   * is the only thing standing between a crash and a sender who has silently
   * spent their one message request, or a request marked accepted by a reply
   * nobody can read.
   */
  describe('compensation when the insert fails', () => {
    const failing = (error: Error) => ({
      messageModel: { create: jest.fn().mockRejectedValue(error) }
    });

    it('releases the claim it made', async () => {
      const { service, permissionService } = buildService(failing(new Error('write failed')));

      await expect(service.send(conversationId, { text: 'hello' } as any, sender))
        .rejects.toThrow('write failed');

      expect(permissionService.releaseSendSlot).toHaveBeenCalledWith(
        conversationId,
        sender._id,
        expect.objectContaining({ transition: 'request-sent' })
      );
    });

    it('gives the sender their message request allowance back', async () => {
      // Otherwise a crash costs them the one message they were allowed to send.
      const { service, permissionService } = buildService(failing(new Error('write failed')));

      await service.send(conversationId, { text: 'hi' } as any, sender).catch(() => null);

      const [, , claim] = permissionService.releaseSendSlot.mock.calls[0];
      expect(claim.transition).toBe('request-sent');
    });

    it('does not leave a request accepted by a reply that was never stored', async () => {
      const { service, permissionService } = buildService({
        ...failing(new Error('write failed')),
        permissionService: {
          claimSendSlot: jest.fn().mockResolvedValue({
            allowed: true,
            isMutualFollow: false,
            requestState: 'accepted',
            restrictionReason: null,
            transition: 'request-accepted',
            previousPendingSenderId: recipientId
          })
        }
      });

      await service.send(conversationId, { text: 'thanks' } as any, sender).catch(() => null);

      const [, , claim] = permissionService.releaseSendSlot.mock.calls[0];
      expect(claim.transition).toBe('request-accepted');
      // The pending sender has to be restored, not dropped, or the request
      // silently becomes nobody's.
      expect(claim.previousPendingSenderId).toEqual(recipientId);
    });

    it('publishes nothing and moves no preview when the write failed', async () => {
      const {
        service, queueMessageService, conversationService, participantService
      } = buildService(failing(new Error('write failed')));

      await service.send(conversationId, { text: 'hello' } as any, sender).catch(() => null);

      expect(queueMessageService.publish).not.toHaveBeenCalled();
      expect(conversationService.applyLastMessage).not.toHaveBeenCalled();
      expect(participantService.recordMessage).not.toHaveBeenCalled();
    });

    it('reports the original failure, not the compensation', async () => {
      // A compensation that swallowed the cause would leave the crash invisible.
      const { service } = buildService({
        ...failing(new Error('write failed')),
        permissionService: {
          releaseSendSlot: jest.fn().mockRejectedValue(new Error('release also failed'))
        }
      });

      await expect(service.send(conversationId, { text: 'hello' } as any, sender))
        .rejects.toThrow('write failed');
    });

    it('lets a retry send successfully once the fault is gone', async () => {
      // The claim was released, so the retry is allowed to claim again.
      const create = jest.fn()
        .mockRejectedValueOnce(new Error('write failed'))
        .mockImplementation(async (doc: any) => ({ ...doc, _id: new ObjectId() }));
      const { service, messageModel } = buildService({ messageModel: { create } });

      await service.send(conversationId, { text: 'hello' } as any, sender).catch(() => null);
      const result = await service.send(conversationId, { text: 'hello' } as any, sender);

      expect(result.message).toBeTruthy();
      // Exactly one message survives the retry, not two.
      expect(messageModel.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('read', () => {
    it('checks membership before clearing a conversation', async () => {
      const { service, conversationService, participantService } = buildService();

      await service.markConversationRead(conversationId, sender);

      expect(conversationService.findForMember).toHaveBeenCalledWith(conversationId, sender._id);
      expect(participantService.markConversationRead).toHaveBeenCalled();
    });

    it('announces authoritative totals rather than a delta', async () => {
      const { service, queueMessageService } = buildService({
        participantService: {
          getUnreadTotals: jest.fn().mockResolvedValue({
            totalUnreadMessages: 5, totalUnreadConversations: 2
          })
        }
      });

      await service.markConversationRead(conversationId, sender);

      const [, event] = queueMessageService.publish.mock.calls[0];
      expect(event.eventName).toBe('message:read');
      // Absolute totals, so a client that missed an earlier frame still
      // converges instead of accumulating drift.
      expect(event.data.totals).toEqual({ totalUnreadMessages: 5, totalUnreadConversations: 2 });
      expect(event.data.conversationIds).toEqual([conversationId.toString()]);
    });

    it('signals a read-all with a null conversation list', async () => {
      const { service, queueMessageService } = buildService();

      await expect(service.markAllRead(sender)).resolves.toEqual({ updated: 3 });

      const [, event] = queueMessageService.publish.mock.calls[0];
      expect(event.data.conversationIds).toBeNull();
    });
  });

  describe('search', () => {
    it('refuses history for a conversation the caller does not belong to', async () => {
      const denied = new Error('not found');
      const { service, messageModel } = buildService({
        conversationService: { findForMember: jest.fn().mockRejectedValue(denied) }
      });

      await expect(service.search(conversationId, {} as any, sender)).rejects.toBe(denied);
      expect(messageModel.find).not.toHaveBeenCalled();
    });

    it('sorts by createdAt and _id so a page boundary cannot split same-millisecond messages', async () => {
      const rows = [
        { _id: new ObjectId(), conversationId, fileIds: [], createdAt: new Date() }
      ];
      const chain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(rows)
      };
      const { service } = buildService({ messageModel: { find: jest.fn().mockReturnValue(chain) } });

      await service.search(conversationId, { limit: 20 } as any, sender);

      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    });
  });
});
