import { ObjectId } from 'mongodb';

import { NotificationPostMentionListener } from './notification-post-mention.listener';

function createSubject() {
  const notificationService = { createOnce: jest.fn().mockResolvedValue(null) };
  const queueMessageService = { subscribe: jest.fn(), publish: jest.fn() };

  const listener = new NotificationPostMentionListener(
    queueMessageService as any,
    notificationService as any
  );

  return { listener, notificationService, queueMessageService };
}

function event(data: Record<string, any>, eventName = 'created') {
  return { data: { eventName, data } } as any;
}

describe('NotificationPostMentionListener', () => {
  it('subscribes to the post channel under its own topic', () => {
    const { queueMessageService } = createSubject();

    expect(queueMessageService.subscribe).toHaveBeenCalledWith(
      'CREATOR_POST_CHANNEL',
      'NOTIFICATION_POST_MENTION_TOPIC',
      expect.any(Function)
    );
  });

  it('notifies every mentioned user once', async () => {
    const authorId = new ObjectId();
    const postId = new ObjectId();
    const first = new ObjectId();
    const second = new ObjectId();
    const { listener, notificationService } = createSubject();

    await listener.handlePost(event({
      _id: postId, userId: authorId, mentionedUserIds: [first, second]
    }));

    expect(notificationService.createOnce).toHaveBeenCalledTimes(2);
    const recipients = notificationService.createOnce.mock.calls.map((call) => call[0].recipientId);
    expect(recipients).toEqual([first.toString(), second.toString()]);

    const [payload] = notificationService.createOnce.mock.calls[0];
    expect(payload.type).toBe('post_mention');
    expect(payload.actorId).toEqual(authorId);
    expect(payload.postId).toEqual(postId);
    expect(payload.groupKey).toBe(`post_mention:${postId.toString()}`);
    // A mention is about a post, not a comment.
    expect(payload.commentId).toBeUndefined();
  });

  it('notifies a user named twice in one post only once', async () => {
    const repeated = new ObjectId();
    const { listener, notificationService } = createSubject();

    await listener.handlePost(event({
      _id: new ObjectId(),
      userId: new ObjectId(),
      mentionedUserIds: [repeated, repeated, repeated]
    }));

    expect(notificationService.createOnce).toHaveBeenCalledTimes(1);
  });

  it('routes a self-mention to the service, which drops it', async () => {
    const authorId = new ObjectId();
    const { listener, notificationService } = createSubject();

    await listener.handlePost(event({
      _id: new ObjectId(), userId: authorId, mentionedUserIds: [authorId]
    }));

    // Suppression lives in one place; assert the listener does not invent a
    // second rule, only that recipient and actor arrive equal.
    const [payload] = notificationService.createOnce.mock.calls[0];
    expect(payload.recipientId).toEqual(payload.actorId.toString());
  });

  it('does nothing for a post without mentions', async () => {
    const { listener, notificationService } = createSubject();

    await listener.handlePost(event({
      _id: new ObjectId(), userId: new ObjectId(), mentionedUserIds: []
    }));
    await listener.handlePost(event({ _id: new ObjectId(), userId: new ObjectId() }));

    expect(notificationService.createOnce).not.toHaveBeenCalled();
  });

  it('ignores edits so an unrelated change cannot resurface delivered mentions', async () => {
    const { listener, notificationService } = createSubject();

    await listener.handlePost(event({
      _id: new ObjectId(), userId: new ObjectId(), mentionedUserIds: [new ObjectId()]
    }, 'updated'));

    expect(notificationService.createOnce).not.toHaveBeenCalled();
  });

  it('swallows failures so publishing is never rolled back', async () => {
    const { listener, notificationService } = createSubject();
    notificationService.createOnce.mockRejectedValue(new Error('write failed'));

    await expect(listener.handlePost(event({
      _id: new ObjectId(), userId: new ObjectId(), mentionedUserIds: [new ObjectId()]
    }))).resolves.toBeUndefined();
  });
});
