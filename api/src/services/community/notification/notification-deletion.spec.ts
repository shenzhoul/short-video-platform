import { ObjectId } from 'mongodb';
import { NOTIFICATION_GROUP_KEYS, NOTIFICATION_TYPES } from 'src/common/constants';

import { InMemoryNotificationModel } from './notification-model.testing';
import { NotificationService } from './notification.service';

/**
 * The two deletion paths, which deliberately behave differently:
 *
 *  - deleting a POST removes every notification that pointed into it, because
 *    none of them can navigate anywhere any more;
 *  - deleting a COMMENT keeps them, because the containing post still opens and
 *    the interaction still happened — the row is rendered as a removed comment.
 *
 * These tests exist so a future refactor cannot quietly collapse the two into
 * one behaviour.
 */

const recipient = new ObjectId();
const actor = new ObjectId();

function createSubject(options: { rows?: any[]; comments?: any[]; posts?: any[] } = {}) {
  const notificationModel = new InMemoryNotificationModel();
  (options.rows || []).forEach((row) => notificationModel.docs.push(row));

  const listQuery = {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockResolvedValue(options.rows || [])
  };
  // `search` uses the chained query builder; the write policies use the
  // in-memory collection. Both surfaces are served by one object.
  (notificationModel as any).find = jest.fn().mockReturnValue(listQuery);
  (notificationModel as any).countDocuments = jest.fn().mockResolvedValue((options.rows || []).length);

  const postModel = {
    find: () => ({ select: () => ({ lean: async () => options.posts || [] }) })
  };
  const commentModel = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: async () => options.comments || [] })
    })
  };
  const baseUserService = { findByIds: jest.fn().mockResolvedValue([]) };
  const followService = { getFollowingCreatorIdSet: jest.fn().mockResolvedValue(new Set()) };
  const queueMessageService = { publish: jest.fn().mockResolvedValue(undefined) };

  const service = new NotificationService(
    notificationModel as any,
    postModel as any,
    commentModel as any,
    baseUserService as any,
    followService as any,
    queueMessageService as any
  );

  return {
    service, notificationModel, commentModel
  };
}

function row(overrides: Record<string, any> = {}) {
  const postId = overrides.postId || new ObjectId();
  return {
    _id: new ObjectId(),
    recipientId: recipient,
    actorId: actor,
    type: NOTIFICATION_TYPES.POST_LIKE,
    groupKey: NOTIFICATION_GROUP_KEYS.postLike(postId.toString()),
    postId,
    commentId: null,
    aggregateResourceId: null,
    // Matches the schema default, so fixtures behave like stored rows.
    lastEventId: null,
    isAggregate: false,
    activityCount: 1,
    read: false,
    readAt: null,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    ...overrides
  };
}

