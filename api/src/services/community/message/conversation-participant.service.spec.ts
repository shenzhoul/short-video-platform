import { ObjectId } from 'mongodb';

import { ConversationParticipantService } from './conversation-participant.service';

describe('ConversationParticipantService', () => {
  const conversationId = new ObjectId();
  const sender = new ObjectId();
  const recipient = new ObjectId();

  const buildService = (model: Record<string, any>) => new ConversationParticipantService(model as any);

  describe('recordMessage', () => {
    it('increments only the recipient and leaves the sender read', async () => {
      const updateOne = jest.fn().mockResolvedValue({});
      const service = buildService({ updateOne });
      const createdAt = new Date();

      await service.recordMessage(conversationId, sender, recipient, createdAt);

      expect(updateOne).toHaveBeenCalledTimes(2);
      const [senderCall, recipientCall] = updateOne.mock.calls;

      // Sending is reading: the sender's own message must never make their own
      // badge light up.
      expect(senderCall[0].userId.toString()).toBe(sender.toString());
      expect(senderCall[1].$set.unreadCount).toBe(0);
      expect(senderCall[1].$inc).toBeUndefined();
      // Their row still rises to the top of their list.
      expect(senderCall[1].$set.lastMessageAt).toBe(createdAt);

      expect(recipientCall[0].userId.toString()).toBe(recipient.toString());
      expect(recipientCall[1].$inc).toEqual({ unreadCount: 1 });
      expect(recipientCall[2]).toEqual({ upsert: true });
    });
  });

  describe('markConversationRead', () => {
    it('clears only the caller\'s row and reports what it cleared', async () => {
      const findOneAndUpdate = jest.fn().mockReturnValue({
        lean: () => Promise.resolve({ unreadCount: 4 })
      });
      const service = buildService({ findOneAndUpdate });

      await expect(service.markConversationRead(conversationId, recipient))
        .resolves.toEqual({ cleared: 4 });

      const [filter, update] = findOneAndUpdate.mock.calls[0];
      expect(filter.userId.toString()).toBe(recipient.toString());
      expect(update.$set.unreadCount).toBe(0);
      expect(update.$set.lastReadAt).toBeInstanceOf(Date);
    });

    it('is idempotent on an already-read conversation', async () => {
      const service = buildService({
        findOneAndUpdate: jest.fn().mockReturnValue({
          lean: () => Promise.resolve({ unreadCount: 0 })
        })
      });

      await expect(service.markConversationRead(conversationId, recipient))
        .resolves.toEqual({ cleared: 0 });
    });

    it('reports nothing cleared when the participant row does not exist yet', async () => {
      const service = buildService({
        findOneAndUpdate: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) })
      });

      await expect(service.markConversationRead(conversationId, recipient))
        .resolves.toEqual({ cleared: 0 });
    });
  });

  describe('markAllRead', () => {
    it('touches only rows that are actually unread', async () => {
      const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 3 });
      const service = buildService({ updateMany });

      await expect(service.markAllRead(recipient)).resolves.toEqual({ updated: 3 });

      const [filter, update] = updateMany.mock.calls[0];
      expect(filter.unreadCount).toEqual({ $gt: 0 });
      expect(update.$set.unreadCount).toBe(0);
    });
  });

  describe('getUnreadTotals', () => {
    it('reports messages and conversations as separate numbers', async () => {
      const service = buildService({
        aggregate: jest.fn().mockResolvedValue([
          { totalUnreadMessages: 7, totalUnreadConversations: 2 }
        ])
      });

      // Both are kept because they answer different questions, even though
      // today's header only renders a dot from the first.
      await expect(service.getUnreadTotals(recipient)).resolves.toEqual({
        totalUnreadMessages: 7,
        totalUnreadConversations: 2
      });
    });

    it('reports zeroes for an inbox with nothing unread', async () => {
      const service = buildService({ aggregate: jest.fn().mockResolvedValue([]) });

      await expect(service.getUnreadTotals(recipient)).resolves.toEqual({
        totalUnreadMessages: 0,
        totalUnreadConversations: 0
      });
    });
  });
});
