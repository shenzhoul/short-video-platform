import { ObjectId } from 'mongodb';
import { POST_ROOM_EVENTS, POST_STATS_POLICY } from 'src/common/constants/community';

import { PostStatsCoalescerService } from './post-stats-coalescer.service';

/**
 * Coalescing is the whole point: broadcast volume must be bounded by the flush
 * rate, not by how much traffic a post takes.
 */
function createSubject(options: { posts?: any[] } = {}) {
  // A real set, so SPOP semantics (atomic remove-and-return) are modelled
  // rather than assumed.
  const dirty = new Set<string>();
  const redisClient = {
    sadd: jest.fn(async (_key: string, member: string) => {
      const had = dirty.has(member);
      dirty.add(member);
      return had ? 0 : 1;
    }),
    spop: jest.fn(async (_key: string, count: number) => {
      const drained = [...dirty].slice(0, count);
      drained.forEach((id) => dirty.delete(id));
      return drained;
    })
  };

  const PostModel = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(options.posts || [])
      })
    })
  };
  const postRoomService = { emit: jest.fn().mockResolvedValue(undefined) };

  const service = new PostStatsCoalescerService(
    redisClient as any,
    PostModel as any,
    postRoomService as any
  );

  return {
    service, redisClient, postRoomService, PostModel, dirty
  };
}

function postDoc(id: ObjectId, overrides: Record<string, any> = {}) {
  return {
    _id: id,
    totalLike: 10,
    totalComment: 3,
    totalShare: 1,
    updatedAt: new Date('2026-08-14T10:00:00.000Z'),
    ...overrides
  };
}

describe('marking posts dirty', () => {
  it('collapses many mutations in one window into a single flush', async () => {
    const postId = new ObjectId();
    const { service, postRoomService } = createSubject({ posts: [postDoc(postId)] });

    // 300 likes inside one window.
    for (let index = 0; index < 300; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.markDirty(postId);
    }
    await service.flush();

    // One broadcast, not 300. This is the anti-storm guarantee.
    expect(postRoomService.emit).toHaveBeenCalledTimes(1);
  });

  it('never emits while merely marking', async () => {
    const { service, postRoomService } = createSubject();

    await service.markDirty(new ObjectId());

    expect(postRoomService.emit).not.toHaveBeenCalled();
  });

  it('ignores an empty id', async () => {
    const { service, redisClient } = createSubject();
    await service.markDirty('');
    expect(redisClient.sadd).not.toHaveBeenCalled();
  });

  it('survives Redis being unavailable', async () => {
    const { service, redisClient } = createSubject();
    redisClient.sadd.mockRejectedValue(new Error('redis down'));

    // A missed mark costs a late snapshot, never a wrong total.
    await expect(service.markDirty(new ObjectId())).resolves.toBeUndefined();
  });
});

describe('flushing snapshots', () => {
  it('emits an absolute snapshot, never a delta', async () => {
    const postId = new ObjectId();
    const { service, postRoomService } = createSubject({
      posts: [postDoc(postId, { totalLike: 38291, totalComment: 12, totalShare: 7 })]
    });
    await service.markDirty(postId);

    await service.flush();

    const [, event, payload] = postRoomService.emit.mock.calls[0];
    expect(event).toBe(POST_ROOM_EVENTS.STATS_UPDATED);
    expect(payload).toEqual(expect.objectContaining({
      postId: postId.toString(), totalLike: 38291, totalComment: 12, totalShare: 7
    }));
    // A delta would let a client that missed a frame drift permanently.
    expect(Object.keys(payload).some((key) => /delta/i.test(key))).toBe(false);
  });

  it('carries a version so a client can discard an overtaken snapshot', async () => {
    const postId = new ObjectId();
    const { service, postRoomService } = createSubject({ posts: [postDoc(postId)] });
    await service.markDirty(postId);

    await service.flush();

    const [, , payload] = postRoomService.emit.mock.calls[0];
    expect(payload.version).toBe(new Date('2026-08-14T10:00:00.000Z').getTime());
    expect(payload.at).toEqual(expect.any(String));
  });

  it('reads the authoritative totals after draining, not from the mark', async () => {
    const postId = new ObjectId();
    const { service, PostModel } = createSubject({ posts: [postDoc(postId)] });
    await service.markDirty(postId);

    await service.flush();

    // The mark carries no values at all, so nothing stored can go stale.
    expect(PostModel.find).toHaveBeenCalledWith({ _id: { $in: [expect.anything()] } });
  });

  it('emits one snapshot per dirty post', async () => {
    const first = new ObjectId();
    const second = new ObjectId();
    const { service, postRoomService } = createSubject({
      posts: [postDoc(first), postDoc(second)]
    });
    await service.markDirty(first);
    await service.markDirty(second);

    await expect(service.flush()).resolves.toBe(2);
    expect(postRoomService.emit).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no post is dirty', async () => {
    const { service, postRoomService, PostModel } = createSubject();

    await expect(service.flush()).resolves.toBe(0);
    expect(PostModel.find).not.toHaveBeenCalled();
    expect(postRoomService.emit).not.toHaveBeenCalled();
  });

  it('clears the dirty set so a quiet post stops broadcasting', async () => {
    const postId = new ObjectId();
    const { service, postRoomService } = createSubject({ posts: [postDoc(postId)] });
    await service.markDirty(postId);

    await service.flush();
    await service.flush();

    // Second flush finds nothing: bounded by activity, not by viewers.
    expect(postRoomService.emit).toHaveBeenCalledTimes(1);
  });

  it('caps how many posts one flush may drain', async () => {
    const { service, redisClient } = createSubject();
    await service.markDirty(new ObjectId());

    await service.flush();

    // A huge backlog cannot turn one tick into an unbounded burst.
    expect(redisClient.spop)
      .toHaveBeenCalledWith(expect.any(String), POST_STATS_POLICY.MAX_POSTS_PER_FLUSH);
  });

  it('splits work between concurrent drainers instead of duplicating it', async () => {
    const first = new ObjectId();
    const second = new ObjectId();
    const { service, postRoomService } = createSubject({
      posts: [postDoc(first), postDoc(second)]
    });
    await service.markDirty(first);
    await service.markDirty(second);

    // Two instances ticking together. SPOP removes atomically, so each drains a
    // disjoint subset — no post is emitted twice and none is skipped.
    await Promise.all([service.flush(), service.flush()]);

    const emitted = postRoomService.emit.mock.calls.map(([id]) => id.toString());
    expect(emitted.sort()).toEqual([first.toString(), second.toString()].sort());
  });

  it('re-marks are picked up by the following flush', async () => {
    const postId = new ObjectId();
    const { service, postRoomService } = createSubject({ posts: [postDoc(postId)] });

    await service.markDirty(postId);
    await service.flush();
    // A mutation landing after the drain re-adds the post.
    await service.markDirty(postId);
    await service.flush();

    // Worst case one redundant snapshot; a lost update is not possible.
    expect(postRoomService.emit).toHaveBeenCalledTimes(2);
  });

  it('emits nothing for a post deleted between the mark and the flush', async () => {
    const { service, postRoomService } = createSubject({ posts: [] });
    await service.markDirty(new ObjectId());

    await expect(service.flush()).resolves.toBe(0);
    expect(postRoomService.emit).not.toHaveBeenCalled();
  });
});
