import { BadRequestException } from '@nestjs/common';
import { ObjectId } from 'mongodb';

import { FollowService } from './follow.service';

describe('FollowService', () => {
  it('creates a follow once and increments both counters once', async () => {
    const followerId = new ObjectId();
    const creatorId = new ObjectId();
    const reactionModel = {
      updateOne: jest.fn().mockResolvedValueOnce({ upsertedCount: 1 }).mockResolvedValueOnce({ upsertedCount: 0 })
    };
    const userModel = {
      exists: jest.fn().mockResolvedValue(true),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 })
    };
    const queueMessageService = { publish: jest.fn() };
    const service = new FollowService(reactionModel as any, userModel as any, queueMessageService as any);

    await expect(service.follow(followerId, creatorId)).resolves.toEqual({ isFollowed: true, created: true });
    await expect(service.follow(followerId, creatorId)).resolves.toEqual({ isFollowed: true, created: false });

    expect(reactionModel.updateOne).toHaveBeenCalledTimes(2);
    expect(reactionModel.updateOne).toHaveBeenCalledWith(
      {
        createdBy: followerId,
        objectId: creatorId,
        objectType: 'creator',
        action: 'follow'
      },
      {
        $setOnInsert: {
          createdBy: followerId,
          objectId: creatorId,
          objectType: 'creator',
          action: 'follow'
        }
      },
      { upsert: true }
    );
    expect(userModel.updateOne).toHaveBeenCalledTimes(2);
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: creatorId },
      { $inc: { 'stats.followers': 1 } }
    );
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: followerId },
      { $inc: { 'stats.followings': 1 } }
    );

    // Only the first follow publishes, so following twice notifies the creator once.
    expect(queueMessageService.publish).toHaveBeenCalledTimes(1);
    expect(queueMessageService.publish).toHaveBeenCalledWith(
      'REACTION_CHANNELS.REACTION',
      {
        eventName: 'created',
        data: {
          objectType: 'creator',
          objectId: creatorId,
          action: 'follow',
          createdBy: followerId
        }
      }
    );
  });

  it('rejects following the current user', async () => {
    const id = new ObjectId();
    const service = new FollowService({} as any, {} as any, { publish: jest.fn() } as any);
    await expect(service.follow(id, id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats a concurrent duplicate insert as an idempotent follow', async () => {
    const followerId = new ObjectId();
    const creatorId = new ObjectId();
    const reactionModel = { updateOne: jest.fn().mockRejectedValue({ code: 11000 }) };
    const userModel = {
      exists: jest.fn().mockResolvedValue(true),
      updateOne: jest.fn()
    };
    const queueMessageService = { publish: jest.fn() };
    const service = new FollowService(reactionModel as any, userModel as any, queueMessageService as any);

    await expect(service.follow(followerId, creatorId)).resolves.toEqual({ isFollowed: true, created: false });
    expect(userModel.updateOne).not.toHaveBeenCalled();
    // A lost unique-index race means the relation already existed, so the
    // creator must not be notified a second time.
    expect(queueMessageService.publish).not.toHaveBeenCalled();
  });

  it('removes a follow once and decrements non-zero counters once', async () => {
    const followerId = new ObjectId();
    const creatorId = new ObjectId();
    const reactionModel = {
      deleteOne: jest.fn().mockResolvedValueOnce({ deletedCount: 1 }).mockResolvedValueOnce({ deletedCount: 0 })
    };
    const userModel = { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    const service = new FollowService(reactionModel as any, userModel as any, { publish: jest.fn() } as any);

    await expect(service.unfollow(followerId, creatorId)).resolves.toEqual({ isFollowed: false, removed: true });
    await expect(service.unfollow(followerId, creatorId)).resolves.toEqual({ isFollowed: false, removed: false });

    expect(reactionModel.deleteOne).toHaveBeenCalledWith({
      createdBy: followerId,
      objectId: creatorId,
      objectType: 'creator',
      action: 'follow'
    });
    expect(userModel.updateOne).toHaveBeenCalledTimes(2);
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: creatorId, 'stats.followers': { $gt: 0 } },
      { $inc: { 'stats.followers': -1 } }
    );
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { _id: followerId, 'stats.followings': { $gt: 0 } },
      { $inc: { 'stats.followings': -1 } }
    );
  });

  it('announces a removed follow so messaging can reset the pair', async () => {
    const followerId = new ObjectId();
    const creatorId = new ObjectId();
    const reactionModel = { deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
    const userModel = { updateOne: jest.fn().mockResolvedValue({}) };
    const queueMessageService = { publish: jest.fn() };
    const service = new FollowService(reactionModel as any, userModel as any, queueMessageService as any);

    await service.unfollow(followerId, creatorId);

    // Announced rather than called directly: the follow domain must not depend
    // on the message domain, which already depends on it.
    expect(queueMessageService.publish).toHaveBeenCalledWith('REACTION_CHANNELS.REACTION', {
      eventName: 'deleted',
      data: {
        objectType: 'creator',
        objectId: creatorId,
        action: 'follow',
        createdBy: followerId
      }
    });
  });

  it('announces nothing when there was no follow to remove', async () => {
    const reactionModel = { deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }) };
    const queueMessageService = { publish: jest.fn() };
    const service = new FollowService(reactionModel as any, {} as any, queueMessageService as any);

    await service.unfollow(new ObjectId(), new ObjectId());

    expect(queueMessageService.publish).not.toHaveBeenCalled();
  });

  describe('areMutuallyFollowing', () => {
    const buildService = (rows: any[]) => {
      const reactionModel = {
        find: jest.fn().mockReturnValue({
          select: () => ({ lean: () => Promise.resolve(rows) })
        })
      };
      return {
        reactionModel,
        service: new FollowService(reactionModel as any, {} as any, { publish: jest.fn() } as any)
      };
    };

    it('is true only when both directions exist', async () => {
      const a = new ObjectId();
      const b = new ObjectId();
      const { service, reactionModel } = buildService([{ createdBy: a }, { createdBy: b }]);

      await expect(service.areMutuallyFollowing(a, b)).resolves.toBe(true);

      // Both directions are fetched in one query, so a conversation list can
      // batch this rather than paying two round trips per row.
      expect(reactionModel.find).toHaveBeenCalledTimes(1);
      const [query] = reactionModel.find.mock.calls[0];
      expect(query.$or).toHaveLength(2);
      expect(query.action).toBe('follow');
      expect(query.objectType).toBe('creator');
    });

    it('is false when only one side follows', async () => {
      const a = new ObjectId();
      const b = new ObjectId();
      const { service } = buildService([{ createdBy: a }]);

      await expect(service.areMutuallyFollowing(a, b)).resolves.toBe(false);
    });

    it('is false when neither side follows', async () => {
      const { service } = buildService([]);
      await expect(service.areMutuallyFollowing(new ObjectId(), new ObjectId())).resolves.toBe(false);
    });

    it('is false for a user and themselves', async () => {
      const id = new ObjectId();
      const { service, reactionModel } = buildService([]);

      await expect(service.areMutuallyFollowing(id, id)).resolves.toBe(false);
      // Short-circuited, so a self-check never reaches the database.
      expect(reactionModel.find).not.toHaveBeenCalled();
    });
  });

  describe('getMutualFollowerIdSet', () => {
    it('returns only the users on both sides of the relation', async () => {
      const me = new ObjectId();
      const mutual = new ObjectId();
      const iFollowOnly = new ObjectId();
      const followsMeOnly = new ObjectId();

      const reactionModel = {
        find: jest.fn()
          .mockReturnValueOnce({
            select: () => ({ lean: () => Promise.resolve([{ objectId: mutual }, { objectId: iFollowOnly }]) })
          })
          .mockReturnValueOnce({
            select: () => ({ lean: () => Promise.resolve([{ createdBy: mutual }, { createdBy: followsMeOnly }]) })
          })
      };
      const service = new FollowService(reactionModel as any, {} as any, { publish: jest.fn() } as any);

      const result = await service.getMutualFollowerIdSet(me, [mutual, iFollowOnly, followsMeOnly]);

      expect([...result]).toEqual([mutual.toString()]);
      // Two queries regardless of how many ids were asked about.
      expect(reactionModel.find).toHaveBeenCalledTimes(2);
    });

    it('skips the database entirely for an empty list', async () => {
      const reactionModel = { find: jest.fn() };
      const service = new FollowService(reactionModel as any, {} as any, { publish: jest.fn() } as any);

      await expect(service.getMutualFollowerIdSet(new ObjectId(), [])).resolves.toEqual(new Set());
      expect(reactionModel.find).not.toHaveBeenCalled();
    });
  });
});
