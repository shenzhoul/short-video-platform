import { ForbiddenException } from '@nestjs/common';

import {
  INVALID_COMMENT_IMAGE_FORMAT,
  InvalidCommentImageException
} from 'src/common/exceptions/comment/invalid-comment-image.exception';
import { ObjectId } from 'mongodb';
import { EntityNotFoundException } from 'src/kernel';

import { CommentService } from './comment.service';

/**
 * The one image a comment may carry.
 *
 * Two properties matter more than the rest and everything here defends them:
 *
 * - an image is **referenced only after** the comment exists, so a failed insert
 *   can never leave a file that nothing points at and nothing will collect;
 * - the id in the request is **only a claim** — ownership, upload type and
 *   whether the file is still an unattached draft are all decided server-side.
 */
function createService(options: {
  files?: any[];
  createFails?: boolean;
  addRefFails?: boolean;
} = {}) {
  const order: string[] = [];
  const created: any[] = [];

  const CommentModel: any = {
    create: jest.fn(async (doc: any) => {
      order.push('create-comment');
      if (options.createFails) throw new Error('insert failed');
      const row = { ...doc, _id: new ObjectId(), toObject() { return this; } };
      created.push(row);
      return row;
    }),
    findById: jest.fn().mockResolvedValue(null),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 })
  };

  const fileServerService = {
    findByIds: jest.fn(async (ids: string[]) => (options.files || [])
      .filter((file) => ids.map(String).includes(file._id.toString()))),
    addRefToMultipleFiles: jest.fn(async () => {
      order.push('reference-file');
      if (options.addRefFails) throw new Error('file server down');
    }),
    deleteManyByIds: jest.fn().mockResolvedValue({ deleted: 1, errors: [] })
  };

  const baseUserService = { findByIds: jest.fn().mockResolvedValue([]) };
  const queueMessageService = { publish: jest.fn().mockResolvedValue(undefined) };

  const service = new CommentService(
    CommentModel,
    queueMessageService as any,
    baseUserService as any,
    {} as any,
    fileServerService as any
  );

  return {
    service,
    CommentModel,
    fileServerService,
    queueMessageService,
    order,
    created,
    files: options.files || []
  };
}

// Shaped like the DTO the service actually receives: `setUser` calls
// `toResponse()` on whatever it is handed.
const owner = {
  _id: new ObjectId(),
  isAdmin: false,
  toResponse() { return { _id: this._id, username: 'owner' }; }
} as any;

/** A file the way the file server reports one. */
function imageFile(overrides: Record<string, any> = {}) {
  return {
    _id: new ObjectId(),
    createdBy: owner._id,
    type: 'comment-photo',
    url: 'https://files.example/comment/a.webp',
    width: 800,
    height: 600,
    mimeType: 'image/webp',
    refItems: [],
    ...overrides
  };
}

const payload = (overrides: Record<string, any> = {}) => ({
  content: 'hello',
  objectType: 'post',
  objectId: new ObjectId().toString(),
  ...overrides
}) as any;