describe('post deletion cascades notifications', () => {
  it('removes every notification pointing at the deleted post', async () => {
    const deletedPost = new ObjectId();
    const comment = new ObjectId();
    const { service, notificationModel } = createSubject({
      rows: [
        row({ postId: deletedPost, type: NOTIFICATION_TYPES.POST_LIKE }),
        row({ postId: deletedPost, type: NOTIFICATION_TYPES.POST_COMMENT, commentId: comment }),
        row({ postId: deletedPost, type: NOTIFICATION_TYPES.POST_MENTION }),
        row({ postId: deletedPost, type: NOTIFICATION_TYPES.COMMENT_LIKE, commentId: comment }),
        row({ postId: deletedPost, type: NOTIFICATION_TYPES.COMMENT_REPLY, commentId: comment }),
        row({ postId: deletedPost, type: NOTIFICATION_TYPES.COMMENT_MENTION, commentId: comment })
      ]
    });

    const result = await service.deleteByPostId(deletedPost);

    // Every type whose subject lived inside the post goes, not just the
    // post-scoped ones.
    expect(result.deleted).toBe(6);
    expect(notificationModel.docs).toHaveLength(0);
  });

  it('leaves notifications for other posts untouched', async () => {
    const deletedPost = new ObjectId();
    const survivingPost = new ObjectId();
    const { service, notificationModel } = createSubject({
      rows: [
        row({ postId: deletedPost }),
        row({ postId: deletedPost, type: NOTIFICATION_TYPES.POST_MENTION }),
        row({ postId: survivingPost }),
        row({ postId: survivingPost, type: NOTIFICATION_TYPES.POST_COMMENT })
      ]
    });

    await service.deleteByPostId(deletedPost);

    expect(notificationModel.docs).toHaveLength(2);
    expect(notificationModel.docs.every(
      (doc) => doc.postId.toString() === survivingPost.toString()
    )).toBe(true);
  });

  it('leaves follow notifications alone, since they carry no post', async () => {
    const deletedPost = new ObjectId();
    const { service, notificationModel } = createSubject({
      rows: [
        row({ postId: deletedPost }),
        row({
          postId: null,
          type: NOTIFICATION_TYPES.FOLLOW,
          groupKey: NOTIFICATION_GROUP_KEYS.follow(actor.toString())
        })
      ]
    });

    await service.deleteByPostId(deletedPost);

    expect(notificationModel.docs).toHaveLength(1);
    expect(notificationModel.docs[0].type).toBe(NOTIFICATION_TYPES.FOLLOW);
  });

  it('is safe to run again when the cleanup job retries', async () => {
    const deletedPost = new ObjectId();
    const { service, notificationModel } = createSubject({
      rows: [row({ postId: deletedPost })]
    });

    await service.deleteByPostId(deletedPost);
    const second = await service.deleteByPostId(deletedPost);

    expect(second.deleted).toBe(0);
    expect(notificationModel.docs).toHaveLength(0);
  });

  it('leaves no row that would navigate to a post that no longer exists', async () => {
    const deletedPost = new ObjectId();
    const { service, notificationModel } = createSubject({
      rows: [
        row({ postId: deletedPost }),
        row({ postId: deletedPost, type: NOTIFICATION_TYPES.COMMENT_MENTION, commentId: new ObjectId() })
      ]
    });

    await service.deleteByPostId(deletedPost);

    const dangling = notificationModel.docs.filter(
      (doc) => doc.postId && doc.postId.toString() === deletedPost.toString()
    );
    expect(dangling).toHaveLength(0);
  });
});

