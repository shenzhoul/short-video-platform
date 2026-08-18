import { PostSearchService } from './post-search.service';

describe('PostSearchService creator pin ordering', () => {
  function createSubject() {
    const query = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockResolvedValue([])
    };
    const postModel = {
      find: jest.fn().mockReturnValue(query),
      countDocuments: jest.fn().mockResolvedValue(0)
    };
    return {
      service: new PostSearchService(postModel as any),
      query
    };
  }

  const creatorRequest = {
    userId: '66b8d12ea3cb73216db87111',
    offset: 0,
    limit: 12,
    sortBy: 'createdAt',
    sort: -1
  } as any;

  it('sorts the public creator profile and detail Videos list with pins first', async () => {
    const { service, query } = createSubject();

    await service.userSearchPosts({ ...creatorRequest });

    expect(query.sort).toHaveBeenCalledWith({
      isPinned: -1,
      pinnedAt: -1,
      createdAt: -1,
      _id: -1
    });
  });

  it('sorts creator management works with pins first', async () => {
    const { service, query } = createSubject();

    await service.search({ ...creatorRequest });

    expect(query.sort).toHaveBeenCalledWith({
      isPinned: -1,
      pinnedAt: -1,
      createdAt: -1,
      _id: -1
    });
  });

  it('does not promote profile pins in a general feed', async () => {
    const { service, query } = createSubject();

    await service.userSearchPosts({ ...creatorRequest, userId: undefined });

    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
  });
});
