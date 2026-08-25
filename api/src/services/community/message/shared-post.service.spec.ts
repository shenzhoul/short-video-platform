import { ObjectId } from 'mongodb';
import { STATUS } from 'src/kernel/constants';

import { SharedPostService } from './shared-post.service';

/**
 * A shared post is resolved per reader, every time it is read.
 *
 * These tests pin the two properties that make that worth the cost: a withdrawn
 * post stops rendering everywhere, and the card never carries content the reader
 * is not allowed to have — including in the unavailable case, where it would be
 * easy to leave the caption behind.
 */
const NO_FLAGS = {
  blockedByMe: false, blockedMe: false, restrictedByMe: false, restrictedMe: false
};

function createService(overrides: Record<string, any> = {}) {
  const postService = {
    findByIds: jest.fn().mockResolvedValue([]),
    ...overrides.postService
  };
  const baseUserService = {
    findByIds: jest.fn().mockResolvedValue([]),
    ...overrides.baseUserService
  };
  const relationshipService = {
    getStateMap: jest.fn().mockResolvedValue(new Map()),
    ...overrides.relationshipService
  };

  return {
    service: new SharedPostService(
      postService as any,
      baseUserService as any,
      relationshipService as any
    ),
    postService,
    relationshipService
  };
}

function buildPost(overrides: Record<string, any> = {}) {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    type: 'video',
    text: 'a caption',
    status: STATUS.ACTIVE,
    // Real posts carry their covers on the document; `files` is not resolved by
    // the plain post read this service uses.
    cover3x4Url: 'https://cdn.test/cover-3x4.jpg',
    cover4x3Url: 'https://cdn.test/cover-4x3.jpg',
    fileIds: ['file-1'],
    files: [],
    ...overrides
  } as any;
}

describe('SharedPostService', () => {
  const viewer = new ObjectId();

  it('builds a card for a post the reader may see', async () => {
    const post = buildPost();
    const { service } = createService({ postService: { findByIds: jest.fn().mockResolvedValue([post]) } });

    const card = await service.resolveOne(post._id, viewer);

    expect(card).toMatchObject({
      postId: post._id.toString(),
      available: true,
      type: 'video',
      isVideo: true,
      caption: 'a caption',
      // Portrait cover first: the card in a conversation is portrait.
      thumbnailUrl: 'https://cdn.test/cover-3x4.jpg'
    });
  });

  it('marks a deleted post unavailable and keeps nothing of it', async () => {
    const post = buildPost({ status: 'inactive' });
    const { service } = createService({ postService: { findByIds: jest.fn().mockResolvedValue([post]) } });

    const card = await service.resolveOne(post._id, viewer);

    expect(card.available).toBe(false);
    expect(card.unavailableReason).toBe('deleted');
    // The card must not still be carrying what the post used to show.
    expect(card.caption).toBeUndefined();
    expect(card.thumbnailUrl).toBeUndefined();
    expect(card.author).toBeUndefined();
  });

  it('treats a post whose author was removed as unavailable', async () => {
    const post = buildPost({ isCreatorDeleted: true });
    const { service } = createService({ postService: { findByIds: jest.fn().mockResolvedValue([post]) } });

    await expect(service.resolveOne(post._id, viewer))
      .resolves.toMatchObject({ available: false, unavailableReason: 'deleted' });
  });

  it('hides a post from a reader the author blocked', async () => {
    const post = buildPost();
    const { service } = createService({
      postService: { findByIds: jest.fn().mockResolvedValue([post]) },
      relationshipService: {
        getStateMap: jest.fn().mockResolvedValue(
          new Map([[post.userId.toString(), { ...NO_FLAGS, blockedMe: true }]])
        )
      }
    });

    await expect(service.resolveOne(post._id, viewer))
      .resolves.toMatchObject({ available: false, unavailableReason: 'not_accessible' });
  });

  it('marks a multi-image post so the card can say so', async () => {
    const post = buildPost({
      type: 'photo',
      cover3x4Url: 'https://cdn.test/album.jpg',
      cover4x3Url: null,
      fileIds: ['a', 'b']
    });
    const { service } = createService({ postService: { findByIds: jest.fn().mockResolvedValue([post]) } });

    await expect(service.resolveOne(post._id, viewer))
      .resolves.toMatchObject({ isMultiImage: true, isVideo: false, thumbnailUrl: 'https://cdn.test/album.jpg' });
  });

  it('marks a single-image post as one image', async () => {
    const post = buildPost({ type: 'photo', fileIds: ['only-one'], cover4x3Url: null });
    const { service } = createService({ postService: { findByIds: jest.fn().mockResolvedValue([post]) } });

    await expect(service.resolveOne(post._id, viewer))
      .resolves.toMatchObject({ isMultiImage: false, isVideo: false });
  });

  it('falls back through the cover fields the feed uses', async () => {
    const post = buildPost({ cover3x4Url: null });
    const { service } = createService({ postService: { findByIds: jest.fn().mockResolvedValue([post]) } });

    await expect(service.resolveOne(post._id, viewer))
      .resolves.toMatchObject({ thumbnailUrl: 'https://cdn.test/cover-4x3.jpg' });
  });

  it('resolves a page of posts in one lookup', async () => {
    const posts = [buildPost(), buildPost(), buildPost()];
    const findByIds = jest.fn().mockResolvedValue(posts);
    const { service } = createService({ postService: { findByIds } });

    const cards = await service.resolveMany(posts.map(post => post._id), viewer);

    expect(findByIds).toHaveBeenCalledTimes(1);
    expect(cards.size).toBe(3);
  });

  it('falls back to unavailable rather than failing the whole thread', async () => {
    const postId = new ObjectId();
    const { service } = createService({
      postService: { findByIds: jest.fn().mockRejectedValue(new Error('post store down')) }
    });

    await expect(service.resolveOne(postId, viewer))
      .resolves.toMatchObject({ available: false });
  });

  describe('assertShareable', () => {
    it('refuses when the recipient cannot see the post, even though the sender can', async () => {
      const post = buildPost();
      const { service } = createService({
        postService: { findByIds: jest.fn().mockResolvedValue([post]) },
        relationshipService: {
          // The author blocked whoever is asking second — the recipient.
          getStateMap: jest.fn()
            .mockResolvedValueOnce(new Map([[post.userId.toString(), NO_FLAGS]]))
            .mockResolvedValueOnce(new Map([[post.userId.toString(), { ...NO_FLAGS, blockedMe: true }]]))
        }
      });

      await expect(service.assertShareable(post._id, viewer, new ObjectId()))
        .resolves.toMatchObject({ ok: false, reason: 'not_accessible' });
    });

    it('reports a deleted post as deleted, not as an access problem', async () => {
      const post = buildPost({ status: 'inactive' });
      const { service } = createService({
        postService: { findByIds: jest.fn().mockResolvedValue([post]) }
      });

      await expect(service.assertShareable(post._id, viewer, new ObjectId()))
        .resolves.toMatchObject({ ok: false, reason: 'deleted' });
    });

    it('returns the sender card when the pair may exchange the post', async () => {
      const post = buildPost();
      const { service } = createService({
        postService: { findByIds: jest.fn().mockResolvedValue([post]) }
      });

      const result = await service.assertShareable(post._id, viewer, new ObjectId());

      expect(result.ok).toBe(true);
      expect(result.ok && result.card.available).toBe(true);
    });
  });
});
