import { ObjectId } from 'mongodb';

import { ReactionAssetsListener } from './reaction.listener';

function createSubject(post?: Record<string, any>) {
  const userService = { updateLikeStat: jest.fn() };
  const queueMessageService = { subscribe: jest.fn(), publish: jest.fn() };
  const postService = { findById: jest.fn().mockResolvedValue(post || null) };
  const postStatisticsService = {
    handleLikeStat: jest.fn().mockResolvedValue(undefined),
    handleShareStat: jest.fn().mockResolvedValue(undefined)
  };

  const listener = new ReactionAssetsListener(
    userService as any,
    queueMessageService as any,
    postService as any,
    postStatisticsService as any
  );

  return {
    listener, userService, postService, postStatisticsService
  };
}

function event(data: Record<string, any>, eventName = 'created') {
  return { data: { eventName, data } } as any;
}

describe('ReactionAssetsListener share handling', () => {
  it('counts a share without touching like statistics', async () => {
    const postId = new ObjectId();
    const { listener, postStatisticsService, userService } = createSubject({
      _id: postId, userId: new ObjectId()
    });

    await listener.handleReaction(event({
      objectType: 'post', objectId: postId, action: 'share'
    }));

    expect(postStatisticsService.handleShareStat).toHaveBeenCalledWith(postId, 1);
    // A share is a post reaction too, so the like counters must stay untouched.
    expect(postStatisticsService.handleLikeStat).not.toHaveBeenCalled();
    expect(userService.updateLikeStat).not.toHaveBeenCalled();
  });

  it('never decrements the share count, because there is no unshare', async () => {
    const { listener, postStatisticsService } = createSubject();

    await listener.handleReaction(event({
      objectType: 'post', objectId: new ObjectId(), action: 'share'
    }, 'deleted'));

    expect(postStatisticsService.handleShareStat).not.toHaveBeenCalled();
  });

  it('counts a share without loading the post it belongs to', async () => {
    const { listener, postService } = createSubject({
      _id: new ObjectId(), userId: new ObjectId()
    });

    await listener.handleReaction(event({
      objectType: 'post', objectId: new ObjectId(), action: 'share'
    }));

    // Only the like path needs the owner, so a share must not pay for that read.
    expect(postService.findById).not.toHaveBeenCalled();
  });
});

describe('ReactionAssetsListener like handling', () => {
  it('increments post and creator like statistics on a like', async () => {
    const postId = new ObjectId();
    const ownerId = new ObjectId();
    const { listener, postStatisticsService, userService } = createSubject({
      _id: postId, userId: ownerId
    });

    await listener.handleReaction(event({
      objectType: 'post', objectId: postId, action: 'like'
    }));

    expect(postStatisticsService.handleLikeStat).toHaveBeenCalledWith(postId, 1);
    expect(userService.updateLikeStat).toHaveBeenCalledWith(ownerId, 1);
    expect(postStatisticsService.handleShareStat).not.toHaveBeenCalled();
  });

  it('decrements on an unlike', async () => {
    const postId = new ObjectId();
    const ownerId = new ObjectId();
    const { listener, postStatisticsService, userService } = createSubject({
      _id: postId, userId: ownerId
    });

    await listener.handleReaction(event({
      objectType: 'post', objectId: postId, action: 'like'
    }, 'deleted'));

    expect(postStatisticsService.handleLikeStat).toHaveBeenCalledWith(postId, -1);
    expect(userService.updateLikeStat).toHaveBeenCalledWith(ownerId, -1);
  });

  it('ignores follow reactions, which target a creator rather than a post', async () => {
    const { listener, postStatisticsService } = createSubject();

    await listener.handleReaction(event({
      objectType: 'creator', objectId: new ObjectId(), action: 'follow'
    }));

    expect(postStatisticsService.handleLikeStat).not.toHaveBeenCalled();
    expect(postStatisticsService.handleShareStat).not.toHaveBeenCalled();
  });
});