describe('a comment with an image', () => {
  it('stores the reference and returns the metadata', async () => {
    const file = imageFile();
    const { service, created } = createService({ files: [file] });

    const dto = await service.createUserComment(
      payload({ imageId: file._id.toString() }), owner
    );

    expect(created[0].imageId).toBe(file._id.toString());
    expect(dto.image).toEqual({
      id: file._id.toString(),
      url: file.url,
      width: 800,
      height: 600,
      mimeType: 'image/webp'
    });
  });

  it('returns no storage path to the client', async () => {
    const file = imageFile({ filePath: 'D:/uploads/comment/a.webp', absolutePath: '/srv/x' });
    const { service } = createService({ files: [file] });

    const dto = await service.createUserComment(
      payload({ imageId: file._id.toString() }), owner
    );

    const serialised = JSON.stringify(dto.image);
    expect(serialised).not.toContain('uploads');
    expect(serialised).not.toContain('srv');
    expect(Object.keys(dto.image!).sort())
      .toEqual(['height', 'id', 'mimeType', 'url', 'width']);
  });

  it('references the file only after the comment exists', async () => {
    // The order is the whole safety argument: a file referenced before the
    // comment was stored would survive a failed insert with nothing pointing at
    // it, and the sweeper only collects *unreferenced* files.
    const file = imageFile();
    const { service, order } = createService({ files: [file] });

    await service.createUserComment(payload({ imageId: file._id.toString() }), owner);

    expect(order).toEqual(['create-comment', 'reference-file']);
  });

  it('leaves the file unreferenced when the comment cannot be stored', async () => {
    const file = imageFile();
    const { service, fileServerService } = createService({
      files: [file], createFails: true
    });

    await expect(service.createUserComment(
      payload({ imageId: file._id.toString() }), owner
    )).rejects.toThrow('insert failed');

    // Unreferenced is the state the sweeper collects, so nothing is orphaned.
    expect(fileServerService.addRefToMultipleFiles).not.toHaveBeenCalled();
  });

  describe('when referencing the file fails', () => {
    // Failure injected exactly in the window the spec names: after the comment
    // row exists, before the file knows it is in use.
    const failing = () => createService({ files: [imageFile()], addRefFails: true });

    it('fails the request rather than reporting a half-made comment', async () => {
      // Reporting success would publish a comment naming an image the file
      // server does not know is in use — which the sweeper then reclaims,
      // leaving the comment pointing at nothing.
      const { service, files } = failing();

      await expect(service.createUserComment(
        payload({ imageId: files[0]._id.toString() }), owner
      )).rejects.toThrow('file server down');
    });

    it('rolls the comment back', async () => {
      const { service, CommentModel, files } = failing();

      await service.createUserComment(
        payload({ imageId: files[0]._id.toString() }), owner
      ).catch(() => null);

      expect(CommentModel.deleteOne).toHaveBeenCalled();
    });

    it('publishes no realtime event', async () => {
      // A viewer must never be shown a comment the server could not finish.
      const { service, queueMessageService, files } = failing();

      await service.createUserComment(
        payload({ imageId: files[0]._id.toString() }), owner
      ).catch(() => null);

      expect(queueMessageService.publish).not.toHaveBeenCalled();
    });

    it('reports the original failure even when the rollback also fails', async () => {
      const { service, CommentModel, files } = failing();
      CommentModel.deleteOne = jest.fn().mockRejectedValue(new Error('rollback failed'));

      await expect(service.createUserComment(
        payload({ imageId: files[0]._id.toString() }), owner
      )).rejects.toThrow('file server down');
    });
  });

  describe('refuses an image it should not accept', () => {
    it('rejects one uploaded by somebody else', async () => {
      const file = imageFile({ createdBy: new ObjectId() });
      const { service, CommentModel } = createService({ files: [file] });

      await expect(service.createUserComment(
        payload({ imageId: file._id.toString() }), owner
      )).rejects.toThrow(ForbiddenException);
      expect(CommentModel.create).not.toHaveBeenCalled();
    });

    it('rejects a file that was not uploaded as a comment image', async () => {
      // Checked against the durable upload type, not request metadata that
      // image processing may normalise away. This is what stops an avatar or a
      // post video being passed off as a comment image.
      const file = imageFile({ type: 'post-video' });
      const { service, CommentModel } = createService({ files: [file] });

      await expect(service.createUserComment(
        payload({ imageId: file._id.toString() }), owner
      )).rejects.toThrow(ForbiddenException);
      expect(CommentModel.create).not.toHaveBeenCalled();
    });

    it('rejects one already attached to another comment', async () => {
      const file = imageFile({ refItems: [{ itemId: new ObjectId(), itemType: 'comment' }] });
      const { service, CommentModel } = createService({ files: [file] });

      await expect(service.createUserComment(
        payload({ imageId: file._id.toString() }), owner
      )).rejects.toThrow(ForbiddenException);
      expect(CommentModel.create).not.toHaveBeenCalled();
    });

    it('rejects a file whose processing failed', async () => {
      // The file server decodes every upload and marks what it cannot read as
      // failed. Attaching one anyway would create a comment pointing at an
      // image that was never produced — a broken box for every reader.
      const file = imageFile({ status: 'error', width: 0, height: 0 });
      const { service, CommentModel } = createService({ files: [file] });

      // Its own exception rather than a bare Forbidden: the client shows a
      // format message for this and keeps whatever image was already attached,
      // which it can only do if it can tell this apart from "not yours".
      await expect(service.createUserComment(
        payload({ imageId: file._id.toString() }), owner
      )).rejects.toThrow(InvalidCommentImageException);
      expect(CommentModel.create).not.toHaveBeenCalled();
    });

    it('rejects a file that reported a processing error', async () => {
      const file = imageFile({ processingError: { message: 'pngload: libspng read error' } });
      const { service, CommentModel } = createService({ files: [file] });

      await expect(service.createUserComment(
        payload({ imageId: file._id.toString() }), owner
      )).rejects.toThrow(InvalidCommentImageException);
      expect(CommentModel.create).not.toHaveBeenCalled();
    });

    it('rejects a file that has not finished processing', async () => {
      // No dimensions yet, so a comment created now would reserve no space and
      // shift the whole thread the moment the picture finally loaded.
      const file = imageFile({ processingStatus: 'processing', width: 0, height: 0 });
      const { service, CommentModel } = createService({ files: [file] });

      await expect(service.createUserComment(
        payload({ imageId: file._id.toString() }), owner
      )).rejects.toThrow(InvalidCommentImageException);
      expect(CommentModel.create).not.toHaveBeenCalled();
    });

    it('carries a stable code the client can match on', async () => {
      const file = imageFile({ status: 'error' });
      const { service } = createService({ files: [file] });

      // The message may be reworded or translated; the code is the contract.
      await expect(service.createUserComment(
        payload({ imageId: file._id.toString() }), owner
      )).rejects.toMatchObject({
        response: { error: INVALID_COMMENT_IMAGE_FORMAT }
      });
    });

    it('rejects an id that resolves to nothing', async () => {
      const { service, CommentModel } = createService({ files: [] });

      await expect(service.createUserComment(
        payload({ imageId: new ObjectId().toString() }), owner
      )).rejects.toThrow(EntityNotFoundException);
      expect(CommentModel.create).not.toHaveBeenCalled();
    });

    it('checks the image before writing anything at all', async () => {
      const file = imageFile({ createdBy: new ObjectId() });
      const { service, CommentModel, fileServerService } = createService({ files: [file] });

      await service.createUserComment(
        payload({ imageId: file._id.toString() }), owner
      ).catch(() => null);

      expect(CommentModel.create).not.toHaveBeenCalled();
      expect(fileServerService.addRefToMultipleFiles).not.toHaveBeenCalled();
    });
  });

  it('leaves a text-only comment alone', async () => {
    const { service, created, fileServerService } = createService();

    const dto = await service.createUserComment(payload(), owner);

    // Absent, not null: the field must not be written on the overwhelming
    // majority of comments that have no image.
    expect(Object.prototype.hasOwnProperty.call(created[0], 'imageId')).toBe(false);
    expect(dto.image).toBeUndefined();
    expect(fileServerService.addRefToMultipleFiles).not.toHaveBeenCalled();
  });

  it('never persists the validation marker', async () => {
    const { service, created } = createService();

    await service.createUserComment(payload({ hasContent: 'x' }), owner);

    expect(Object.prototype.hasOwnProperty.call(created[0], 'hasContent')).toBe(false);
  });
});
