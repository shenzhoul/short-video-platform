import { ObjectId } from 'mongodb';
import { USER_STATS_EVENTS } from 'src/common/constants/community';

import { FollowStatsCoalescerService } from './follow-stats-coalescer.service';

/**
 * Who is told about a follow count, how often, and with what number.
 */
function createSubject(counts: Record<string, { followers: number; followings: number }> = {}) {
  const dirty = new Set<string>();
  const redis = {
    sadd: jest.fn(async (_key: string, id: string) => {
      const before = dirty.size;
      dirty.add(id);
      return dirty.size - before;
    }),
    spop: jest.fn(async (_key: string, count: number) => {
      const drained = [...dirty].slice(0, count);
      drained.forEach((id) => dirty.delete(id));
      return drained;
    })
  };

  const followService = {
    countFollowRelations: jest.fn(async (userId: string) => counts[userId.toString()]
      || { followers: 0, followings: 0 })
  };
  const socketUserService = { emitToUsers: jest.fn().mockResolvedValue(undefined) };

  const service = new FollowStatsCoalescerService(
    redis as any,
    followService as any,
    socketUserService as any
  );

  return {
    service, redis, followService, socketUserService, dirty
  };
}

describe('FollowStatsCoalescerService', () => {
  it('sends the snapshot only to the user it describes', async () => {
    const userId = new ObjectId().toString();
    const { service, socketUserService } = createSubject({
      [userId]: { followers: 12, followings: 5 }
    });

    await service.markDirty(userId);
    await service.flush();

    // Follow counts are that person's own figures. A profile room would send a
    // frame to every stranger looking at them.
    const [target, event, payload] = socketUserService.emitToUsers.mock.calls[0];
    expect(target).toBe(userId);
    expect(event).toBe(USER_STATS_EVENTS.FOLLOW_STATS_UPDATED);
    expect(payload.userId).toBe(userId);
  });

  it('publishes absolute totals, never a delta', async () => {
    const userId = new ObjectId().toString();
    const { service, socketUserService } = createSubject({
      [userId]: { followers: 40, followings: 7 }
    });

    await service.markDirty(userId);
    await service.flush();

    const [, , payload] = socketUserService.emitToUsers.mock.calls[0];
    // Absolute totals are what stop an HTTP response and a socket echo adding
    // up, and what lets a client that missed a frame self-correct.
    expect(payload.followersCount).toBe(40);
    expect(payload.followingCount).toBe(7);
  });

  it('counts the follow rows rather than the cached counters', async () => {
    const userId = new ObjectId().toString();
    const { service, followService } = createSubject();

    await service.markDirty(userId);
    await service.flush();

    // `User.stats` is a cache only follow/unfollow maintain; counting the rows
    // is the definition the profile endpoint and the follower list use.
    expect(followService.countFollowRelations).toHaveBeenCalledWith(userId);
  });

  it('collapses a burst of follows into one snapshot per user', async () => {
    const userId = new ObjectId().toString();
    const { service, socketUserService } = createSubject({
      [userId]: { followers: 500, followings: 0 }
    });

    for (let index = 0; index < 500; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.markDirty(userId);
    }
    await service.flush();

    expect(socketUserService.emitToUsers).toHaveBeenCalledTimes(1);
    expect(socketUserService.emitToUsers.mock.calls[0][2].followersCount).toBe(500);
  });

  it('carries a revision so a late frame can be discarded', async () => {
    const userId = new ObjectId().toString();
    const { service, socketUserService } = createSubject();

    await service.markDirty(userId);
    await service.flush();

    const [, , payload] = socketUserService.emitToUsers.mock.calls[0];
    expect(typeof payload.revision).toBe('number');
    expect(payload.revision).toBeGreaterThan(0);
    expect(typeof payload.updatedAt).toBe('string');
  });

  it('tells both sides of one relation', async () => {
    const follower = new ObjectId().toString();
    const creator = new ObjectId().toString();
    const { service, socketUserService } = createSubject({
      [follower]: { followers: 0, followings: 1 },
      [creator]: { followers: 1, followings: 0 }
    });

    await service.markDirty(follower);
    await service.markDirty(creator);
    await service.flush();

    const told = socketUserService.emitToUsers.mock.calls.map(([target]) => target);
    expect(told.sort()).toEqual([follower, creator].sort());
  });

  it('emits nothing when nothing is dirty', async () => {
    const { service, socketUserService } = createSubject();

    expect(await service.flush()).toBe(0);
    expect(socketUserService.emitToUsers).not.toHaveBeenCalled();
  });

  it('drains what it popped, so the next flush is quiet', async () => {
    const userId = new ObjectId().toString();
    const { service, socketUserService } = createSubject();

    await service.markDirty(userId);
    await service.flush();
    await service.flush();

    expect(socketUserService.emitToUsers).toHaveBeenCalledTimes(1);
  });

  it('still tells the others when one user fails', async () => {
    const first = new ObjectId().toString();
    const second = new ObjectId().toString();
    const { service, socketUserService, followService } = createSubject();
    followService.countFollowRelations.mockImplementationOnce(async () => {
      throw new Error('database down');
    });

    await service.markDirty(first);
    await service.markDirty(second);

    // One failure, one delivery — not zero.
    expect(await service.flush()).toBe(1);
    expect(socketUserService.emitToUsers).toHaveBeenCalledTimes(1);
  });

  it('never lets a failed mark break the follow that caused it', async () => {
    const { service, redis } = createSubject();
    redis.sadd.mockRejectedValue(new Error('redis down'));

    await expect(service.markDirty(new ObjectId())).resolves.toBeUndefined();
  });
});
