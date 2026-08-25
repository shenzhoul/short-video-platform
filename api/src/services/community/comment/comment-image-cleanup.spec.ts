import { ObjectId } from 'mongodb';

import { CommentService } from './comment.service';

/**
 * What happens to the picture when the comment goes.
 *
 * The database and the filesystem have no shared transaction, so the ordering
 * has to be chosen such that every failure lands somewhere recoverable. Deleting
 * the comment first means the worst case is an unreferenced file — precisely
 * what the sweeper collects — rather than a comment pointing at a file that is
 * already gone.
 */
function createService(options: { comments?: any[]; deleteFails?: boolean } = {}) {
  const rows = options.comments || [];
  const order: string[] = [];

  const CommentModel: any = {
    findById: jest.fn(async (id: any) => rows.find((r) => r._id.toString() === id.toString()) || null),
    find: jest.fn((filter: any) => ({
      select: () => ({
        lean: async () => rows.filter((row) => row.imageId
          && filter._id.$in.some((id: any) => id.toString() === row._id.toString()))
      }),
      distinct: async () => rows
        .filter((row) => row.objectType === 'comment')
        .map((row) => row._id)
    })),
    deleteMany: jest.fn(async () => {
      order.push('delete-comments');
      return { deletedCount: rows.length };
    })
  };

  const fileServerService = {
    findByIds: jest.fn().mockResolvedValue([]),
    addRefToMultipleFiles: jest.fn().mockResolvedValue(undefined),
    deleteManyByIds: jest.fn(async (ids: string[]) => {
      order.push('delete-files');
      if (options.deleteFails) throw new Error('file server down');
      return { deleted: ids.length, errors: [] };
    })
  };

  const reactionService = {
    deleteReactionsByTargets: jest.fn(async () => {
      order.push('delete-reactions');
      return 0;
    })
  };
  const queueMessageService = { publish: jest.fn().mockResolvedValue(undefined) };

  const service = new CommentService(
    CommentModel,
    queueMessageService as any,
    { findByIds: jest.fn().mockResolvedValue([]) } as any,
    reactionService as any,
    fileServerService as any
  );

  return {
    service, CommentModel, fileServerService, queueMessageService, order
  };
}

const author = {
  _id: new ObjectId(),
  isAdmin: false,
  toResponse() { return { _id: this._id }; }
} as any;

function comment(overrides: Record<string, any> = {}) {
  return {
    _id: new ObjectId(),
    createdBy: author._id,
    level: 0,
    objectType: 'post',
    objectId: new ObjectId(),
    content: 'hello',
    toObject() { return { ...this }; },
    ...overrides
  };
}

describe('deleting a comment that has an image', () => {
  it('removes the file through the shared lifecycle', async () => {
    const imageId = new ObjectId();
    const target = comment({ imageId });
    const { service, fileServerService } = createService({ comments: [target] });

    await service.deleteUserComment(target._id, author);

    // The shared path tombstones the record, removes the derivatives and the
    // physical file, and is safe to repeat — none of which a private unlink
    // would do.
    expect(fileServerService.deleteManyByIds)
      .toHaveBeenCalledWith([imageId.toString()]);
  });

  it('removes the comment before the file', async () => {
    const target = comment({ imageId: new ObjectId() });
    const { service, order } = createService({ comments: [target] });

    await service.deleteUserComment(target._id, author);

    // A file removed first would leave a live comment pointing at nothing.
    expect(order.indexOf('delete-comments')).toBeLessThan(order.indexOf('delete-files'));
  });

  it('reports the deletion even when the file server fails', async () => {
    // The comment is already gone, so the image is unreferenced — the state the
    // sweeper collects. Failing here would tell the caller the comment survived.
    const target = comment({ imageId: new ObjectId() });
    const { service } = createService({ comments: [target], deleteFails: true });

    await expect(service.deleteUserComment(target._id, author))
      .resolves.toEqual({ deleted: true });
  });

  it('publishes a delete event with no image url', async () => {
    // The file has been withdrawn; handing every viewer its address would point
    // them at something that no longer exists.
    const target = comment({ imageId: new ObjectId() });
    const { service, queueMessageService } = createService({ comments: [target] });

    await service.deleteUserComment(target._id, author);

    const [, event] = queueMessageService.publish.mock.calls[0];
    expect(event.data.image).toBeUndefined();
    expect(JSON.stringify(event.data)).not.toContain('http');
  });

  it('touches no file for a comment that never had one', async () => {
    const target = comment();
    const { service, fileServerService } = createService({ comments: [target] });

    await service.deleteUserComment(target._id, author);

    expect(fileServerService.deleteManyByIds).not.toHaveBeenCalled();
  });

  it('collects the images of the replies it deletes with the thread', async () => {
    const rootImage = new ObjectId();
    const replyImage = new ObjectId();
    const root = comment({ imageId: rootImage });
    const reply = comment({
      imageId: replyImage, level: 1, objectType: 'comment', objectId: root._id
    });
    const { service, fileServerService } = createService({ comments: [root, reply] });

    await service.deleteUserComment(root._id, author);

    const [ids] = fileServerService.deleteManyByIds.mock.calls[0];
    expect(ids.sort()).toEqual([rootImage.toString(), replyImage.toString()].sort());
  });
});
