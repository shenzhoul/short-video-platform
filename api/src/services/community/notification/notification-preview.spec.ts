import { ObjectId } from 'mongodb';
import { NOTIFICATION_GROUP_KEYS, NOTIFICATION_TYPES } from 'src/common/constants';

import { InMemoryNotificationModel } from './notification-model.testing';
import { NotificationService } from './notification.service';

/**
 * The comment preview shown under a notification's actor.
 *
 * Resolved at read time from the live comment rather than copied into the
 * notification document, so the model stays a set of semantic references and
 * an edited comment previews its current wording.
 */

const recipient = new ObjectId();
const actor = new ObjectId();
const postId = new ObjectId();

function createSubject(options: { rows?: any[]; comments?: any[] } = {}) {
  const notificationModel = new InMemoryNotificationModel();
  const listQuery = {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockResolvedValue(options.rows || [])
  };
  (notificationModel as any).find = jest.fn().mockReturnValue(listQuery);
  (notificationModel as any).countDocuments = jest.fn()
    .mockResolvedValue((options.rows || []).length);

  const select = jest.fn().mockReturnValue({ lean: async () => options.comments || [] });
  const commentModel = { find: jest.fn().mockReturnValue({ select }) };
  const postModel = { find: () => ({ select: () => ({ lean: async () => [] }) }) };

  const service = new NotificationService(
    notificationModel as any,
    postModel as any,
    commentModel as any,
    { findByIds: jest.fn().mockResolvedValue([]) } as any,
    { getFollowingCreatorIdSet: jest.fn().mockResolvedValue(new Set()) } as any,
    { publish: jest.fn() } as any
  );

  return { service, commentModel, select };
}

function row(overrides: Record<string, any> = {}) {
  return {
    _id: new ObjectId(),
    recipientId: recipient,
    actorId: actor,
    type: NOTIFICATION_TYPES.POST_COMMENT,
    groupKey: 'k',
    postId,
    commentId: null,
    aggregateResourceId: null,
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

const list = (service: NotificationService) => service.search({} as any, { _id: recipient } as any);

describe('notification comment preview', () => {
  it('quotes the referenced comment on every comment-scoped type', async () => {
    const commentId = new ObjectId();
    const rows = [
      NOTIFICATION_TYPES.POST_COMMENT,
      NOTIFICATION_TYPES.COMMENT_REPLY,
      NOTIFICATION_TYPES.COMMENT_LIKE,
      NOTIFICATION_TYPES.COMMENT_MENTION
    ].map((type) => row({ type, commentId }));

    const { service } = createSubject({
      rows,
      comments: [{ _id: commentId, totalLike: 2, content: 'Is there a good travel guide? @devuser' }]
    });

    const page = await list(service);

    expect(page.data).toHaveLength(4);
    expect(page.data.every(
      (dto) => dto.commentPreview === 'Is there a good travel guide? @devuser'
    )).toBe(true);
    expect(page.data.every((dto) => dto.commentDeleted === false)).toBe(true);
  });

  it('drops the preview and marks the row deleted once the comment is gone', async () => {
    const commentId = new ObjectId();
    const { service } = createSubject({
      rows: [row({ type: NOTIFICATION_TYPES.COMMENT_MENTION, commentId })],
      comments: []
    });

    const page = await list(service);

    // The client renders the removal notice in place of a quote.
    expect(page.data[0].commentDeleted).toBe(true);
    expect(page.data[0].commentPreview).toBeNull();
  });

  it('quotes nothing for a row that has no comment', async () => {
    const { service } = createSubject({
      rows: [
        row({ type: NOTIFICATION_TYPES.POST_LIKE, groupKey: NOTIFICATION_GROUP_KEYS.postLike(postId.toString()) }),
        row({
          type: NOTIFICATION_TYPES.FOLLOW,
          postId: null,
          groupKey: NOTIFICATION_GROUP_KEYS.follow(actor.toString())
        })
      ],
      comments: []
    });

    const page = await list(service);

    expect(page.data.every((dto) => dto.commentPreview === undefined)).toBe(true);
    expect(page.data.every((dto) => dto.commentDeleted === undefined)).toBe(true);
  });

  it('quotes an aggregate newest event, not the comment that opened the group', async () => {
    const first = new ObjectId();
    const newest = new ObjectId();
    const { service } = createSubject({
      rows: [row({
        type: NOTIFICATION_TYPES.POST_COMMENT,
        commentId: first,
        lastEventId: newest,
        isAggregate: true,
        activityCount: 3
      })],
      comments: [
        { _id: first, content: 'the comment that opened the group' },
        { _id: newest, content: 'the newest comment' }
      ]
    });

    const page = await list(service);

    // The row reads "H and 2 others commented", so quoting the comment H
    // replaced would contradict the headline.
    expect(page.data[0].commentPreview).toBe('the newest comment');
  });

  it('quotes the liked comment for a like aggregate, never a reaction', async () => {
    const commentId = new ObjectId();
    const reactionId = new ObjectId();
    const { service } = createSubject({
      rows: [row({
        type: NOTIFICATION_TYPES.COMMENT_LIKE,
        commentId,
        // For a like aggregate this is a reaction id, not a comment.
        lastEventId: reactionId,
        isAggregate: true
      })],
      comments: [{ _id: commentId, totalLike: 4, content: 'the liked comment' }]
    });

    const page = await list(service);

    expect(page.data[0].commentPreview).toBe('the liked comment');
    expect(page.data[0].actorCount).toBe(4);
  });

  it('resolves a whole page with one batched comment query', async () => {
    const rows = Array.from({ length: 12 }, () => row({
      type: NOTIFICATION_TYPES.COMMENT_MENTION, commentId: new ObjectId()
    }));
    const { service, commentModel, select } = createSubject({ rows, comments: [] });

    await list(service);

    // Twelve comment-scoped rows, one query — no N+1 as the page grows.
    expect(commentModel.find).toHaveBeenCalledTimes(1);
    // The preview text is fetched in the same projection as the count.
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ content: 1, totalLike: 1 }));
  });
});
