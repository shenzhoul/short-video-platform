import { ObjectId } from 'mongodb';
import { POST_ROOM_EVENTS } from 'src/common/constants/community';
import { EVENT } from 'src/kernel/constants';

import { PostRoomListener } from './post-room.listener';

/**
 * The split between the two traffic classes, and the separation between a post
 * room and notification delivery.
 */
function createSubject(options: { rootComment?: any } = {}) {
  const queueMessageService = { subscribe: jest.fn() };
  const postRoomService = { emit: jest.fn().mockResolvedValue(undefined) };
  const postStatsCoalescerService = { markDirty: jest.fn().mockResolvedValue(undefined) };
  const commentService = {
    findById: jest.fn().mockResolvedValue(options.rootComment ?? null)
  };

  const listener = new PostRoomListener(
    queueMessageService as any,
    postRoomService as any,
    postStatsCoalescerService as any,
    commentService as any
  );

  return {
    listener, queueMessageService, postRoomService, postStatsCoalescerService, commentService
  };
}

const postId = new ObjectId();

function commentEvent(eventName: string, comment: Record<string, any>) {
  return { data: { eventName, data: comment } } as any;
}

describe('post room content events', () => {
  it('subscribes under its own topics, leaving notification delivery untouched', () => {
    const { queueMessageService } = createSubject();

    const topics = queueMessageService.subscribe.mock.calls.map(([, topic]) => topic);
    expect(topics).toEqual(['POST_ROOM_COMMENT_TOPIC', 'POST_ROOM_REACTION_TOPIC']);
  });

  it('emits comment_created to the post room', async () => {
    const { listener, postRoomService } = createSubject();
    const commentId = new ObjectId();

    await listener.handleComment(commentEvent(EVENT.CREATED, {
      _id: commentId, objectId: postId, objectType: 'post', content: 'hello'
    }));

    const [room, event, payload] = postRoomService.emit.mock.calls[0];
    expect(room.toString()).toBe(postId.toString());
    expect(event).toBe(POST_ROOM_EVENTS.COMMENT_CREATED);
    expect(payload.comment.content).toBe('hello');
    expect(payload.eventId).toBe(commentId.toString());
  });

  it('resolves a reply to its containing post and names the root', async () => {
    const rootId = new ObjectId();
    const { listener, postRoomService } = createSubject({
      rootComment: { _id: rootId, objectId: postId, objectType: 'post' }
    });

    await listener.handleComment(commentEvent(EVENT.CREATED, {
      _id: new ObjectId(), objectId: rootId, objectType: 'comment', content: 'a reply'
    }));

    const [room, event, payload] = postRoomService.emit.mock.calls[0];
    // A reply names its root, not the post, so the room had to be resolved.
    expect(room.toString()).toBe(postId.toString());
    expect(event).toBe(POST_ROOM_EVENTS.REPLY_CREATED);
    expect(payload.rootId).toBe(rootId.toString());
    expect(payload.reply.content).toBe('a reply');
  });

  it('emits comment_deleted so a removed comment disappears live', async () => {
    const { listener, postRoomService } = createSubject();
    const commentId = new ObjectId();

    await listener.handleComment(commentEvent(EVENT.DELETED, {
      _id: commentId, objectId: postId, objectType: 'post'
    }));

    const [, event, payload] = postRoomService.emit.mock.calls[0];
    expect(event).toBe(POST_ROOM_EVENTS.COMMENT_DELETED);
    expect(payload.commentId).toBe(commentId.toString());
  });

  it('marks stats dirty rather than putting counters in the content event', async () => {
    const { listener, postRoomService, postStatsCoalescerService } = createSubject();

    await listener.handleComment(commentEvent(EVENT.CREATED, {
      _id: new ObjectId(), objectId: postId, objectType: 'post', content: 'hi'
    }));

    expect(postStatsCoalescerService.markDirty).toHaveBeenCalledTimes(1);
    const [, , payload] = postRoomService.emit.mock.calls[0];
    // Counters travel in a coalesced snapshot, so both classes stay bounded.
    expect(payload).not.toHaveProperty('totalComment');
  });

  it('skips a reply whose root can no longer be found', async () => {
    const { listener, postRoomService } = createSubject({ rootComment: null });

    await listener.handleComment(commentEvent(EVENT.CREATED, {
      _id: new ObjectId(), objectId: new ObjectId(), objectType: 'comment'
    }));

    expect(postRoomService.emit).not.toHaveBeenCalled();
  });

  it('never lets a delivery failure undo the stored comment', async () => {
    const { listener, postRoomService } = createSubject();
    postRoomService.emit.mockRejectedValue(new Error('socket down'));

    await expect(listener.handleComment(commentEvent(EVENT.CREATED, {
      _id: new ObjectId(), objectId: postId, objectType: 'post'
    }))).resolves.toBeUndefined();
  });
});

