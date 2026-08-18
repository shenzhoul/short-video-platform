import { ObjectId } from 'mongodb';
import { NOTIFICATION_TYPES } from 'src/common/constants';
import { EVENT } from 'src/kernel/constants';

import { NotificationService } from './notification.service';

/**
 * Realtime invalidation when a referenced comment is deleted.
 *
 * The decisive property is convergence: because the update is produced by the
 * same read-time resolver the list endpoint uses, a realtime patch and a fresh
 * fetch cannot disagree about what "deleted" means.
 */
function createSubject(options: { rows?: any[]; comments?: any[] } = {}) {
  const rows = options.rows || [];
  const notificationModel = {
    find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) })
  };
  const postModel = { find: () => ({ select: () => ({ lean: async () => [] }) }) };
  const commentModel = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: async () => options.comments || [] })
    })
  };
  const queueMessageService = { publish: jest.fn().mockResolvedValue(undefined) };

  const service = new NotificationService(
    notificationModel as any,
    postModel as any,
    commentModel as any,
    { findByIds: jest.fn().mockResolvedValue([]) } as any,
    { getFollowingCreatorIdSet: jest.fn().mockResolvedValue(new Set()) } as any,
    queueMessageService as any
  );

  return {
    service, notificationModel, queueMessageService
  };
}

const recipient = new ObjectId();
const postId = new ObjectId();

function row(overrides: Record<string, any> = {}) {
  return {
    _id: new ObjectId(),
    recipientId: recipient,
    actorId: new ObjectId(),
    type: NOTIFICATION_TYPES.POST_COMMENT,
    groupKey: 'k',
    postId,
    commentId: null,
    aggregateResourceId: null,
    lastEventId: null,
    isAggregate: false,
    activityCount: 1,
    read: true,
    readAt: new Date(),
    lastActivityAt: new Date(),
    createdAt: new Date(),
    ...overrides
  };
}

const published = (q: any) => q.publish.mock.calls.map(([, event]) => event);

describe('comment deletion invalidates referencing notifications', () => {
  it('re-publishes the affected notification as an update', async () => {
    const commentId = new ObjectId();
    const { service, queueMessageService } = createSubject({
      rows: [row({ commentId })],
      // The comment lookup finds nothing — exactly what deletion looks like.
      comments: []
    });

    const updated = await service.invalidateByCommentIds([commentId]);

    expect(updated).toHaveLength(1);
    expect(updated[0].commentDeleted).toBe(true);
    expect(updated[0].commentPreview).toBeNull();
    // An update, never a creation: the client patches rather than inserting.
    expect(published(queueMessageService)[0].eventName).toBe(EVENT.UPDATED);
  });

  it('searches both reference fields, since an aggregate previews lastEventId', async () => {
    const commentId = new ObjectId();
    const { service, notificationModel } = createSubject({ rows: [], comments: [] });

    await service.invalidateByCommentIds([commentId]);

    const filter = notificationModel.find.mock.calls[0][0];
    expect(filter.$or).toEqual([
      { commentId: { $in: [expect.anything()] } },
      { lastEventId: { $in: [expect.anything()] } }
    ]);
  });

  it('never deletes or mutates the notification document', async () => {
    const commentId = new ObjectId();
    const { service, notificationModel } = createSubject({
      rows: [row({ commentId })], comments: []
    });

    await service.invalidateByCommentIds([commentId]);

    // The interaction still happened, so the history stays.
    expect((notificationModel as any).deleteMany).toBeUndefined();
    expect((notificationModel as any).updateOne).toBeUndefined();
  });

  it('preserves read state, so a read row does not become unread', async () => {
    const commentId = new ObjectId();
    const { service } = createSubject({
      rows: [row({ commentId, read: true })], comments: []
    });

    const [updated] = await service.invalidateByCommentIds([commentId]);

    expect(updated.read).toBe(true);
  });

  it('does nothing when no notification references the comment', async () => {
    const { service, queueMessageService } = createSubject({ rows: [], comments: [] });

    await expect(service.invalidateByCommentIds([new ObjectId()])).resolves.toEqual([]);
    expect(queueMessageService.publish).not.toHaveBeenCalled();
  });

  it('ignores an empty id list without querying', async () => {
    const { service, notificationModel } = createSubject();

    await expect(service.invalidateByCommentIds([])).resolves.toEqual([]);
    expect(notificationModel.find).not.toHaveBeenCalled();
  });

  it('covers replies and mentions, not just top-level comments', async () => {
    const commentId = new ObjectId();
    const { service } = createSubject({
      rows: [
        row({ commentId, type: NOTIFICATION_TYPES.COMMENT_REPLY }),
        row({ commentId, type: NOTIFICATION_TYPES.COMMENT_MENTION })
      ],
      comments: []
    });

    const updated = await service.invalidateByCommentIds([commentId]);

    expect(updated).toHaveLength(2);
    expect(updated.every((dto) => dto.commentDeleted === true)).toBe(true);
  });

  it('addresses each recipient separately', async () => {
    const commentId = new ObjectId();
    const otherRecipient = new ObjectId();
    const { service } = createSubject({
      rows: [row({ commentId }), row({ commentId, recipientId: otherRecipient })],
      comments: []
    });

    const updated = await service.invalidateByCommentIds([commentId]);

    const recipients = updated.map((dto) => dto.recipientId.toString());
    expect(new Set(recipients).size).toBe(2);
  });

  it('is idempotent, so a queue retry changes nothing', async () => {
    const commentId = new ObjectId();
    const { service } = createSubject({ rows: [row({ commentId })], comments: [] });

    const first = await service.invalidateByCommentIds([commentId]);
    const second = await service.invalidateByCommentIds([commentId]);

    expect(second[0].commentDeleted).toBe(first[0].commentDeleted);
    expect(second[0].commentPreview).toBe(first[0].commentPreview);
  });
});

