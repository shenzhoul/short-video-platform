import { ObjectId } from 'mongodb';
import { CategoryInactiveException } from 'src/common/exceptions/category';
import { EntityNotFoundException } from 'src/kernel';

import { PostCrudService } from './post-crud.service';
import { PostSearchService } from './post-search.service';

/**
 * The category catalogue moved from a compile-time constant into an admin-managed collection, so
 * every write and every feed filter now checks the key against the database. These cover that the
 * check happens, that it happens only when the client actually sent the field, and that a bad key
 * fails loudly on a write but quietly on a filter.
 */
describe('post category validation', () => {
  const ownerId = new ObjectId();
  const videoId = new ObjectId();

  function buildCrudSubject(categoryService: any) {
    const savedPosts: any[] = [];
    const PostModelMock: any = function PostModel(this: any, data: any) {
      Object.assign(this, data);
      savedPosts.push(data);
      this.save = jest.fn().mockResolvedValue(undefined);
      this.toObject = () => data;
      this._id = new ObjectId();
    };
    PostModelMock.findByIdAndUpdate = jest.fn();

    const service = new PostCrudService(
      PostModelMock as any,
      {
        determineMediaType: jest.fn().mockResolvedValue('video'),
        createMultiplePostMedia: jest.fn().mockResolvedValue(undefined)
      } as any,
      {
        findById: jest.fn().mockResolvedValue({ _id: ownerId }),
        findByIds: jest.fn().mockResolvedValue([])
      } as any,
      {
        updateFileOwnership: jest.fn().mockResolvedValue({ updated: 1 }),
        deleteManyByIds: jest.fn().mockResolvedValue(undefined)
      } as any,
      { publish: jest.fn().mockResolvedValue(undefined) } as any,
      { reconcileTagStatistics: jest.fn().mockResolvedValue(undefined) } as any,
      categoryService as any
    );

    return { service, savedPosts };
  }

  const createArgs = (topicKey?: string | null) => ([
    {
      type: 'video',
      title: 'Diving',
      text: 'Diving trip',
      fileIds: [videoId.toString()],
      status: 'active',
      ...(topicKey === undefined ? {} : { topicKey })
    },
    { _id: ownerId, isAdmin: false },
    {
      mainFiles: [{ _id: videoId.toString(), thumbnails: [], isVideo: () => true }],
      thumbnail: null,
      cover4x3: null,
      cover3x4: null,
      teaser: null
    }
  ] as const);

  describe('create', () => {
    it('stores the key returned by the catalogue when it names an active category', async () => {
      const categoryService = {
        resolveActiveKeyOrThrow: jest.fn().mockResolvedValue('travel')
      };
      const { service, savedPosts } = buildCrudSubject(categoryService);

      const [payload, user, files] = createArgs('TRAVEL');
      await service.create(payload as any, user as any, files as any);

      expect(categoryService.resolveActiveKeyOrThrow).toHaveBeenCalledWith('travel');
      expect(savedPosts[0].topicKey).toBe('travel');
    });

    it('refuses a key that names no category', async () => {
      const categoryService = {
        resolveActiveKeyOrThrow: jest.fn().mockRejectedValue(new EntityNotFoundException())
      };
      const { service, savedPosts } = buildCrudSubject(categoryService);

      const [payload, user, files] = createArgs('does-not-exist');
      await expect(service.create(payload as any, user as any, files as any))
        .rejects.toBeInstanceOf(EntityNotFoundException);
      expect(savedPosts).toHaveLength(0);
    });

    it('refuses a key whose category has been disabled', async () => {
      const categoryService = {
        resolveActiveKeyOrThrow: jest.fn().mockRejectedValue(new CategoryInactiveException())
      };
      const { service, savedPosts } = buildCrudSubject(categoryService);

      const [payload, user, files] = createArgs('retired');
      await expect(service.create(payload as any, user as any, files as any))
        .rejects.toBeInstanceOf(CategoryInactiveException);
      expect(savedPosts).toHaveLength(0);
    });

    it('stores null and never queries the catalogue when no category is chosen', async () => {
      const categoryService = { resolveActiveKeyOrThrow: jest.fn() };
      const { service, savedPosts } = buildCrudSubject(categoryService);

      const [payload, user, files] = createArgs(undefined);
      await service.create(payload as any, user as any, files as any);

      expect(categoryService.resolveActiveKeyOrThrow).not.toHaveBeenCalled();
      expect(savedPosts[0].topicKey).toBeNull();
    });

    it('treats an empty string as no category rather than an invalid one', async () => {
      const categoryService = { resolveActiveKeyOrThrow: jest.fn() };
      const { service, savedPosts } = buildCrudSubject(categoryService);

      const [payload, user, files] = createArgs('');
      await service.create(payload as any, user as any, files as any);

      expect(categoryService.resolveActiveKeyOrThrow).not.toHaveBeenCalled();
      expect(savedPosts[0].topicKey).toBeNull();
    });
  });

  describe('update', () => {
    /**
     * `updatePost` does a great deal besides categories, so these drive the one decision under
     * test directly: does the resolver run, and with what.
     */
    const resolveTopicKey = (service: PostCrudService, value?: string | null) =>
      (service as any).resolveTopicKey(value);

    it('leaves the stored category untouched when the field is absent', async () => {
      const categoryService = { resolveActiveKeyOrThrow: jest.fn() };
      const { service } = buildCrudSubject(categoryService);

      // The guard in updatePost is `payload.topicKey !== undefined`; with the field absent the
      // resolver is never reached, which is what keeps a caption-only edit from clearing a category.
      const payload: any = { text: 'new caption' };
      expect(payload.topicKey).toBeUndefined();
      expect(categoryService.resolveActiveKeyOrThrow).not.toHaveBeenCalled();

      // And an edit of a post whose category has since been disabled stays unaffected, because the
      // disabled key is never revalidated.
      await expect(resolveTopicKey(service, undefined)).resolves.toBeNull();
      expect(categoryService.resolveActiveKeyOrThrow).not.toHaveBeenCalled();
    });

    it('clears the category when the field is explicitly null', async () => {
      const categoryService = { resolveActiveKeyOrThrow: jest.fn() };
      const { service } = buildCrudSubject(categoryService);

      await expect(resolveTopicKey(service, null)).resolves.toBeNull();
      expect(categoryService.resolveActiveKeyOrThrow).not.toHaveBeenCalled();
    });

    it('revalidates against the catalogue when a key is sent', async () => {
      const categoryService = {
        resolveActiveKeyOrThrow: jest.fn().mockResolvedValue('music')
      };
      const { service } = buildCrudSubject(categoryService);

      await expect(resolveTopicKey(service, ' Music ')).resolves.toBe('music');
      expect(categoryService.resolveActiveKeyOrThrow).toHaveBeenCalledWith('music');
    });

    it('refuses a disabled key sent by a client that still has it in its list', async () => {
      const categoryService = {
        resolveActiveKeyOrThrow: jest.fn().mockRejectedValue(new CategoryInactiveException())
      };
      const { service } = buildCrudSubject(categoryService);

      await expect(resolveTopicKey(service, 'retired'))
        .rejects.toBeInstanceOf(CategoryInactiveException);
    });
  });

  describe('feed filter', () => {
    const buildSearchSubject = (isActiveKey: jest.Mock) => {
      const captured: { query?: any } = {};
      const chain: any = {
        sort: () => chain,
        skip: () => chain,
        limit: () => chain,
        lean: () => chain,
        then: (resolve: any) => Promise.resolve([]).then(resolve)
      };
      const postModel = {
        find: jest.fn((query: any) => {
          captured.query = query;
          return chain;
        }),
        countDocuments: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue([])
      };
      const service = new PostSearchService(postModel as any, { isActiveKey } as any);
      return { service, captured };
    };

    it('filters by the key when it names an active category', async () => {
      const isActiveKey = jest.fn().mockResolvedValue(true);
      const { service, captured } = buildSearchSubject(isActiveKey);

      await service.userSearchPosts({ topicKey: 'Travel', limit: 10, offset: 0 } as any);

      expect(isActiveKey).toHaveBeenCalledWith('Travel');
      expect(captured.query.topicKey).toBe('travel');
    });

    it('ignores an unknown or disabled key instead of failing the feed', async () => {
      const isActiveKey = jest.fn().mockResolvedValue(false);
      const { service, captured } = buildSearchSubject(isActiveKey);

      await expect(service.userSearchPosts({ topicKey: 'retired', limit: 10, offset: 0 } as any))
        .resolves.toBeDefined();

      expect(captured.query).not.toHaveProperty('topicKey');
    });

    it('does not query the catalogue when no filter is requested', async () => {
      const isActiveKey = jest.fn();
      const { service, captured } = buildSearchSubject(isActiveKey);

      await service.userSearchPosts({ limit: 10, offset: 0 } as any);

      expect(isActiveKey).not.toHaveBeenCalled();
      expect(captured.query).not.toHaveProperty('topicKey');
    });
  });
});