describe('comment deletion keeps the notification as history', () => {
  const postId = new ObjectId();
  const commentId = new ObjectId();
  const viewer = recipient;

  function commentScopedRows() {
    return [
      row({
        postId, commentId, type: NOTIFICATION_TYPES.POST_COMMENT, groupKey: NOTIFICATION_GROUP_KEYS.postComment(commentId.toString())
      }),
      row({
        postId, commentId, type: NOTIFICATION_TYPES.COMMENT_REPLY, groupKey: NOTIFICATION_GROUP_KEYS.commentReply(commentId.toString())
      }),
      row({
        postId, commentId, type: NOTIFICATION_TYPES.COMMENT_LIKE, groupKey: NOTIFICATION_GROUP_KEYS.commentLike(commentId.toString())
      }),
      row({
        postId, commentId, type: NOTIFICATION_TYPES.COMMENT_MENTION, groupKey: NOTIFICATION_GROUP_KEYS.commentMention(commentId.toString())
      })
    ];
  }

  it('resolves a deleted comment as a tombstone on every comment-scoped type', async () => {
    // The comment lookup returns nothing, which is exactly what a deleted
    // comment looks like.
    const { service } = createSubject({ rows: commentScopedRows(), comments: [] });

    const page = await service.search({} as any, { _id: viewer } as any);

    expect(page.data).toHaveLength(4);
    expect(page.data.every((dto) => dto.commentDeleted === true)).toBe(true);
    // The row survives with its references intact, so it can still navigate.
    expect(page.data.every((dto) => dto.postId.toString() === postId.toString())).toBe(true);
    expect(page.data.every((dto) => dto.commentId.toString() === commentId.toString())).toBe(true);
  });

  it('reports a live comment as not deleted', async () => {
    const { service } = createSubject({
      rows: commentScopedRows(),
      comments: [{ _id: commentId, totalLike: 3 }]
    });

    const page = await service.search({} as any, { _id: viewer } as any);

    expect(page.data.every((dto) => dto.commentDeleted === false)).toBe(true);
  });

  it('never marks a row that has no comment', async () => {
    const { service } = createSubject({
      rows: [
        row({ postId, type: NOTIFICATION_TYPES.POST_LIKE }),
        row({ postId, type: NOTIFICATION_TYPES.POST_MENTION }),
        row({ postId: null, type: NOTIFICATION_TYPES.FOLLOW, groupKey: NOTIFICATION_GROUP_KEYS.follow(actor.toString()) })
      ],
      comments: []
    });

    const page = await service.search({} as any, { _id: viewer } as any);

    // Undefined rather than false: there is no comment to have been deleted.
    expect(page.data.every((dto) => dto.commentDeleted === undefined)).toBe(true);
  });

  it('resolves the whole page with one batched comment query', async () => {
    const { service, commentModel } = createSubject({
      rows: [
        ...commentScopedRows(),
        row({ postId, commentId: new ObjectId(), type: NOTIFICATION_TYPES.COMMENT_MENTION })
      ],
      comments: []
    });

    await service.search({} as any, { _id: viewer } as any);

    // Five comment-scoped rows, one query — no N+1 as the page grows.
    expect(commentModel.find).toHaveBeenCalledTimes(1);
  });

  it('keeps a comment-like aggregate readable after its comment is deleted', async () => {
    const { service } = createSubject({
      rows: [row({
        postId,
        commentId,
        type: NOTIFICATION_TYPES.COMMENT_LIKE,
        groupKey: NOTIFICATION_GROUP_KEYS.commentLike(commentId.toString()),
        isAggregate: true,
        activityCount: 1
      })],
      comments: []
    });

    const page = await service.search({} as any, { _id: viewer } as any);

    expect(page.data[0].commentDeleted).toBe(true);
    // The like statistic is gone with the comment, so the count falls back to a
    // single actor rather than rendering NaN or zero.
    expect(page.data[0].actorCount).toBe(1);
  });

  it('does not delete comment-scoped rows when only the comment is gone', async () => {
    const { service, notificationModel } = createSubject({ rows: commentScopedRows() });

    // The post is untouched, so nothing calls the cascade. This is the
    // regression guard: comment deletion must never take this path.
    await service.deleteByPostId(new ObjectId());

    expect(notificationModel.docs).toHaveLength(4);
  });
});

describe('aggregate navigation fields survive to the DTO', () => {
  const postId = new ObjectId();
  const firstComment = new ObjectId();
  const newestComment = new ObjectId();

  it('exposes lastEventId so an aggregate can target its newest event', async () => {
    const { service } = createSubject({
      rows: [row({
        postId,
        commentId: firstComment,
        lastEventId: newestComment,
        type: NOTIFICATION_TYPES.POST_COMMENT,
        groupKey: NOTIFICATION_GROUP_KEYS.postCommentAggregate(postId.toString()),
        isAggregate: true,
        activityCount: 3
      })],
      comments: [{ _id: newestComment, totalLike: 0 }]
    });

    const page = await service.search({} as any, { _id: recipient } as any);

    // commentId is insert-only and stays pinned to the comment that opened the
    // group, so navigation needs the advancing id as well.
    expect(page.data[0].commentId.toString()).toBe(firstComment.toString());
    expect(page.data[0].lastEventId.toString()).toBe(newestComment.toString());
    expect(page.data[0].isAggregate).toBe(true);
  });

  it('leaves lastEventId null on an individual row', async () => {
    const { service } = createSubject({
      rows: [row({
        postId,
        commentId: firstComment,
        type: NOTIFICATION_TYPES.POST_COMMENT,
        groupKey: NOTIFICATION_GROUP_KEYS.postComment(firstComment.toString())
      })],
      comments: [{ _id: firstComment, totalLike: 0 }]
    });

    const page = await service.search({} as any, { _id: recipient } as any);

    expect(page.data[0].lastEventId).toBeNull();
  });
});
