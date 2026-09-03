/**
 * The creator profile listing hook.
 *
 * `useCreatorPostSearch` paginated through `myPosts` — the *authenticated
 * caller's own* listing, which takes no creator id — while being used to render
 * any creator's profile grid. The server-rendered first page was correct, so the
 * two only diverged once the grid paged.
 *
 * Measured before the fix: the profile page never actually calls `loadMore`
 * (it prints "No more for now" under a list that cannot grow), so the wrong
 * request was latent rather than live. That does not make it safe — it makes it
 * one line of wiring away, and the wiring is exactly what the grid needed. These
 * tests pin the contract so the two cannot be reconnected wrongly.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

import type { IPost } from '@interfaces/post';

const getCreatorPosts = jest.fn();
const myPosts = jest.fn();
jest.mock('@services/post.service', () => ({
  getCreatorPosts: (...args: unknown[]) => getCreatorPosts(...args),
  myPosts: (...args: unknown[]) => myPosts(...args),
  deletePost: jest.fn(),
  pinPost: jest.fn(),
  unpinPost: jest.fn()
}));
jest.mock('@douyin-clone/shared-toast', () => ({
  toast: {
    error: jest.fn(), success: jest.fn(), warning: jest.fn()
  }
}));

// eslint-disable-next-line import/first
import { useCreatorPostSearch } from './use-creator-post-search';

const B = 'creator-b';
const C = 'creator-c';

const make = (id: string, userId: string, over: Partial<IPost> = {}): IPost => ({
  _id: id,
  type: 'video',
  isPinned: false,
  pinnedAt: null,
  createdAt: `2026-06-${String((Number(id.replace(/\D/g, '')) % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
  user: { _id: userId, username: userId },
  ...over
} as unknown as IPost);

const page = (posts: IPost[], hasMore: boolean, cursor: unknown = null) => ({
  data: {
    data: posts, total: posts.length, hasMore, nextCursor: cursor
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

type Props = Parameters<typeof useCreatorPostSearch>[0];
const render = (initialProps: Props) => renderHook(
  (props: Props) => useCreatorPostSearch(props),
  { initialProps }
);

describe('useCreatorPostSearch — profile listing', () => {
  beforeEach(() => {
    getCreatorPosts.mockReset();
    myPosts.mockReset();
  });

  it('pages a profile through the creator route, never the caller\'s own listing', async () => {
    const first = [make('b1', B), make('b2', B)];
    getCreatorPosts.mockResolvedValue(page([make('b3', B)], false));

    const { result } = render({
      creatorId: B,
      initialPosts: first,
      initialTotal: 3,
      initialHasMore: true,
      initialNextCursor: { id: 'b2', createdAt: 1780000000000, isPinned: false } as never
    });

    act(() => result.current.loadMore());
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalled());

    expect(myPosts).not.toHaveBeenCalled();
    expect(getCreatorPosts.mock.calls[0][0]).toBe(B);
    await waitFor(() => expect(result.current.posts.map((p) => p._id)).toEqual(['b1', 'b2', 'b3']));
  });

  it('carries the pinned-aware cursor, so page two does not repeat the pinned block', async () => {
    getCreatorPosts.mockResolvedValue(page([make('b3', B)], false));

    const { result } = render({
      creatorId: B,
      initialPosts: [make('b1', B, { isPinned: true, pinnedAt: '2026-01-01T00:00:00.000Z' } as Partial<IPost>)],
      initialTotal: 2,
      initialHasMore: true,
      initialNextCursor: {
        id: 'b1', createdAt: 1780000000000, isPinned: true, pinnedAt: 1770000000000
      } as never
    });

    act(() => result.current.loadMore());
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalled());

    const [, query] = getCreatorPosts.mock.calls[0];
    expect(query).toEqual(expect.objectContaining({
      cursor: 'b1', lastIsPinned: true, lastPinnedAt: '1770000000000'
    }));
  });

  it('walks a whole creator list across pages without duplicating or skipping', async () => {
    const all = Array.from({ length: 9 }, (_, index) => make(`b${index + 1}`, B));
    let served = 3;
    getCreatorPosts.mockImplementation(() => {
      const slice = all.slice(served, served + 3);
      served += 3;
      const last = slice[slice.length - 1];
      return Promise.resolve(page(slice, served < all.length, last
        ? { id: last._id, createdAt: Date.parse(last.createdAt as string), isPinned: false }
        : null));
    });

    const { result } = render({
      creatorId: B,
      initialPosts: all.slice(0, 3),
      initialTotal: 9,
      initialHasMore: true,
      initialNextCursor: { id: 'b3', createdAt: 1780000000000, isPinned: false } as never,
      limit: 3
    });

    for (let round = 0; round < 3; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { result.current.loadMore(); });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(result.current.loading).toBe(false));
    }

    const ids = result.current.posts.map((post) => post._id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(all.map((post) => post._id));
    expect(result.current.posts.every((post) => post.user?._id === B)).toBe(true);
    expect(myPosts).not.toHaveBeenCalled();
  });

  it('never appends a page fetched for a creator the viewer has already left', async () => {
    const slow = deferred<unknown>();
    getCreatorPosts.mockImplementation((id: string) => (id === B ? slow.promise : Promise.resolve(page([], false))));

    const { result, rerender } = render({
      creatorId: B,
      initialPosts: [make('b1', B)],
      initialTotal: 2,
      initialHasMore: true,
      initialNextCursor: { id: 'b1', createdAt: 1780000000000, isPinned: false } as never
    });

    act(() => result.current.loadMore());
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalledWith(B, expect.anything()));

    // The viewer navigates to another profile before B's page lands.
    rerender({
      creatorId: C,
      initialPosts: [make('c1', C)],
      initialTotal: 1,
      initialHasMore: false,
      initialNextCursor: null
    });
    await waitFor(() => expect(result.current.posts.map((p) => p._id)).toEqual(['c1']));

    await act(async () => { slow.resolve(page([make('b2', B)], false)); });

    expect(result.current.posts.map((p) => p._id)).toEqual(['c1']);
    expect(result.current.posts.every((post) => post.user?._id === C)).toBe(true);
  });

  it('resets to the new creator\'s server-rendered page when the profile changes', async () => {
    getCreatorPosts.mockResolvedValue(page([], false));
    const { result, rerender } = render({
      creatorId: B, initialPosts: [make('b1', B), make('b2', B)], initialTotal: 2, initialHasMore: false
    });
    expect(result.current.posts.map((p) => p._id)).toEqual(['b1', 'b2']);

    rerender({
      creatorId: C, initialPosts: [make('c1', C)], initialTotal: 1, initialHasMore: false
    });
    expect(result.current.posts.map((p) => p._id)).toEqual(['c1']);
  });

  it('does not fire two overlapping page requests', async () => {
    const slow = deferred<unknown>();
    getCreatorPosts.mockImplementation(() => slow.promise);

    const { result } = render({
      creatorId: B,
      initialPosts: [make('b1', B)],
      initialTotal: 5,
      initialHasMore: true,
      initialNextCursor: { id: 'b1', createdAt: 1780000000000, isPinned: false } as never
    });

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalled());
    expect(getCreatorPosts).toHaveBeenCalledTimes(1);
    await act(async () => { slow.resolve(page([make('b2', B)], false)); });
  });
});

describe('useCreatorPostSearch — owner management screen', () => {
  beforeEach(() => {
    getCreatorPosts.mockReset();
    myPosts.mockReset();
  });

  it('still lists the caller\'s own posts when no creator is named', async () => {
    myPosts.mockResolvedValue(page([make('m1', 'me')], false));

    const { result } = render({});
    act(() => result.current.handleFilter({}));
    await waitFor(() => expect(myPosts).toHaveBeenCalled());

    expect(getCreatorPosts).not.toHaveBeenCalled();
    expect(myPosts.mock.calls[0][0]).not.toHaveProperty('userId');
  });
});
