import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { EntityNotFoundException } from 'src/kernel';

import { ConversationService } from './conversation.service';

describe('ConversationService', () => {
  describe('buildHashKey', () => {
    it('produces the same key regardless of who opens the conversation', () => {
      const a = new ObjectId();
      const b = new ObjectId();

      // This is what collapses "A messages B" and "B messages A" into one
      // conversation. Without the sort the two directions would be distinct
      // keys and the unique index would happily hold both.
      expect(ConversationService.buildHashKey(a, b))
        .toBe(ConversationService.buildHashKey(b, a));
    });

    it('produces different keys for different pairs', () => {
      const a = new ObjectId();
      const b = new ObjectId();
      const c = new ObjectId();

      expect(ConversationService.buildHashKey(a, b))
        .not.toBe(ConversationService.buildHashKey(a, c));
    });
  });

  describe('findOrCreateDirectConversation', () => {
    const buildService = (overrides: Record<string, any> = {}) => {
      const conversationModel = {
        findOneAndUpdate: jest.fn(),
        findOne: jest.fn(),
        find: jest.fn(),
        updateOne: jest.fn(),
        ...overrides.conversationModel
      };
      const participantModel = {
        findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }),
        find: jest.fn(),
        countDocuments: jest.fn(),
        ...overrides.participantModel
      };
      const userModel = {
        exists: jest.fn().mockResolvedValue(true),
        find: jest.fn(),
        ...overrides.userModel
      };
      const baseUserService = {
        findById: jest.fn().mockResolvedValue(null),
        findByIds: jest.fn().mockResolvedValue([])
      };
      const followService = {
        areMutuallyFollowing: jest.fn().mockResolvedValue(false),
        getMutualFollowerIdSet: jest.fn().mockResolvedValue(new Set())
      };
      const permissionService = {
        describe: jest.fn().mockReturnValue({
          isMutualFollow: false, canSend: true, requestState: 'idle', awaitingReplyFrom: null, restrictionReason: null
        }),
        describeForPair: jest.fn().mockResolvedValue({
          isMutualFollow: false, canSend: true, requestState: 'idle', awaitingReplyFrom: null, restrictionReason: null
        })
      };

      const participantService = { ensureParticipants: jest.fn().mockResolvedValue(undefined) };

      return {
        service: new ConversationService(
          conversationModel as any,
          participantModel as any,
          userModel as any,
          baseUserService as any,
          followService as any,
          permissionService as any,
          participantService as any
        ),
        conversationModel,
        userModel,
        participantService
      };
    };

    it('upserts on the pair key rather than reading then creating', async () => {
      const me = new ObjectId();
      const other = new ObjectId();
      const doc = { _id: new ObjectId(), recipientIds: [me, other], pendingSenderId: null };
      const { service, conversationModel } = buildService({
        conversationModel: {
          findOneAndUpdate: jest.fn().mockReturnValue({ lean: () => Promise.resolve(doc) })
        }
      });

      await service.findOrCreateDirectConversation(me, other);

      const [filter, update, options] = conversationModel.findOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ hashKey: ConversationService.buildHashKey(me, other) });
      expect(update.$setOnInsert.hashKey).toBe(ConversationService.buildHashKey(me, other));
      // $setOnInsert, so reopening an existing conversation never resets its
      // permission state or wipes its preview.
      expect(update.$set).toBeUndefined();
      expect(options.upsert).toBe(true);
    });

    it('recovers by re-reading when it loses the unique-index race', async () => {
      const me = new ObjectId();
      const other = new ObjectId();
      const winner = { _id: new ObjectId(), recipientIds: [me, other], pendingSenderId: null };
      const duplicateKeyError: any = new Error('E11000 duplicate key');
      duplicateKeyError.code = 11000;

      const { service, conversationModel } = buildService({
        conversationModel: {
          findOneAndUpdate: jest.fn().mockReturnValue({
            lean: () => Promise.reject(duplicateKeyError)
          }),
          findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(winner) })
        }
      });

      const result = await service.findOrCreateDirectConversation(me, other);

      // The duplicate is resolved into the conversation the winner created,
      // not surfaced to the caller as a 500.
      expect(result._id).toEqual(winner._id);
      expect(conversationModel.findOne).toHaveBeenCalledWith({
        hashKey: ConversationService.buildHashKey(me, other)
      });
    });

    it('rethrows errors that are not duplicate-key collisions', async () => {
      const failure: any = new Error('connection lost');
      const { service } = buildService({
        conversationModel: {
          findOneAndUpdate: jest.fn().mockReturnValue({ lean: () => Promise.reject(failure) })
        }
      });

      await expect(service.findOrCreateDirectConversation(new ObjectId(), new ObjectId()))
        .rejects.toBe(failure);
    });

    it('refuses a conversation with yourself', async () => {
      const me = new ObjectId();
      const { service } = buildService();

      await expect(service.findOrCreateDirectConversation(me, me))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an inactive or missing participant', async () => {
      const { service } = buildService({ userModel: { exists: jest.fn().mockResolvedValue(null) } });

      await expect(service.findOrCreateDirectConversation(new ObjectId(), new ObjectId()))
        .rejects.toBeInstanceOf(EntityNotFoundException);
    });
  });

  describe('findForMember', () => {
    const buildService = (findOneResult: any) => {
      const conversationModel = { findOne: jest.fn().mockResolvedValue(findOneResult) };
      return {
        conversationModel,
        service: new ConversationService(
          conversationModel as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any
        )
      };
    };

    it('scopes the lookup by membership so another pair\'s conversation is simply not found', async () => {
      const me = new ObjectId();
      const conversationId = new ObjectId();
      const { service, conversationModel } = buildService(null);

      await expect(service.findForMember(conversationId, me))
        .rejects.toBeInstanceOf(EntityNotFoundException);

      // Membership is part of the query, not a check afterwards: the service
      // never loads a conversation it is going to refuse, so the response
      // cannot leak that somebody else's conversation exists.
      const [filter] = conversationModel.findOne.mock.calls[0];
      expect(filter.recipientIds.toString()).toBe(me.toString());
    });

    it('treats a malformed id as not found rather than throwing a cast error', async () => {
      const { service, conversationModel } = buildService(null);

      await expect(service.findForMember('not-an-object-id', new ObjectId()))
        .rejects.toBeInstanceOf(EntityNotFoundException);
      expect(conversationModel.findOne).not.toHaveBeenCalled();
    });
  });
});
