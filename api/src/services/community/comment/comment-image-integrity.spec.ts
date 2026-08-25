import { ObjectId } from 'mongodb';

import { CommentImageIntegrityService } from './comment-image-integrity.service';

/**
 * The crash window nothing in a process can compensate for.
 *
 * A comment is written before its image is referenced. `CommentService` rolls
 * the comment back when that reference *fails*, but a process that dies between
 * the two writes leaves a published comment whose image looks abandoned — and
 * the unused-file sweeper deletes abandoned files.
 *
 * This is what repairs it, and the direction of the repair is the point: the
 * comment is published, so the reference is restored rather than the file
 * collected.
 */
function createService(options: { comments?: any[]; files?: any[]; addRefFails?: boolean } = {}) {
  const comments = options.comments || [];
  const updates: any[] = [];

  const CommentModel: any = {
    find: jest.fn(() => ({
      select: () => ({ lean: async () => comments })
    })),
    updateOne: jest.fn(async (filter: any, update: any) => {
      updates.push({ filter, update });
      return { modifiedCount: 1 };
    })
  };

  const fileServerService = {
    findByIds: jest.fn(async (ids: string[]) => (options.files || [])
      .filter((file) => ids.map(String).includes(file._id.toString()))),
    addRefToMultipleFiles: jest.fn(async () => {
      if (options.addRefFails) throw new Error('file server down');
    })
  };

  const service = new CommentImageIntegrityService(CommentModel, fileServerService as any);
  return {
    service, CommentModel, fileServerService, updates
  };
}

const commentId = new ObjectId();
const fileId = new ObjectId();

const comment = (overrides: Record<string, any> = {}) => ({
  _id: commentId, imageId: fileId, ...overrides
});
const file = (overrides: Record<string, any> = {}) => ({
  _id: fileId, type: 'comment-photo', refItems: [], ...overrides
});

describe('CommentImageIntegrityService', () => {
  it('restores a reference the crash window lost', async () => {
    const { service, fileServerService } = createService({
      comments: [comment()], files: [file({ refItems: [] })]
    });

    const report = await service.repairPublishedReferences(true);

    // The comment is published and names the image, so the file is claimed —
    // not collected.
    expect(fileServerService.addRefToMultipleFiles).toHaveBeenCalledWith(
      [fileId.toString()],
      { itemId: commentId, itemType: 'comment' }
    );
    expect(report.referencesRepaired).toBe(1);
  });

  it('leaves a healthy comment completely alone', async () => {
    const { service, fileServerService, CommentModel } = createService({
      comments: [comment()],
      files: [file({ refItems: [{ itemId: commentId, itemType: 'comment' }] })]
    });

    const report = await service.repairPublishedReferences(true);

    expect(report.healthy).toBe(1);
    expect(fileServerService.addRefToMultipleFiles).not.toHaveBeenCalled();
    expect(CommentModel.updateOne).not.toHaveBeenCalled();
  });

  it('is idempotent — a second pass finds nothing to do', async () => {
    // Modelled with the reference already present, which is the state the first
    // pass leaves behind.
    const { service } = createService({
      comments: [comment()],
      files: [file({ refItems: [{ itemId: commentId, itemType: 'comment' }] })]
    });

    const first = await service.repairPublishedReferences(true);
    const second = await service.repairPublishedReferences(true);

    expect(first.referencesRepaired).toBe(0);
    expect(second.referencesRepaired).toBe(0);
    expect(second.healthy).toBe(1);
  });

  it('repairs a reference pointing at a different comment', async () => {
    // A file referenced by some other row still leaves *this* comment exposed.
    const { service, fileServerService } = createService({
      comments: [comment()],
      files: [file({ refItems: [{ itemId: new ObjectId(), itemType: 'comment' }] })]
    });

    await service.repairPublishedReferences(true);

    expect(fileServerService.addRefToMultipleFiles).toHaveBeenCalled();
  });

  it('clears the reference when the file is genuinely gone', async () => {
    // The picture cannot be brought back; the comment and its text can stay.
    const { service, updates } = createService({ comments: [comment()], files: [] });

    const report = await service.repairPublishedReferences(true);

    expect(report.danglingImageIdsCleared).toBe(1);
    expect(updates[0].update).toEqual({ $unset: { imageId: '' } });
  });

  it('writes nothing when only reporting', async () => {
    const { service, fileServerService, CommentModel } = createService({
      comments: [comment(), { _id: new ObjectId(), imageId: new ObjectId() }],
      files: [file()]
    });

    const report = await service.repairPublishedReferences(false);

    expect(report.referencesRepaired).toBe(1);
    expect(report.danglingImageIdsCleared).toBe(1);
    expect(fileServerService.addRefToMultipleFiles).not.toHaveBeenCalled();
    expect(CommentModel.updateOne).not.toHaveBeenCalled();
  });

  it('keeps going when one repair fails', async () => {
    // One unreachable file must not stop the rest being protected.
    const { service } = createService({
      comments: [comment()], files: [file()], addRefFails: true
    });

    const report = await service.repairPublishedReferences(true);

    expect(report.failures).toBe(1);
    expect(report.referencesRepaired).toBe(0);
  });

  it('looks the files up in one batch', async () => {
    const comments = Array.from({ length: 25 }, () => ({
      _id: new ObjectId(), imageId: new ObjectId()
    }));
    const { service, fileServerService } = createService({ comments, files: [] });

    await service.repairPublishedReferences(false);

    // One query for the set. A lookup per comment would scale with every
    // picture ever posted, on a scheduled job.
    expect(fileServerService.findByIds).toHaveBeenCalledTimes(1);
    expect(fileServerService.findByIds.mock.calls[0][0]).toHaveLength(25);
  });

  it('does nothing at all when no comment carries an image', async () => {
    const { service, fileServerService } = createService({ comments: [] });

    const report = await service.repairPublishedReferences(true);

    expect(report.commentsExamined).toBe(0);
    expect(fileServerService.findByIds).not.toHaveBeenCalled();
  });
});
