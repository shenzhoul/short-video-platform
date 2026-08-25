import { ForbiddenException } from '@nestjs/common';
import { ObjectId } from 'mongodb';

import { ContentFileService } from './content.file.service';

/**
 * Discarding an image the author decided not to send.
 *
 * The interesting cases are all about a client that is out of date. A cleanup
 * request can arrive after the comment was created, after the file was already
 * removed, or twice — and none of those may take a picture out of a comment
 * somebody has already posted.
 */
function createService(files: any[] = []) {
  const fileServerService = {
    findByIds: jest.fn(async (ids: string[]) => files
      .filter((file) => ids.map(String).includes(file._id.toString()))),
    deleteManyByIds: jest.fn(async (ids: string[]) => ({ deleted: ids.length, errors: [] }))
  };
  const service = new ContentFileService(fileServerService as any);
  return { service, fileServerService };
}

const owner = { _id: new ObjectId(), isAdmin: false } as any;

function draft(overrides: Record<string, any> = {}) {
  return {
    _id: new ObjectId(),
    createdBy: owner._id,
    type: 'comment-photo',
    refItems: [],
    ...overrides
  };
}

describe('discarding a comment image draft', () => {
  it('deletes an owned, unattached image', async () => {
    const file = draft();
    const { service, fileServerService } = createService([file]);

    await expect(service.discardCommentImageDraft(file._id.toString(), owner))
      .resolves.toEqual({ fileId: file._id.toString(), deleted: true });
    expect(fileServerService.deleteManyByIds).toHaveBeenCalledWith([file._id.toString()]);
  });

  it('leaves an image that now belongs to a comment', async () => {
    // The race this exists for: the comment was created while the cleanup was
    // in flight. Deleting now would strip the picture from a posted comment.
    const file = draft({ refItems: [{ itemId: new ObjectId(), itemType: 'comment' }] });
    const { service, fileServerService } = createService([file]);

    await expect(service.discardCommentImageDraft(file._id.toString(), owner))
      .resolves.toEqual({ fileId: file._id.toString(), deleted: false });
    expect(fileServerService.deleteManyByIds).not.toHaveBeenCalled();
  });

  it('is idempotent when the file has already gone', async () => {
    const { service } = createService([]);
    const id = new ObjectId().toString();

    // Calling twice must not raise; the caller's intent is already satisfied.
    await expect(service.discardCommentImageDraft(id, owner))
      .resolves.toEqual({ fileId: id, deleted: false });
    await expect(service.discardCommentImageDraft(id, owner))
      .resolves.toEqual({ fileId: id, deleted: false });
  });

  it('refuses to delete somebody else\'s upload', async () => {
    const file = draft({ createdBy: new ObjectId() });
    const { service, fileServerService } = createService([file]);

    await expect(service.discardCommentImageDraft(file._id.toString(), owner))
      .rejects.toThrow(ForbiddenException);
    expect(fileServerService.deleteManyByIds).not.toHaveBeenCalled();
  });

  it('refuses to delete a file that is not a comment image', async () => {
    // Otherwise this endpoint would be a way to delete any owned file — an
    // avatar, a post video — by naming its id.
    const file = draft({ type: 'post-video' });
    const { service, fileServerService } = createService([file]);

    await expect(service.discardCommentImageDraft(file._id.toString(), owner))
      .rejects.toThrow(ForbiddenException);
    expect(fileServerService.deleteManyByIds).not.toHaveBeenCalled();
  });

  it('lets an admin discard one', async () => {
    const file = draft({ createdBy: new ObjectId() });
    const { service } = createService([file]);

    await expect(service.discardCommentImageDraft(
      file._id.toString(), { _id: new ObjectId(), isAdmin: true } as any
    )).resolves.toEqual({ fileId: file._id.toString(), deleted: true });
  });
});
