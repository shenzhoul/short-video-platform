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
});
