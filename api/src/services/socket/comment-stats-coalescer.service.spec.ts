import { ObjectId } from 'mongodb';
import { POST_ROOM_EVENTS } from 'src/common/constants/community';

import { CommentStatsCoalescerService } from './comment-stats-coalescer.service';

/**
 * What keeps a viral comment from becoming an event storm, and what keeps the
 * number it publishes correct.
 */
function createSubject(comments: any[] = []) {
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

  const CommentModel = {
    find: jest.fn((filter: any) => ({
      select: () => ({
        lean: async () => {
          const wanted = filter._id.$in.map((id: ObjectId) => id.toString());
          return comments.filter((comment) => wanted.includes(comment._id.toString()));
        }
      })
    }))
  };

  const postRoomService = { emit: jest.fn().mockResolvedValue(undefined) };

  const service = new CommentStatsCoalescerService(
    redis as any,
    CommentModel as any,
    postRoomService as any
  );

  return {
    service, redis, postRoomService, CommentModel, dirty
  };
}

const postId = new ObjectId();

describe('CommentStatsCoalescerService', () => {
  it('collapses a burst of likes on one comment into a single snapshot', async () => {
    const commentId = new ObjectId();
    const { service, postRoomService } = createSubject([{
      _id: commentId, objectId: postId, objectType: 'post', totalLike: 1000, totalReply: 0, updatedAt: new Date()
    }]);

    // A thousand likes land between two flushes.
    for (let index = 0; index < 1000; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.markDirty(commentId);
    }

    const emitted = await service.flush();

    // One frame, not a thousand. This is the whole point of the set.
    expect(emitted).toBe(1);
    expect(postRoomService.emit).toHaveBeenCalledTimes(1);
    expect(postRoomService.emit.mock.calls[0][2].likesCount).toBe(1000);
  });

  it('publishes the absolute total, never a delta', async () => {
    const commentId = new ObjectId();
    const { service, postRoomService } = createSubject([{
      _id: commentId, objectId: postId, objectType: 'post', totalLike: 7, totalReply: 3, updatedAt: new Date()
    }]);

    await service.markDirty(commentId);
    await service.flush();

    const [, event, payload] = postRoomService.emit.mock.calls[0];
    expect(event).toBe(POST_ROOM_EVENTS.COMMENT_STATS_UPDATED);
    // Absolute totals are what let a client that missed a frame self-correct,
    // and what stops an HTTP response and a socket echo adding up.
    expect(payload.likesCount).toBe(7);
    expect(payload.replyCount).toBe(3);
    expect(payload.commentId).toBe(commentId.toString());
    expect(payload.postId).toBe(postId.toString());
  });

  it('carries a revision so a late frame can be discarded', async () => {
    const commentId = new ObjectId();
    const updatedAt = new Date('2026-08-21T10:00:00.000Z');
    const { service, postRoomService } = createSubject([{
      _id: commentId, objectId: postId, objectType: 'post', totalLike: 2, totalReply: 0, updatedAt
    }]);

    await service.markDirty(commentId);
    await service.flush();

    expect(postRoomService.emit.mock.calls[0][2].revision).toBe(updatedAt.getTime());
  });

  it('addresses a reply to the room of the post that contains it', async () => {
    const parentId = new ObjectId();
    const replyId = new ObjectId();
    const { service, postRoomService } = createSubject([
      {
        _id: replyId, objectId: parentId, objectType: 'comment', totalLike: 4, totalReply: 0, updatedAt: new Date()
      },
      {
        _id: parentId, objectId: postId, objectType: 'post', totalLike: 0, totalReply: 1, updatedAt: new Date()
      }
    ]);

    await service.markDirty(replyId);
    await service.flush();

    const [room, , payload] = postRoomService.emit.mock.calls[0];
    // A reply names its parent, so the post had to be resolved before a room
    // could be addressed at all.
    expect(room).toBe(postId.toString());
    expect(payload.commentId).toBe(replyId.toString());
    expect(payload.parentCommentId).toBe(parentId.toString());
    expect(payload.likesCount).toBe(4);
  });

  it('resolves many replies of one parent in a single query', async () => {
    const parentId = new ObjectId();
    const replies = Array.from({ length: 25 }, () => ({
      _id: new ObjectId(), objectId: parentId, objectType: 'comment', totalLike: 1, totalReply: 0, updatedAt: new Date()
    }));
    const { service, CommentModel } = createSubject([
      ...replies,
      {
        _id: parentId, objectId: postId, objectType: 'post', totalLike: 0, totalReply: 25, updatedAt: new Date()
      }
    ]);

    await Promise.all(replies.map((reply) => service.markDirty(reply._id)));
    await service.flush();

    // One query for the drained comments and one for their parents. A lookup
    // per reply would turn a busy thread's flush into a query storm.
    expect(CommentModel.find).toHaveBeenCalledTimes(2);
  });

  it('emits nothing when there is nothing dirty', async () => {
    const { service, postRoomService } = createSubject();

    expect(await service.flush()).toBe(0);
    expect(postRoomService.emit).not.toHaveBeenCalled();
  });

  it('drains what it popped, so the next flush is quiet', async () => {
    const commentId = new ObjectId();
    const { service, postRoomService } = createSubject([{
      _id: commentId, objectId: postId, objectType: 'post', totalLike: 1, totalReply: 0, updatedAt: new Date()
    }]);

    await service.markDirty(commentId);
    await service.flush();
    await service.flush();

    expect(postRoomService.emit).toHaveBeenCalledTimes(1);
  });

  it('skips a comment whose post can no longer be resolved', async () => {
    const orphan = new ObjectId();
    const { service, postRoomService } = createSubject([{
      _id: orphan, objectId: new ObjectId(), objectType: 'comment', totalLike: 1, totalReply: 0, updatedAt: new Date()
    }]);

    await service.markDirty(orphan);

    expect(await service.flush()).toBe(0);
    expect(postRoomService.emit).not.toHaveBeenCalled();
  });

  it('never lets a failed mark break the interaction that caused it', async () => {
    const { service, redis } = createSubject();
    redis.sadd.mockRejectedValue(new Error('redis down'));

    await expect(service.markDirty(new ObjectId())).resolves.toBeUndefined();
  });
});
