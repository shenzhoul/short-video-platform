/**
 * Paging the "I like it" collection.
 *
 * The reported failure: the account menu said 67 and the profile tab showed one
 * page and then printed its terminal message. The API was never at fault —
 * `/posts/liked` answers `20 + 20 + 20 + 7 = 67` distinct posts against a real
 * database — so everything under test here is the client half of that contract:
 * the hook must page, must keep what it already has, must not repeat a post, and
 * must not claim the end before the server says so.
 *
 * The re-enable case has its own tests because that is where the cursor could
 * silently rewind: the hook loads on becoming enabled, and the profile page
 * disables it every time the viewer switches to another tab.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

import type { IPost } from '@interfaces/post';

const likedPosts = jest.fn();
const unlikePosts = jest.fn();
jest.mock('@services/post.service', () => ({
  likedPosts: (...args: unknown[]) => likedPosts(...args),
  unlikePosts: (...args: unknown[]) => unlikePosts(...args)
}));
jest.mock('@douyin-clone/shared-toast', () => ({
  toast: {
    error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn()
  }
}));

// eslint-disable-next-line import/first
import { useLikedPosts } from './use-liked-posts';

const TOTAL = 67;
const PAGE = 20;

const make = (index: number): IPost => ({
  _id: `post-${index}`,
  type: 'video',
  isLiked: true,
  totalLike: 1,
  createdAt: '2026-06-01T00:00:00.000Z',
  user: { _id: 'creator-a', username: 'creator-a' }
} as unknown as IPost);

/** The whole liked catalogue, in reaction order. */
const CATALOGUE = Array.from({ length: TOTAL }, (_, index) => make(index));

/**
 * A stand-in for `/posts/liked` that behaves like the real endpoint: it honours
 * the cursor, reports the reaction total on every page, and stops only when it
 * has genuinely run out.
 */
function serveCatalogue(catalogue: IPost[] = CATALOGUE, limit = PAGE) {
  likedPosts.mockImplementation(async (query: { limit: number; cursor?: string }) => {
    const start = query.cursor ? catalogue.findIndex((post) => post._id === query.cursor) + 1 : 0;
    const size = query.limit || limit;
    const slice = catalogue.slice(start, start + size);
    const last = slice[slice.length - 1];
    const hasMore = start + size < catalogue.length;
    return {
      data: {
        data: slice,
        total: catalogue.length,
        hasMore,
        nextCursor: hasMore && last ? { id: last._id, createdAt: 1787083651679 } : null
      }
    };
  });
}

