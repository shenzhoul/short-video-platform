import { ObjectId } from 'mongodb';

import { ReactionService } from './reaction.service';

describe('ReactionService deleteReactionsByTargets', () => {
  it('is a no-op for an empty target list', async () => {
    const reactionModel = { deleteMany: jest.fn() };
    const service = new ReactionService(reactionModel as any, {} as any);

    await expect(service.deleteReactionsByTargets('comment', [])).resolves.toBe(0);
    expect(reactionModel.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes all target reactions in one query without publishing events', async () => {
    const ids = [new ObjectId(), new ObjectId()];
    const reactionModel = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 4 })
    };
    const queueMessageService = { publish: jest.fn() };
    const service = new ReactionService(reactionModel as any, queueMessageService as any);

    await expect(service.deleteReactionsByTargets('comment', ids)).resolves.toBe(4);

    expect(reactionModel.deleteMany).toHaveBeenCalledWith({
      objectType: 'comment',
      objectId: { $in: ids }
    });
    expect(queueMessageService.publish).not.toHaveBeenCalled();
  });
});

describe('ReactionService liked post collection', () => {
  it('searches the current user likes in stable newest-first order', async () => {
    const userId = new ObjectId();
    const reactionId = new ObjectId();
    const postId = new ObjectId();
    const createdAt = new Date('2026-08-04T10:00:00.000Z');
    const records = [{
      _id: reactionId,
      objectId: postId,
      objectType: 'post',
      action: 'like',
      createdBy: userId,
      createdAt,
      updatedAt: createdAt
    }];
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockResolvedValue(records)
    };
    const reactionModel = {
      find: jest.fn().mockReturnValue(findQuery),
      countDocuments: jest.fn().mockResolvedValue(1)
    };
    const service = new ReactionService(reactionModel as any, {} as any);

    await expect(service.search({
      createdBy: userId,
      objectType: 'post',
      action: 'like',
      limit: 12,
      offset: 0
    } as any)).resolves.toMatchObject({
      total: 1,
      hasMore: false,
      nextCursor: null,
      data: [{ objectId: postId, action: 'like' }]
    });

    expect(reactionModel.find).toHaveBeenCalledWith({
      createdBy: userId,
      objectType: 'post',
      action: 'like'
    });
    expect(findQuery.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(findQuery.limit).toHaveBeenCalledWith(13);
  });

  it('bulk unlikes idempotently and publishes events only for existing reactions', async () => {
    const userId = new ObjectId();
    const postIds = [new ObjectId(), new ObjectId()];
    const reaction = {
      _id: new ObjectId(),
      objectId: postIds[0],
      objectType: 'post',
      action: 'like',
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const reactionModel = {
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([reaction]) }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 })
    };
    const queueMessageService = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new ReactionService(reactionModel as any, queueMessageService as any);

    await expect(service.removeManyPostLikes(postIds, { _id: userId } as any))
      .resolves.toEqual(postIds.map((id) => id.toString()));

    expect(reactionModel.deleteMany).toHaveBeenCalledWith({ _id: { $in: [reaction._id] } });
    expect(queueMessageService.publish).toHaveBeenCalledTimes(1);
  });

  it('returns the requested posts when they are already unliked', async () => {
    const postId = new ObjectId();
    const reactionModel = {
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      deleteMany: jest.fn()
    };
    const queueMessageService = { publish: jest.fn() };
    const service = new ReactionService(reactionModel as any, queueMessageService as any);

    await expect(service.removeManyPostLikes([postId], { _id: new ObjectId() } as any))
      .resolves.toEqual([postId.toString()]);
    expect(reactionModel.deleteMany).not.toHaveBeenCalled();
    expect(queueMessageService.publish).not.toHaveBeenCalled();
  });
});