describe('post room reaction handling', () => {
  it('never emits per like, only marks the post dirty', async () => {
    const { listener, postRoomService, postStatsCoalescerService } = createSubject();

    // 500 likes in a burst.
    for (let index = 0; index < 500; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await listener.handleReaction({
        data: { eventName: EVENT.CREATED, data: { objectId: postId, objectType: 'post', action: 'like' } }
      } as any);
    }

    // This is the line keeping 10,000 likes/sec from becoming 10,000 broadcasts.
    expect(postRoomService.emit).not.toHaveBeenCalled();
    expect(postStatsCoalescerService.markDirty).toHaveBeenCalledTimes(500);
  });

  it('marks dirty for a share too, so totalShare reaches viewers', async () => {
    const { listener, postStatsCoalescerService } = createSubject();

    await listener.handleReaction({
      data: { eventName: EVENT.CREATED, data: { objectId: postId, objectType: 'post', action: 'share' } }
    } as any);

    expect(postStatsCoalescerService.markDirty).toHaveBeenCalledWith(postId);
  });

  it('ignores reactions that do not move a post counter', async () => {
    const { listener, postStatsCoalescerService } = createSubject();

    await listener.handleReaction({
      data: { eventName: EVENT.CREATED, data: { objectId: new ObjectId(), objectType: 'comment', action: 'like' } }
    } as any);
    await listener.handleReaction({
      data: { eventName: EVENT.CREATED, data: { objectId: new ObjectId(), objectType: 'creator', action: 'follow' } }
    } as any);

    expect(postStatsCoalescerService.markDirty).not.toHaveBeenCalled();
  });
});

describe('post room never carries notifications', () => {
  it('emits only post-room event names', async () => {
    const { listener, postRoomService } = createSubject();

    await listener.handleComment(commentEvent(EVENT.CREATED, {
      _id: new ObjectId(), objectId: postId, objectType: 'post', content: 'hi'
    }));

    const events = postRoomService.emit.mock.calls.map(([, event]) => event);
    // A notification is addressed to one recipient's user sockets; broadcasting
    // one into a room would leak it to every viewer.
    expect(events.every((event: string) => event.startsWith('post:'))).toBe(true);
    expect(events).not.toContain('notification:created');
  });

  it('puts no recipient or notification payload in a room event', async () => {
    const { listener, postRoomService } = createSubject();

    await listener.handleComment(commentEvent(EVENT.CREATED, {
      _id: new ObjectId(), objectId: postId, objectType: 'post', content: 'hi'
    }));

    const [, , payload] = postRoomService.emit.mock.calls[0];
    expect(payload).not.toHaveProperty('recipientId');
    expect(payload).not.toHaveProperty('type');
  });
});

describe('realtime comments are render-ready', () => {
  it('carries the author, so the UI does not fall back to N/A', async () => {
    const { listener, postRoomService } = createSubject();

    // The shape the comment service now publishes: `setUser` runs before the
    // event is emitted, so the author travels with it.
    await listener.handleComment(commentEvent(EVENT.CREATED, {
      _id: new ObjectId(),
      objectId: postId,
      objectType: 'post',
      content: 'hello',
      user: { _id: new ObjectId(), username: 'jiang', name: 'Jiang Shiyi', avatar: 'https://cdn/a.jpg' }
    }));

    const [, , payload] = postRoomService.emit.mock.calls[0];
    expect(payload.comment.user).toEqual(expect.objectContaining({
      username: 'jiang', name: 'Jiang Shiyi', avatar: 'https://cdn/a.jpg'
    }));
  });

  it('carries the author on a reply too', async () => {
    const rootId = new ObjectId();
    const { listener, postRoomService } = createSubject({
      rootComment: { _id: rootId, objectId: postId, objectType: 'post' }
    });

    await listener.handleComment(commentEvent(EVENT.CREATED, {
      _id: new ObjectId(),
      objectId: rootId,
      objectType: 'comment',
      content: 'a reply',
      user: { _id: new ObjectId(), username: 'jiang', name: 'Jiang Shiyi', avatar: 'https://cdn/a.jpg' }
    }));

    const [, , payload] = postRoomService.emit.mock.calls[0];
    expect(payload.reply.user).toEqual(expect.objectContaining({ name: 'Jiang Shiyi' }));
  });
});