describe('useLikedPosts pagination', () => {
  beforeEach(() => {
    likedPosts.mockReset();
    unlikePosts.mockReset();
  });

  it('requests the shared post page size, not a hook-local one', async () => {
    serveCatalogue();
    renderHook(() => useLikedPosts({ enabled: true }));

    await waitFor(() => expect(likedPosts).toHaveBeenCalled());
    expect(likedPosts.mock.calls[0][0]).toMatchObject({ limit: PAGE });
  });

  it('loads 67 liked posts as 20 + 20 + 20 + 7 without duplicates or gaps', async () => {
    serveCatalogue();
    const { result } = renderHook(() => useLikedPosts({ enabled: true }));

    await waitFor(() => expect(result.current.posts).toHaveLength(20));
    expect(result.current.total).toBe(TOTAL);
    expect(result.current.hasMore).toBe(true);

    const sizes = [20];
    // Page to exhaustion the way the sentinel does, and record each step.
    for (let guard = 0; guard < 10 && result.current.hasMore; guard += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { result.current.loadMore(); });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(result.current.loading).toBe(false));
      sizes.push(result.current.posts.length);
    }

    // 20 -> 40 -> 60 -> 67: the final page is a partial one and must still land.
    expect(sizes).toEqual([20, 40, 60, TOTAL]);
    expect(result.current.hasMore).toBe(false);

    const ids = result.current.posts.map((post) => post._id);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(ids).toEqual(CATALOGUE.map((post) => post._id));
  });

  it('keeps the pages it already has while the next one is in flight', async () => {
    serveCatalogue();
    const { result } = renderHook(() => useLikedPosts({ enabled: true }));
    await waitFor(() => expect(result.current.posts).toHaveLength(20));

    let release!: () => void;
    likedPosts.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({
        data: {
          data: CATALOGUE.slice(20, 40), total: TOTAL, hasMore: true, nextCursor: { id: 'post-39', createdAt: 1 }
        }
      });
    }));

    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.loading).toBe(true));
    // The already-loaded page is still on screen during the fetch.
    expect(result.current.posts).toHaveLength(20);

    await act(async () => { release(); });
    await waitFor(() => expect(result.current.posts).toHaveLength(40));
  });

  it('does not fire a second request while one is already in flight', async () => {
    serveCatalogue();
    const { result } = renderHook(() => useLikedPosts({ enabled: true }));
    await waitFor(() => expect(result.current.posts).toHaveLength(20));
    likedPosts.mockClear();

    // A sentinel can intersect repeatedly before the response lands.
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.posts).toHaveLength(40));

    expect(likedPosts).toHaveBeenCalledTimes(1);
  });

  it('stops asking once the server reports the last page', async () => {
    serveCatalogue();
    const { result } = renderHook(() => useLikedPosts({ enabled: true }));
    await waitFor(() => expect(result.current.posts).toHaveLength(20));

    for (let guard = 0; guard < 10 && result.current.hasMore; guard += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { result.current.loadMore(); });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(result.current.loading).toBe(false));
    }
    likedPosts.mockClear();

    act(() => { result.current.loadMore(); });
    expect(likedPosts).not.toHaveBeenCalled();
  });

  it('serves a short final page rather than treating it as the end', async () => {
    // 27 liked posts: one full page and a 7-item remainder.
    serveCatalogue(CATALOGUE.slice(0, 27));
    const { result } = renderHook(() => useLikedPosts({ enabled: true }));
    await waitFor(() => expect(result.current.posts).toHaveLength(20));
    expect(result.current.hasMore).toBe(true);

    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.posts).toHaveLength(27));
    expect(result.current.hasMore).toBe(false);
  });

  it('keeps its loaded pages and its cursor across a tab switch', async () => {
    serveCatalogue();
    const { result, rerender } = renderHook(
      ({ enabled }) => useLikedPosts({ enabled }),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(result.current.posts).toHaveLength(20));
    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.posts).toHaveLength(40));
    likedPosts.mockClear();

    // Leave the tab and come back.
    rerender({ enabled: false });
    rerender({ enabled: true });
    await act(async () => { await Promise.resolve(); });

    // Nothing is re-requested: re-fetching page one would rewind the cursor to
    // item 20 and make the next three scrolls re-fetch what is already here.
    expect(likedPosts).not.toHaveBeenCalled();
    expect(result.current.posts).toHaveLength(40);

    // And paging continues from where it left off rather than from the start.
    await act(async () => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.posts).toHaveLength(60));
    expect(likedPosts.mock.calls[0][0]).toMatchObject({ cursor: 'post-39' });
  });

  it('reports the count the server gives rather than what it has loaded', async () => {
    serveCatalogue();
    const { result } = renderHook(() => useLikedPosts({ enabled: true }));

    await waitFor(() => expect(result.current.posts).toHaveLength(20));
    // 67 in the account menu and 20 on screen is a paging state, not a mismatch.
    expect(result.current.total).toBe(TOTAL);
  });
});

/**
 * The account menu uses this same hook for its three most recent likes, with a
 * page of three, no toast, and `refresh()` on every opening. None of that may
 * change the profile tab above, whose tests run with the defaults.
 */
describe('useLikedPosts as the account menu preview', () => {
  const { toast } = jest.requireMock('@douyin-clone/shared-toast');

  beforeEach(() => {
    likedPosts.mockReset();
    unlikePosts.mockReset();
    toast.error.mockClear();
  });

  it('re-reads the first page on refresh and replaces what it holds, at the requested size', async () => {
    serveCatalogue(CATALOGUE, 3);
    const { result } = renderHook(() => useLikedPosts({ enabled: true, limit: 3, notifyOnError: false }));
    await waitFor(() => expect(result.current.posts).toHaveLength(3));
    expect(likedPosts.mock.calls[0][0]).toEqual({ limit: 3 });

    // Two of the most recent likes were removed somewhere else.
    serveCatalogue(CATALOGUE.slice(2), 3);
    await act(async () => { result.current.refresh(); });

    await waitFor(() => expect(result.current.posts.map((post) => post._id)).toEqual(['post-2', 'post-3', 'post-4']));
    expect(result.current.total).toBe(TOTAL - 2);
    expect(likedPosts).toHaveBeenCalledTimes(2);
    expect(likedPosts.mock.calls[1][0]).toEqual({ limit: 3 });
  });

  it('does not send a second request when a refresh lands on top of the first load', async () => {
    serveCatalogue(CATALOGUE, 3);
    const { result } = renderHook(() => useLikedPosts({ enabled: true, limit: 3 }));

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(likedPosts).toHaveBeenCalledTimes(1);
  });

  it('reports a failure through `error` without a toast when asked to', async () => {
    likedPosts.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useLikedPosts({ enabled: true, limit: 3, notifyOnError: false }));

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
    expect(result.current.error).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('still raises the toast on the profile tab, which keeps the default', async () => {
    likedPosts.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useLikedPosts({ enabled: true }));

    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
    expect(toast.error).toHaveBeenCalledWith('Failed to load liked posts');
  });
});
