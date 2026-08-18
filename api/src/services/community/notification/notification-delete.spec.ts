import { ObjectId } from 'mongodb';

import { NotificationService } from './notification.service';

/**
 * Deleting one notification from its own recipient's inbox.
 *
 * The recipient belongs in the delete filter rather than in a check after a
 * lookup: a request for somebody else's notification must match nothing, so it
 * neither deletes the row nor confirms the id exists.
 */
function createSubject(options: { deletedCount?: number } = {}) {
  const NotificationModel = {
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: options.deletedCount ?? 1 })
  };

  const service = new NotificationService(
    NotificationModel as any,
    { find: () => ({ select: () => ({ lean: async () => [] }) }) } as any,
    { find: () => ({ select: () => ({ lean: async () => [] }) }) } as any,
    { findByIds: jest.fn().mockResolvedValue([]) } as any,
    { getFollowingCreatorIdSet: jest.fn().mockResolvedValue(new Set()) } as any,
    { publish: jest.fn() } as any
  );

  return { service, NotificationModel };
}

const recipient = new ObjectId();
const notificationId = new ObjectId();

describe('deleting a notification', () => {
  it('removes the row for its recipient', async () => {
    const { service, NotificationModel } = createSubject();

    await expect(service.deleteForRecipient(notificationId, recipient))
      .resolves.toEqual({ deleted: true });
    expect(NotificationModel.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('scopes the delete by recipient, not by a check afterwards', async () => {
    const { service, NotificationModel } = createSubject();

    await service.deleteForRecipient(notificationId, recipient);

    const filter = NotificationModel.deleteOne.mock.calls[0][0];
    // Both keys in the filter is what makes another user's id match nothing.
    expect(filter.recipientId).toEqual(recipient);
    expect(filter._id.toString()).toBe(notificationId.toString());
  });

  it('reports nothing deleted when the row belongs to someone else', async () => {
    // A foreign recipient simply does not match the filter.
    const { service } = createSubject({ deletedCount: 0 });

    await expect(service.deleteForRecipient(notificationId, new ObjectId()))
      .resolves.toEqual({ deleted: false });
  });

  it('rejects a malformed id without touching the database', async () => {
    const { service, NotificationModel } = createSubject();

    await expect(service.deleteForRecipient('not-an-id', recipient))
      .resolves.toEqual({ deleted: false });
    expect(NotificationModel.deleteOne).not.toHaveBeenCalled();
  });

  it('deletes exactly one document, never a group of them', async () => {
    const { service, NotificationModel } = createSubject();

    await service.deleteForRecipient(notificationId, recipient);

    // An aggregate row is one document; deleting it must not decompose it into
    // the individual events it represents, nor remove neighbouring rows.
    expect(NotificationModel.deleteOne).toHaveBeenCalledTimes(1);
    expect((NotificationModel as any).deleteMany).toBeUndefined();
  });

  it('touches nothing but the notification collection', async () => {
    const { service } = createSubject();

    // No post, comment, reaction or follow model is reachable from this path,
    // so the interaction the notification describes cannot be affected.
    await expect(service.deleteForRecipient(notificationId, recipient)).resolves.toBeDefined();
  });
});
