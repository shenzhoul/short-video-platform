import { ForbiddenException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { POST_CHANNELS } from 'src/common/constants';
import { EVENT } from 'src/kernel/constants';

import { PostCrudService } from './post-crud.service';

describe('PostCrudService setPinned', () => {
  const postId = new ObjectId();
  const ownerId = new ObjectId();

  function createSubject() {
    const updatedPost = {
      _id: postId,
      userId: ownerId,
      isPinned: true,
      pinnedAt: new Date()
    };
    const postModel = {
      findByIdAndUpdate: jest.fn().mockResolvedValue({
        toObject: () => updatedPost
      })
    };
    const service = new PostCrudService(
      postModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    jest.spyOn(service, 'findById').mockResolvedValue({
      _id: postId,
      userId: ownerId,
      isPinned: false,
      pinnedAt: null
    } as any);
    return { service, postModel };
  }

  it('pins an owned post and records a fresh pin time', async () => {
    const { service, postModel } = createSubject();

    await expect(service.setPinned(postId, {
      _id: ownerId,
      isAdmin: false
    } as any, true)).resolves.toMatchObject({ isPinned: true });

    expect(postModel.findByIdAndUpdate).toHaveBeenCalledWith(
      postId,
      {
        $set: {
          isPinned: true,
          pinnedAt: expect.any(Date),
          updatedAt: expect.any(Date)
        }
      },
      { new: true }
    );
  });

  it('rejects a non-owner before updating pin state', async () => {
    const { service, postModel } = createSubject();

    await expect(service.setPinned(postId, {
      _id: new ObjectId(),
      isAdmin: false
    } as any, true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(postModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a non-owner admin because pinning is owner-only', async () => {
    const { service, postModel } = createSubject();

    await expect(service.setPinned(postId, {
      _id: new ObjectId(),
      isAdmin: true
    } as any, true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(postModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('does not change pinnedAt when the requested state is already applied', async () => {
    const { service, postModel } = createSubject();
    const pinnedAt = new Date('2026-08-12T00:00:00.000Z');
    jest.spyOn(service, 'findById').mockResolvedValue({
      _id: postId,
      userId: ownerId,
      isPinned: true,
      pinnedAt
    } as any);

    await expect(service.setPinned(postId, {
      _id: ownerId,
      isAdmin: false
    } as any, true)).resolves.toMatchObject({ isPinned: true, pinnedAt });
    expect(postModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('PostCrudService deletePost', () => {
  const postId = new ObjectId();
  const ownerId = new ObjectId();

  function createSubject() {
    const postModel = {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 })
    };
    const postMediaService = {
      deletePostMediaByPostId: jest.fn()
    };
    const fileServerService = {
      deleteManyByIds: jest.fn()
    };
    const queueMessageService = {
      publish: jest.fn().mockResolvedValue(undefined)
    };
    const service = new PostCrudService(
      postModel as any,
      postMediaService as any,
      {} as any,
      fileServerService as any,
      queueMessageService as any,
      {} as any
    );
    const post = {
      _id: postId,
      userId: ownerId,
      text: 'Post #test',
      fileIds: [new ObjectId()],
      status: 'active'
    };
    jest.spyOn(service, 'findById').mockResolvedValue(post as any);

    return {
      service,
      post,
      postModel,
      postMediaService,
      fileServerService,
      queueMessageService
    };
  }

  it('tombstones the post and publishes a versioned cleanup snapshot', async () => {
    const {
      service,
      post,
      postModel,
      postMediaService,
      fileServerService,
      queueMessageService
    } = createSubject();

    await expect(service.deletePost(postId, {
      _id: ownerId,
      isAdmin: false
    } as any)).resolves.toEqual({ success: true });

    expect(postModel.updateOne).toHaveBeenCalledWith(
      { _id: postId },
      {
        $set: {
          status: EVENT.DELETED,
          updatedAt: expect.any(Date)
        }
      }
    );
    expect(queueMessageService.publish).toHaveBeenCalledWith(
      POST_CHANNELS.CREATOR_POST,
      {
        eventName: EVENT.DELETED,
        data: {
          ...post,
          status: EVENT.DELETED,
          cleanupVersion: 1
        }
      }
    );
    expect(postMediaService.deletePostMediaByPostId).not.toHaveBeenCalled();
    expect(fileServerService.deleteManyByIds).not.toHaveBeenCalled();
  });

  it('rejects a non-owner before changing post state', async () => {
    const { service, postModel, queueMessageService } = createSubject();

    await expect(service.deletePost(postId, {
      _id: new ObjectId(),
      isAdmin: false
    } as any)).rejects.toBeInstanceOf(ForbiddenException);

    expect(postModel.updateOne).not.toHaveBeenCalled();
    expect(queueMessageService.publish).not.toHaveBeenCalled();
  });

  it('keeps the tombstone when publishing fails so the request can be retried', async () => {
    const { service, postModel, queueMessageService } = createSubject();
    queueMessageService.publish.mockRejectedValueOnce(new Error('Redis unavailable'));

    await expect(service.deletePost(postId, {
      _id: ownerId,
      isAdmin: false
    } as any)).rejects.toThrow('Redis unavailable');

    expect(postModel.updateOne).toHaveBeenCalled();
  });
});

describe('PostCrudService create video covers', () => {
  it('persists both generated cover URLs and defaults Home to 4:3', async () => {
    const savedPosts: any[] = [];
    class PostModelMock {
      _id = new ObjectId();
      fileIds: ObjectId[];
      teaserId?: ObjectId;
      thumbnailId?: ObjectId;
      cover4x3Id?: ObjectId;
      cover3x4Id?: ObjectId;

      constructor(data: any) {
        Object.assign(this, data);
      }

      async save() {
        savedPosts.push(this);
      }

      toObject() {
        return { ...this };
      }
    }

    const ownerId = new ObjectId();
    const videoId = new ObjectId();
    const thumbnails = [0, 1, 2].map(index => `https://cdn.test/cover-${index}.webp`);
    const postMediaService = {
      determineMediaType: jest.fn().mockResolvedValue('video'),
      createMultiplePostMedia: jest.fn().mockResolvedValue(undefined)
    };
    const fileServerService = {
      updateFileOwnership: jest.fn().mockResolvedValue(undefined)
    };
    const service = new PostCrudService(
      PostModelMock as any,
      postMediaService as any,
      { findById: jest.fn().mockResolvedValue({ _id: ownerId }) } as any,
      fileServerService as any,
      { publish: jest.fn().mockResolvedValue(undefined) } as any,
      { reconcileTagStatistics: jest.fn().mockResolvedValue(undefined) } as any
    );

    await service.create({
      type: 'video',
      title: 'Cover test',
      text: 'Cover test',
      fileIds: [videoId.toString()],
      status: 'active',
      coverThumbnailIndex: 1
    } as any, { _id: ownerId, isAdmin: false } as any, {
      mainFiles: [{
        _id: videoId.toString(),
        thumbnails,
        isVideo: () => true
      }] as any,
      thumbnail: null,
      cover4x3: null,
      cover3x4: null,
      teaser: null
    });

    expect(savedPosts[0]).toMatchObject({
      cover4x3Url: thumbnails[1],
      cover3x4Url: thumbnails[1],
      coverDisplayRatio: '4:3'
    });
    expect(savedPosts[0].coverThumbnailIndex).toBeUndefined();
    expect(fileServerService.updateFileOwnership).toHaveBeenCalledWith(expect.objectContaining({
      fileIds: [videoId.toString()]
    }));
  });
});
