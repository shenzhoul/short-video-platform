import { ObjectId } from 'mongodb';
import {
  NOTIFICATION_FILTERS,
  NOTIFICATION_TYPES
} from 'src/common/constants';

import { NotificationService } from './notification.service';

function createSubject(options: {
  rows?: Array<Record<string, any>>;
  posts?: Array<Record<string, any>>;
  comments?: Array<Record<string, any>>;
  followedActorIds?: Set<string>;
  unreadCount?: number;
} = {}) {
  const rows = options.rows || [];
  const findQuery = {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockResolvedValue(rows)
  };
  const notificationModel = {
    find: jest.fn().mockReturnValue(findQuery),
    countDocuments: jest.fn().mockResolvedValue(options.unreadCount ?? rows.length),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 })
  };
  const postModel = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(options.posts || [])
      })
    })
  };
  const commentModel = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(options.comments || [])
      })
    })
  };
  const baseUserService = { findByIds: jest.fn().mockResolvedValue([]) };
  const followService = {
    getFollowingCreatorIdSet: jest.fn().mockResolvedValue(options.followedActorIds || new Set())
  };
  const queueMessageService = { publish: jest.fn() };

  const service = new NotificationService(
    notificationModel as any,
    postModel as any,
    commentModel as any,
    baseUserService as any,
    followService as any,
    queueMessageService as any
  );

  return {
    service,
    notificationModel,
    findQuery,
    followService
  };
}

describe('NotificationService read state', () => {
  it('marks only the caller\'s unread notifications', async () => {
    const userId = new ObjectId();
    const { service, notificationModel } = createSubject();

    await expect(service.markAllRead(userId)).resolves.toEqual({ updated: 3 });
    expect(notificationModel.updateMany).toHaveBeenCalledWith(
      { recipientId: userId, read: false },
      { $set: expect.objectContaining({ read: true, readAt: expect.any(Date) }) }
    );
  });

  it('counts only the caller\'s unread notifications', async () => {
    const userId = new ObjectId();
    const { service, notificationModel } = createSubject({ unreadCount: 7 });

    await expect(service.countUnread(userId)).resolves.toBe(7);
    expect(notificationModel.countDocuments).toHaveBeenCalledWith({
      recipientId: userId,
      read: false
    });
  });
});

describe('NotificationService.search', () => {
  it('always scopes the query to the authenticated recipient', async () => {
    const viewerId = new ObjectId();
    const { service, notificationModel } = createSubject();

    await service.search({ limit: 10, offset: 0 } as any, { _id: viewerId } as any);

    expect(notificationModel.find.mock.calls[0][0].recipientId).toEqual(viewerId);
  });

  it('maps a panel category to every persisted type in that group', async () => {
    const { service, notificationModel } = createSubject();

    await service.search(
      { category: NOTIFICATION_FILTERS.MENTIONS, limit: 10 } as any,
      { _id: new ObjectId() } as any
    );

    expect(notificationModel.find.mock.calls[0][0].type).toEqual({
      $in: [NOTIFICATION_TYPES.POST_MENTION, NOTIFICATION_TYPES.COMMENT_MENTION]
    });
  });

  it('orders and pages by last activity', async () => {
    const rows = Array.from({ length: 3 }, () => ({
      _id: new ObjectId(),
      actorId: new ObjectId(),
      type: NOTIFICATION_TYPES.FOLLOW,
      lastActivityAt: new Date('2026-08-12T10:00:00.000Z')
    }));
    const { service, findQuery } = createSubject({ rows });

    const result = await service.search(
      { limit: 2, offset: 0 } as any,
      { _id: new ObjectId() } as any
    );

    expect(findQuery.sort).toHaveBeenCalledWith({ lastActivityAt: -1, _id: -1 });
    expect(findQuery.limit).toHaveBeenCalledWith(3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual({
      id: rows[1]._id.toString(),
      createdAt: rows[1].lastActivityAt.getTime()
    });
  });

  it('returns aggregate actor counts through a real NotificationDto instance', async () => {
    const rows = [{
      _id: new ObjectId(),
      recipientId: new ObjectId(),
      actorId: new ObjectId(),
      type: NOTIFICATION_TYPES.POST_COMMENT,
      isAggregate: true,
      activityCount: 4,
      read: false,
      lastActivityAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    }];
    const { service } = createSubject({ rows });

    const result = await service.search(
      { limit: 10, offset: 0 } as any,
      { _id: rows[0].recipientId } as any
    );

    expect(result.data[0].actorCount).toBe(4);
    expect(result.data[0].isAggregate).toBe(true);
    expect(result.data[0].activityCount).toBe(4);
  });

  it('resolves follow state in one batched query', async () => {
    const viewerId = new ObjectId();
    const actorId = new ObjectId();
    const rows = [{
      _id: new ObjectId(),
      recipientId: viewerId,
      actorId,
      type: NOTIFICATION_TYPES.FOLLOW,
      lastActivityAt: new Date()
    }];
    const subject = createSubject({
      rows,
      followedActorIds: new Set([actorId.toString()])
    });

    const result = await subject.service.search(
      { limit: 10, offset: 0 } as any,
      { _id: viewerId } as any
    );

    expect(subject.followService.getFollowingCreatorIdSet).toHaveBeenCalledTimes(1);
    expect(result.data[0].isActorFollowed).toBe(true);
  });
});
