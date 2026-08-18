import { ObjectId } from 'mongodb';

import { NotificationCommentListener } from './notification-comment.listener';

function createSubject(options: {
  post?: Record<string, any>;
  parentComment?: Record<string, any>;
  /** Users who have replied in the thread, i.e. genuine participants. */
  threadRepliers?: string[];
} = {}) {
  const notificationService = {
    recordAdaptive: jest.fn().mockResolvedValue(null),
    createOnce: jest.fn().mockResolvedValue(null)
  };
  const commentService = {
    findById: jest.fn().mockResolvedValue(options.parentComment || null),
    hasReplyFromUser: jest.fn().mockImplementation(
      async (_rootId: any, userId: any) => (options.threadRepliers || []).includes(userId.toString())
    )
  };
  const postService = { findById: jest.fn().mockResolvedValue(options.post || null) };
  const queueMessageService = { subscribe: jest.fn(), publish: jest.fn() };

  const listener = new NotificationCommentListener(
    queueMessageService as any,
    notificationService as any,
    commentService as any,
    postService as any
  );

  return {
    listener, notificationService, commentService, postService, queueMessageService
  };
}

function event(data: Record<string, any>, eventName = 'created') {
  return { data: { eventName, data } } as any;
}

describe('NotificationCommentListener', () => {
  it('subscribes under its own topic, leaving the counter listeners untouched', () => {
    const { queueMessageService } = createSubject();

    expect(queueMessageService.subscribe).toHaveBeenCalledWith(
      'COMMENT_CHANNELS.COMMENT',
      'NOTIFICATION_COMMENT_TOPIC',
      expect.any(Function)
    );
  });

  it('notifies the post owner about a top-level comment', async () => {
    const postId = new ObjectId();
    const ownerId = new ObjectId();
    const actorId = new ObjectId();
    const commentId = new ObjectId();
    const { listener, notificationService } = createSubject({
      post: { _id: postId, userId: ownerId }
    });

    await listener.handleComment(event({
      _id: commentId, objectType: 'post', objectId: postId, createdBy: actorId
    }));

    expect(notificationService.recordAdaptive).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: ownerId,
      actorId,
      type: 'post_comment',
      postId,
      commentId
    }));
  });

  it('notifies the parent comment author about a reply, not the post owner', async () => {
    const postId = new ObjectId();
    const parentCommentId = new ObjectId();
    const parentAuthorId = new ObjectId();
    const actorId = new ObjectId();
    const replyId = new ObjectId();
    const { listener, notificationService, postService } = createSubject({
      parentComment: {
        _id: parentCommentId,
        createdBy: parentAuthorId,
        objectType: 'post',
        objectId: postId
      }
    });

    await listener.handleComment(event({
      _id: replyId, objectType: 'comment', objectId: parentCommentId, createdBy: actorId
    }));

    // The reply carries the post id too: the app has no per-comment deep link,
    // so the notification navigates to the containing post.
    expect(notificationService.recordAdaptive).toHaveBeenCalledWith(expect.objectContaining({
      recipientId: parentAuthorId,
      actorId,
      type: 'comment_reply',
      postId,
      commentId: replyId
    }));
    expect(postService.findById).not.toHaveBeenCalled();
  });

  it('notifies the comment author even when someone else owns the post', async () => {
    const postOwnerId = new ObjectId();   // A
    const commentAuthorId = new ObjectId(); // B commented on A's post
    const replierId = new ObjectId();       // C replies to B
    const postId = new ObjectId();
    const parentCommentId = new ObjectId();
    const replyId = new ObjectId();
    const { listener, notificationService, postService } = createSubject({
      parentComment: {
        _id: parentCommentId,
        createdBy: commentAuthorId,
        objectType: 'post',
        objectId: postId
      },
      post: { _id: postId, userId: postOwnerId }
    });

    await listener.handleComment(event({
      _id: replyId, objectType: 'comment', objectId: parentCommentId, createdBy: replierId
    }));

    const [payload] = notificationService.recordAdaptive.mock.calls[0];
    // The reply belongs to the comment's author, never to whoever owns the post.
    expect(payload.recipientId).toEqual(commentAuthorId);
    expect(payload.recipientId).not.toEqual(postOwnerId);
    expect(payload.actorId).toEqual(replierId);
    expect(payload.type).toBe('comment_reply');
    // The containing post is resolved separately, from the parent comment, and
    // must be correct even though the post belongs to someone else entirely.
    expect(payload.postId).toEqual(postId);
    expect(payload.commentId).toEqual(replyId);
    expect(postService.findById).not.toHaveBeenCalled();
  });

  it('notifies the person being answered when replying inside a thread', async () => {
    const rootAuthorId = new ObjectId();  // B started the thread
    const repliedToId = new ObjectId();   // C replied in it
    const replierId = new ObjectId();     // D answers C
    const postId = new ObjectId();
    const parentCommentId = new ObjectId();
    const replyId = new ObjectId();
    const { listener, notificationService } = createSubject({
      parentComment: {
        _id: parentCommentId,
        createdBy: rootAuthorId,
        objectType: 'post',
        objectId: postId
      },
      threadRepliers: [repliedToId.toString()]
    });

    // Threads are flat: the reply still attaches to the top-level comment, and
    // the person actually being answered arrives as replyToUserId.
    await listener.handleComment(event({
      _id: replyId,
      objectType: 'comment',
      objectId: parentCommentId,
      createdBy: replierId,
      replyToUserId: repliedToId
    }));

    const [payload] = notificationService.recordAdaptive.mock.calls[0];
    expect(payload.recipientId).toEqual(repliedToId);
    expect(payload.recipientId).not.toEqual(rootAuthorId);
    expect(payload.postId).toEqual(postId);
  });

  it('falls back to the comment author when a direct reply carries no reply target', async () => {
    const commentAuthorId = new ObjectId();
    const replierId = new ObjectId();
    const parentCommentId = new ObjectId();
    const { listener, notificationService } = createSubject({
      parentComment: {
        _id: parentCommentId,
        createdBy: commentAuthorId,
        objectType: 'post',
        objectId: new ObjectId()
      }
    });

    await listener.handleComment(event({
      _id: new ObjectId(), objectType: 'comment', objectId: parentCommentId, createdBy: replierId
    }));

    expect(notificationService.recordAdaptive.mock.calls[0][0].recipientId).toEqual(commentAuthorId);
  });

  it('routes a self-reply to the replier, leaving suppression to the service', async () => {
    const authorId = new ObjectId();
    const parentCommentId = new ObjectId();
    const { listener, notificationService } = createSubject({
      parentComment: {
        _id: parentCommentId,
        createdBy: authorId,
        objectType: 'post',
        objectId: new ObjectId()
      }
    });

    await listener.handleComment(event({
      _id: new ObjectId(), objectType: 'comment', objectId: parentCommentId, createdBy: authorId
    }));

    const [payload] = notificationService.recordAdaptive.mock.calls[0];
    // Recipient equals actor, which NotificationService.recordAdaptive drops without
    // writing a row — the single place that rule is enforced.
    expect(payload.recipientId).toEqual(payload.actorId);
  });

  it('skips a reply whose parent comment no longer exists', async () => {
    const { listener, notificationService } = createSubject({ parentComment: null });

    await listener.handleComment(event({
      _id: new ObjectId(), objectType: 'comment', objectId: new ObjectId(), createdBy: new ObjectId()
    }));

    expect(notificationService.recordAdaptive).not.toHaveBeenCalled();
  });

  it('ignores deletions', async () => {
    const { listener, notificationService } = createSubject({
      post: { _id: new ObjectId(), userId: new ObjectId() }
    });

    await listener.handleComment(event({
      _id: new ObjectId(), objectType: 'post', objectId: new ObjectId(), createdBy: new ObjectId()
    }, 'deleted'));

    expect(notificationService.recordAdaptive).not.toHaveBeenCalled();
  });

  it('swallows failures so the stored comment is never rolled back', async () => {
    const { listener, postService } = createSubject();
    postService.findById.mockRejectedValue(new Error('post lookup failed'));

    await expect(listener.handleComment(event({
      _id: new ObjectId(), objectType: 'post', objectId: new ObjectId(), createdBy: new ObjectId()
    }))).resolves.toBeUndefined();
  });
});

