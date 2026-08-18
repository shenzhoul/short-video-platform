import { ObjectId } from 'mongodb';

import { NotificationReactionListener } from './notification-reaction.listener';

function createSubject(options: {
  post?: Record<string, any>;
  comment?: Record<string, any>;
  remainingReactions?: Array<Record<string, any>>;
} = {}) {
  const notificationService = {
    aggregate: jest.fn().mockResolvedValue(null),
    resurface: jest.fn().mockResolvedValue(null),
    replaceAggregateActor: jest.fn().mockResolvedValue(false)
  };
  const postService = { findById: jest.fn().mockResolvedValue(options.post || null) };
  const commentService = { findById: jest.fn().mockResolvedValue(options.comment || null) };
  const reactionService = {
    search: jest.fn().mockResolvedValue({ data: options.remainingReactions || [] })
  };
  const queueMessageService = { subscribe: jest.fn() };

  const listener = new NotificationReactionListener(
    queueMessageService as any,
    notificationService as any,
    postService as any,
    commentService as any,
    reactionService as any
  );

  return {
    listener,
    notificationService,
    postService,
    commentService,
    reactionService,
    queueMessageService
  };
}

function event(data: Record<string, any>, eventName = 'created') {
  return { data: { eventName, data } } as any;
}

describe('NotificationReactionListener', () => {
  it('subscribes under its own queue topic', () => {
    const { queueMessageService } = createSubject();

    expect(queueMessageService.subscribe).toHaveBeenCalledWith(
      'REACTION_CHANNELS.REACTION',
      'NOTIFICATION_REACTION_TOPIC',
      expect.any(Function)
    );
  });

  it('aggregates post likes by post with the reaction id as idempotency key', async () => {
    const reactionId = new ObjectId();
    const postId = new ObjectId();
    const ownerId = new ObjectId();
    const actorId = new ObjectId();
    const { listener, notificationService } = createSubject({
      post: { _id: postId, userId: ownerId }
    });

    await listener.handleReaction(event({
      _id: reactionId,
      objectType: 'post',
      objectId: postId,
      action: 'like',
      createdBy: actorId
    }));

    expect(notificationService.aggregate).toHaveBeenCalledWith({
      recipientId: ownerId,
      actorId,
      type: 'post_like',
      groupKey: `post_like:${postId}`,
      postId,
      commentId: undefined,
      eventId: reactionId
    });
  });

  it('aggregates comment likes and preserves the containing post target', async () => {
    const reactionId = new ObjectId();
    const commentId = new ObjectId();
    const postId = new ObjectId();
    const ownerId = new ObjectId();
    const actorId = new ObjectId();
    const { listener, notificationService } = createSubject({
      comment: {
        _id: commentId,
        createdBy: ownerId,
        objectType: 'post',
        objectId: postId
      }
    });

    await listener.handleReaction(event({
      _id: reactionId,
      objectType: 'comment',
      objectId: commentId,
      action: 'like',
      createdBy: actorId
    }));

    expect(notificationService.aggregate).toHaveBeenCalledWith({
      recipientId: ownerId,
      actorId,
      type: 'comment_like',
      groupKey: `comment_like:${commentId}`,
      postId,
      commentId,
      eventId: reactionId
    });
  });

  it('resurfaces follow notifications through the configured cooldown policy', async () => {
    const creatorId = new ObjectId();
    const actorId = new ObjectId();
    const { listener, notificationService, postService } = createSubject();

    await listener.handleReaction(event({
      _id: new ObjectId(),
      objectType: 'creator',
      objectId: creatorId,
      action: 'follow',
      createdBy: actorId
    }));

    expect(notificationService.resurface).toHaveBeenCalledWith({
      recipientId: creatorId,
      actorId,
      type: 'follow',
      groupKey: `follow:${actorId}`
    }, 5 * 60 * 1000);
    expect(postService.findById).not.toHaveBeenCalled();
  });

  it('does not create an interaction notification for shares', async () => {
    const { listener, notificationService, postService } = createSubject();

    await listener.handleReaction(event({
      _id: new ObjectId(),
      objectType: 'post',
      objectId: new ObjectId(),
      action: 'share',
      createdBy: new ObjectId()
    }));

    expect(notificationService.aggregate).not.toHaveBeenCalled();
    expect(postService.findById).not.toHaveBeenCalled();
  });

  it('repairs the displayed aggregate actor when the current actor unlikes', async () => {
    const reactionId = new ObjectId();
    const postId = new ObjectId();
    const ownerId = new ObjectId();
    const actorId = new ObjectId();
    const replacementId = new ObjectId();
    const subject = createSubject({
      post: { _id: postId, userId: ownerId },
      remainingReactions: [{ createdBy: replacementId }]
    });

    await subject.listener.handleReaction(event({
      _id: reactionId,
      objectType: 'post',
      objectId: postId,
      action: 'like',
      createdBy: actorId
    }, 'deleted'));

    expect(subject.notificationService.replaceAggregateActor).toHaveBeenCalledWith(
      ownerId,
      `post_like:${postId}`,
      actorId,
      expect.any(Function)
    );
    const replacementResolver = subject.notificationService.replaceAggregateActor.mock.calls[0][3];
    await expect(replacementResolver()).resolves.toEqual(replacementId);
  });

  it('swallows failures so the committed reaction is never rolled back', async () => {
    const subject = createSubject();
    subject.postService.findById.mockRejectedValue(new Error('post lookup failed'));

    await expect(subject.listener.handleReaction(event({
      _id: new ObjectId(),
      objectType: 'post',
      objectId: new ObjectId(),
      action: 'like',
      createdBy: new ObjectId()
    }))).resolves.toBeUndefined();
  });
});
