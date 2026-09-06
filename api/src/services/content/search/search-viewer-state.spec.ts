// The service pulls in the payload barrel, which reaches `isomorphic-dompurify` — an ESM-only
// package Jest cannot transform. Nothing here exercises sanitisation of HTML, so it is stubbed.
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));

// eslint-disable-next-line import/first
import { SearchService } from './search.service';

/**
 * Search must answer as the viewer who asked.
 *
 * `isLiked` is viewer-specific and only set when `ContentService.populatePostData`
 * receives a user (`setIsLiked`). `totalLike` is an aggregate on the document
 * and is correct either way — so a search path that forgets the viewer produces
 * a post with the right total and a **white heart**, which looks like data
 * rather than a bug.
 *
 * That shipped: `searchAll` (the Summary tab, and the default when no `type` is
 * given) called `searchPosts(...)` without its `user` argument, while the
 * `type=post` branch passed it. Opening an already-liked post from Summary
 * search showed a white heart; the same post opened from the creator grid
 * showed it red.
 */

function buildService() {
  const contentService = { userSearchPosts: jest.fn().mockResolvedValue({ data: [], total: 0 }) };
  const userSearchService = { publicSearch: jest.fn().mockResolvedValue({ data: [], total: 0 }) };
  const chain: any = {
    sort: () => chain, skip: () => chain, limit: () => chain, select: () => chain, lean: async () => []
  };
  const postModel = { find: jest.fn(() => chain) };
  const tagModel = {
    find: jest.fn(() => chain),
    aggregate: jest.fn().mockResolvedValue([]),
    countDocuments: jest.fn().mockResolvedValue(0)
  };

  // Constructor order: (TagSummaryModel, PostModel, contentService, userSearchService).
  const service = new SearchService(
    tagModel as any,
    postModel as any,
    contentService as any,
    userSearchService as any
  );
  return { service, contentService };
}

const viewer = { _id: 'viewer-1' } as any;

describe('SearchService viewer state', () => {
  it('passes the viewer through the Summary tab, so liked posts come back liked', async () => {
    const { service, contentService } = buildService();

    // No `type` — the Summary tab, which is what the search page opens on.
    await service.search({ q: 'coffee', limit: 10, offset: 0 } as any, viewer);

    expect(contentService.userSearchPosts).toHaveBeenCalledTimes(1);
    const [, passedUser] = contentService.userSearchPosts.mock.calls[0];
    expect(passedUser).toBe(viewer);
  });

  it('passes the viewer through the Videos tab too', async () => {
    const { service, contentService } = buildService();

    await service.search({ q: 'coffee', type: 'post', limit: 10, offset: 0 } as any, viewer);

    const [, passedUser] = contentService.userSearchPosts.mock.calls[0];
    expect(passedUser).toBe(viewer);
  });

  it('still answers for a signed-out visitor', async () => {
    const { service, contentService } = buildService();

    await service.search({ q: 'coffee', limit: 10, offset: 0 } as any, undefined);

    expect(contentService.userSearchPosts).toHaveBeenCalledTimes(1);
    const [, passedUser] = contentService.userSearchPosts.mock.calls[0];
    expect(passedUser).toBeUndefined();
  });
});