describe('NotificationCommentListener reply-target validation', () => {
  it('ignores a reply target who is not in the thread', async () => {
    const threadAuthorId = new ObjectId();
    const strangerId = new ObjectId();   // never commented or replied here
    const replierId = new ObjectId();
    const parentCommentId = new ObjectId();
    const { listener, notificationService, commentService } = createSubject({
      parentComment: {
        _id: parentCommentId,
        createdBy: threadAuthorId,
        objectType: 'post',
        objectId: new ObjectId()
      },
      threadRepliers: []
    });

    await listener.handleComment(event({
      _id: new ObjectId(),
      objectType: 'comment',
      objectId: parentCommentId,
      createdBy: replierId,
      // Spoofed: a crafted request naming an unrelated user.
      replyToUserId: strangerId
    }));

    expect(commentService.hasReplyFromUser).toHaveBeenCalledWith(
      parentCommentId, strangerId.toString()
    );
    const [payload] = notificationService.recordAdaptive.mock.calls[0];
    // The claim is discarded and the thread's own author is notified instead.
    expect(payload.recipientId).toEqual(threadAuthorId);
    expect(payload.recipientId).not.toEqual(strangerId);
  });

  it('never notifies an unrelated user even across many spoof attempts', async () => {
    const threadAuthorId = new ObjectId();
    const parentCommentId = new ObjectId();
    const strangers = [new ObjectId(), new ObjectId(), new ObjectId()];
    const { listener, notificationService } = createSubject({
      parentComment: {
        _id: parentCommentId,
        createdBy: threadAuthorId,
        objectType: 'post',
        objectId: new ObjectId()
      },
      threadRepliers: []
    });

    await strangers.reduce(async (previous, stranger) => {
      await previous;
      return listener.handleComment(event({
        _id: new ObjectId(),
        objectType: 'comment',
        objectId: parentCommentId,
        createdBy: new ObjectId(),
        replyToUserId: stranger
      }));
    }, Promise.resolve());

    const recipients = notificationService.recordAdaptive.mock.calls
      .map((call) => call[0].recipientId.toString());
    expect(recipients).toHaveLength(3);
    expect(recipients.every((id) => id === threadAuthorId.toString())).toBe(true);
    strangers.forEach((stranger) => {
      expect(recipients).not.toContain(stranger.toString());
    });
  });

  it('accepts the thread author as a reply target without an extra lookup', async () => {
    const threadAuthorId = new ObjectId();
    const parentCommentId = new ObjectId();
    const { listener, notificationService, commentService } = createSubject({
      parentComment: {
        _id: parentCommentId,
        createdBy: threadAuthorId,
        objectType: 'post',
        objectId: new ObjectId()
      }
    });

    await listener.handleComment(event({
      _id: new ObjectId(),
      objectType: 'comment',
      objectId: parentCommentId,
      createdBy: new ObjectId(),
      replyToUserId: threadAuthorId
    }));

    expect(notificationService.recordAdaptive.mock.calls[0][0].recipientId).toEqual(threadAuthorId);
    // Matching the thread author is settled in memory, so the common direct
    // reply costs no participant query.
    expect(commentService.hasReplyFromUser).not.toHaveBeenCalled();
  });

  it('does not query participants for a direct reply', async () => {
    const { listener, commentService } = createSubject({
      parentComment: {
        _id: new ObjectId(),
        createdBy: new ObjectId(),
        objectType: 'post',
        objectId: new ObjectId()
      }
    });

    await listener.handleComment(event({
      _id: new ObjectId(),
      objectType: 'comment',
      objectId: new ObjectId(),
      createdBy: new ObjectId()
    }));

    expect(commentService.hasReplyFromUser).not.toHaveBeenCalled();
  });
});

