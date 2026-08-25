import { ObjectId } from 'mongodb';
import { REACTION_CHANNELS } from 'src/common/constants/community';
import { EVENT } from 'src/kernel/constants';

import { FollowStatsListener } from './follow-stats.listener';

/**
 * Which events move a follow count, and which deliberately do not.
 */
function createSubject() {
  const queueMessageService = { subscribe: jest.fn() };
  const coalescer = { markDirty: jest.fn().mockResolvedValue(undefined) };
  const listener = new FollowStatsListener(queueMessageService as any, coalescer as any);
  return { listener, queueMessageService, coalescer };
}

const follower = new ObjectId();
const creator = new ObjectId();

const event = (eventName: string, data: Record<string, any>) => ({
  data: { eventName, data }
}) as any;

const followEvent = (eventName: string) => event(eventName, {
  objectType: 'creator', action: 'follow', objectId: creator, createdBy: follower
});

describe('FollowStatsListener', () => {
  it('subscribes under its own topic, leaving the other listeners untouched', () => {
    const { queueMessageService } = createSubject();

    expect(queueMessageService.subscribe).toHaveBeenCalledWith(
      REACTION_CHANNELS.REACTION,
      'FOLLOW_STATS_TOPIC',
      expect.any(Function)
    );
  });

  it('marks both participants when a follow is created', async () => {
    const { listener, coalescer } = createSubject();

    await listener.handleFollowChange(followEvent(EVENT.CREATED));

    // One relation, two numbers: the follower's following count and the
    // creator's follower count.
    expect(coalescer.markDirty).toHaveBeenCalledWith(follower);
    expect(coalescer.markDirty).toHaveBeenCalledWith(creator);
    expect(coalescer.markDirty).toHaveBeenCalledTimes(2);
  });

  it('marks both participants when a follow is removed', async () => {
    // Removing a follower is routed through unfollow, so it arrives here as the
    // same event and needs no separate branch.
    const { listener, coalescer } = createSubject();

    await listener.handleFollowChange(followEvent(EVENT.DELETED));

    expect(coalescer.markDirty).toHaveBeenCalledTimes(2);
  });

  it('ignores a like on a post', async () => {
    const { listener, coalescer } = createSubject();

    await listener.handleFollowChange(event(EVENT.CREATED, {
      objectType: 'post', action: 'like', objectId: new ObjectId(), createdBy: follower
    }));

    expect(coalescer.markDirty).not.toHaveBeenCalled();
  });

  it('ignores a non-follow action on a creator', async () => {
    const { listener, coalescer } = createSubject();

    await listener.handleFollowChange(event(EVENT.CREATED, {
      objectType: 'creator', action: 'like', objectId: creator, createdBy: follower
    }));

    expect(coalescer.markDirty).not.toHaveBeenCalled();
  });

  it('ignores an event with a participant missing', async () => {
    const { listener, coalescer } = createSubject();

    await listener.handleFollowChange(event(EVENT.CREATED, {
      objectType: 'creator', action: 'follow', objectId: creator
    }));

    expect(coalescer.markDirty).not.toHaveBeenCalled();
  });

  it('ignores an event that is neither a creation nor a deletion', async () => {
    const { listener, coalescer } = createSubject();

    await listener.handleFollowChange(event('updated', {
      objectType: 'creator', action: 'follow', objectId: creator, createdBy: follower
    }));

    expect(coalescer.markDirty).not.toHaveBeenCalled();
  });

  it('never lets a delivery failure undo the stored relation', async () => {
    const { listener, coalescer } = createSubject();
    coalescer.markDirty.mockRejectedValue(new Error('redis down'));

    await expect(listener.handleFollowChange(followEvent(EVENT.CREATED)))
      .resolves.toBeUndefined();
  });
});