describe('realtime invalidation converges with a fresh fetch', () => {
  it('produces the same rendered state a list request would', async () => {
    const commentId = new ObjectId();
    const rows = [row({ commentId })];

    // STATE 2: realtime invalidation after the comment is gone.
    const live = createSubject({ rows, comments: [] });
    const [realtime] = await live.service.invalidateByCommentIds([commentId]);

    // STATE 3: an independent fresh read of the same row, same missing comment.
    const fresh = createSubject({ rows, comments: [] });
    (fresh as any).service.NotificationModel = undefined;
    const listModel = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        skip: jest.fn().mockResolvedValue(rows)
      }),
      countDocuments: jest.fn().mockResolvedValue(rows.length)
    };
    const refetchService = new NotificationService(
      listModel as any,
      { find: () => ({ select: () => ({ lean: async () => [] }) }) } as any,
      { find: () => ({ select: () => ({ lean: async () => [] }) }) } as any,
      { findByIds: jest.fn().mockResolvedValue([]) } as any,
      { getFollowingCreatorIdSet: jest.fn().mockResolvedValue(new Set()) } as any,
      { publish: jest.fn() } as any
    );
    const page = await refetchService.search({} as any, { _id: recipient } as any);
    const refetched = page.data[0];

    // Realtime is a transport optimisation; it must not define different
    // business semantics from the read path.
    expect(realtime.commentDeleted).toBe(refetched.commentDeleted);
    expect(realtime.commentPreview).toBe(refetched.commentPreview);
    expect(realtime.type).toBe(refetched.type);
  });

  it('an aggregate whose newest event was deleted resolves as the read path does', async () => {
    const first = new ObjectId();
    const newest = new ObjectId();
    const aggregate = row({
      commentId: first, lastEventId: newest, isAggregate: true, activityCount: 3
    });

    // Newest gone; the resolver keys the preview on lastEventId, so it reports
    // deleted rather than silently quoting the older comment.
    const { service } = createSubject({ rows: [aggregate], comments: [] });
    const [updated] = await service.invalidateByCommentIds([newest]);

    expect(updated.commentDeleted).toBe(true);
    expect(updated.commentPreview).toBeNull();
  });
});