describe('NotificationCommentListener mentions', () => {
  it('notifies everyone named in a top-level comment', async () => {
    const postOwnerId = new ObjectId();
    const authorId = new ObjectId();
    const postId = new ObjectId();
    const commentId = new ObjectId();
    const first = new ObjectId();
    const second = new ObjectId();
    const { listener, notificationService } = createSubject({
      post: { _id: postId, userId: postOwnerId }
    });

    await listener.handleComment(event({
      _id: commentId,
      objectType: 'post',
      objectId: postId,
      createdBy: authorId,
      mentionedUserIds: [first, second]
    }));

    expect(notificationService.createOnce).toHaveBeenCalledTimes(2);
    const [payload] = notificationService.createOnce.mock.calls[0];
    expect(payload.type).toBe('comment_mention');
    expect(payload.recipientId).toBe(first.toString());
    expect(payload.actorId).toEqual(authorId);
    expect(payload.postId).toEqual(postId);
    expect(payload.commentId).toEqual(commentId);
    expect(payload.groupKey).toBe(`comment_mention:${commentId.toString()}`);

    // The post owner still receives their own comment notification; a mention
    // never replaces it.
    expect(notificationService.recordAdaptive).toHaveBeenCalledTimes(1);
    expect(notificationService.recordAdaptive.mock.calls[0][0].type).toBe('post_comment');
  });

  it('notifies someone named twice in one comment only once', async () => {
    const repeated = new ObjectId();
    const postId = new ObjectId();
    const { listener, notificationService } = createSubject({
      post: { _id: postId, userId: new ObjectId() }
    });

    await listener.handleComment(event({
      _id: new ObjectId(),
      objectType: 'post',
      objectId: postId,
      createdBy: new ObjectId(),
      mentionedUserIds: [repeated, repeated]
    }));

    expect(notificationService.createOnce).toHaveBeenCalledTimes(1);
  });

  it('notifies mentions inside a reply and carries the containing post', async () => {
    const postId = new ObjectId();
    const parentCommentId = new ObjectId();
    const replyId = new ObjectId();
    const mentioned = new ObjectId();
    const { listener, notificationService } = createSubject({
      parentComment: {
        _id: parentCommentId,
        createdBy: new ObjectId(),
        objectType: 'post',
        objectId: postId
      }
    });

    await listener.handleComment(event({
      _id: replyId,
      objectType: 'comment',
      objectId: parentCommentId,
      createdBy: new ObjectId(),
      mentionedUserIds: [mentioned]
    }));

    const [payload] = notificationService.createOnce.mock.calls[0];
    expect(payload.type).toBe('comment_mention');
    expect(payload.recipientId).toBe(mentioned.toString());
    expect(payload.postId).toEqual(postId);
    expect(payload.commentId).toEqual(replyId);
  });

  it('routes a self-mention to the service, which drops it', async () => {
    const authorId = new ObjectId();
    const postId = new ObjectId();
    const { listener, notificationService } = createSubject({
      post: { _id: postId, userId: new ObjectId() }
    });

    await listener.handleComment(event({
      _id: new ObjectId(),
      objectType: 'post',
      objectId: postId,
      createdBy: authorId,
      mentionedUserIds: [authorId]
    }));

    const [payload] = notificationService.createOnce.mock.calls[0];
    expect(payload.recipientId).toBe(payload.actorId.toString());
  });

  it('does not touch mentions when a comment names nobody', async () => {
    const postId = new ObjectId();
    const { listener, notificationService } = createSubject({
      post: { _id: postId, userId: new ObjectId() }
    });

    await listener.handleComment(event({
      _id: new ObjectId(), objectType: 'post', objectId: postId, createdBy: new ObjectId()
    }));

    expect(notificationService.createOnce).not.toHaveBeenCalled();
  });
});
