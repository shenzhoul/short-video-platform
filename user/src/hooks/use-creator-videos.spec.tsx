/**
 * The creator grid's own list.
 *
 * Two separate defects put other creators' posts under one creator's name, and
 * both are locked down here.
 *
 * 1. The request went to `/posts/home-posts`, which had become the ranked Home
 *    recommendation feed and ignores `userId` entirely. Measured in a
 *    production build: `?userId=<Iris>` answered with posts from eight
 *    creators, and the grid rendered all of them under Iris's header.
 * 2. `loadedUserIdRef` was set before the request had actually started, while
 *    the fetch itself returned early whenever another was in flight. Moving
 *    between creators quickly therefore marked the new creator "loaded" without
 *    ever asking for them, and the *previous* creator's response — arriving
 *    afterwards — was merged in and never corrected.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

import type { IPost } from '@interfaces/post';

const getCreatorPosts = jest.fn();
jest.mock('@services/post.service', () => ({
  getCreatorPosts: (...args: unknown[]) => getCreatorPosts(...args)
}));

// eslint-disable-next-line import/first
import { useCreatorVideos } from './use-creator-videos';

const IRIS = 'creator-iris';
const SOFIA = 'creator-sofia';

const make = (id: string, userId: string, createdAt: string): IPost => ({
  _id: id,
  type: 'video',
  isPinned: false,
  pinnedAt: null,
  createdAt,
  user: { _id: userId, username: userId },
  files: [{ _id: `${id}-f`, type: 'post-video', url: `https://cdn/${id}.mp4` }]
} as unknown as IPost);

const page = (posts: IPost[], hasMore = false, nextCursor: unknown = null) => ({
  data: { data: posts, hasMore, nextCursor }
});

/** A response that resolves only when told to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('useCreatorVideos', () => {
  beforeEach(() => getCreatorPosts.mockReset());

  it('asks for one creator by id', async () => {
    const open = make('i1', IRIS, '2026-06-03T00:00:00.000Z');
    getCreatorPosts.mockResolvedValue(page([open]));

    renderHook(() => useCreatorVideos({ userId: IRIS, currentPost: open, enabled: true }));

    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalled());
    const [creatorId, query] = getCreatorPosts.mock.calls[0];
    expect(creatorId).toBe(IRIS);
    expect(query).toEqual(expect.objectContaining({ sortBy: 'createdAt', sort: 'desc' }));
  });

  it('discards a response for a creator the viewer has already left', async () => {
    const irisPost = make('i1', IRIS, '2026-06-03T00:00:00.000Z');
    const sofiaPost = make('s1', SOFIA, '2026-06-02T00:00:00.000Z');

    const irisResponse = deferred<unknown>();
    const sofiaResponse = deferred<unknown>();
    getCreatorPosts.mockImplementation((creatorId: string) => (
      creatorId === IRIS ? irisResponse.promise : sofiaResponse.promise
    ));

    const { result, rerender } = renderHook(
      (props: { userId: string; currentPost: IPost }) => useCreatorVideos({ ...props, enabled: true }),
      { initialProps: { userId: IRIS, currentPost: irisPost } }
    );
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalledWith(IRIS, expect.anything()));

    // The viewer moves to another creator before Iris's page lands.
    rerender({ userId: SOFIA, currentPost: sofiaPost });
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalledWith(SOFIA, expect.anything()));

    // Now both land, Iris's first — the ordering that produced the mixed grid.
    await act(async () => {
      irisResponse.resolve(page([irisPost, make('i2', IRIS, '2026-06-01T00:00:00.000Z')]));
      sofiaResponse.resolve(page([sofiaPost, make('s2', SOFIA, '2026-05-30T00:00:00.000Z')]));
    });

    await waitFor(() => expect(result.current.posts.length).toBeGreaterThan(1));
    const creators = new Set(result.current.posts.map((item) => item.user?._id));
    expect([...creators]).toEqual([SOFIA]);
  });

  it('still fetches the new creator even while the previous request is in flight', async () => {
    const irisPost = make('i1', IRIS, '2026-06-03T00:00:00.000Z');
    const sofiaPost = make('s1', SOFIA, '2026-06-02T00:00:00.000Z');
    getCreatorPosts.mockImplementation(() => new Promise(() => undefined)); // never settles

    const { rerender } = renderHook(
      (props: { userId: string; currentPost: IPost }) => useCreatorVideos({ ...props, enabled: true }),
      { initialProps: { userId: IRIS, currentPost: irisPost } }
    );
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalledTimes(1));

    rerender({ userId: SOFIA, currentPost: sofiaPost });

    // The old guard dropped this request entirely and marked Sofia loaded, so
    // her posts were never fetched at all.
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalledTimes(2));
    expect(getCreatorPosts.mock.calls[1][0]).toBe(SOFIA);
  });

  it('never pages one creator with another creator\'s cursor', async () => {
    const irisPost = make('i1', IRIS, '2026-06-03T00:00:00.000Z');
    const sofiaPost = make('s1', SOFIA, '2026-06-02T00:00:00.000Z');
    const cursor = { id: 'i2', createdAt: '2026-06-01T00:00:00.000Z' };

    getCreatorPosts.mockImplementation((creatorId: string) => Promise.resolve(
      creatorId === IRIS
        ? page([irisPost], true, cursor)
        : page([sofiaPost], true, { id: 's2', createdAt: '2026-05-30T00:00:00.000Z' })
    ));

    const { result, rerender } = renderHook(
      (props: { userId: string; currentPost: IPost }) => useCreatorVideos({ ...props, enabled: true }),
      { initialProps: { userId: IRIS, currentPost: irisPost } }
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    rerender({ userId: SOFIA, currentPost: sofiaPost });
    await waitFor(() => expect(getCreatorPosts).toHaveBeenCalledWith(SOFIA, expect.anything()));

    getCreatorPosts.mockClear();
    act(() => result.current.loadMore());

    // Either it does not page at all yet, or it pages Sofia with Sofia's
    // cursor — never Sofia with Iris's.
    getCreatorPosts.mock.calls.forEach(([creatorId, query]) => {
      expect(creatorId).toBe(SOFIA);
      expect(query.cursor).not.toBe('i2');
    });
  });

  it('retries the creator after a failed load instead of latching an empty grid', async () => {
    const open = make('i1', IRIS, '2026-06-03T00:00:00.000Z');
    getCreatorPosts.mockRejectedValueOnce(new Error('network'));

    const { result, rerender } = renderHook(
      (props: { userId: string; currentPost: IPost; enabled: boolean }) => useCreatorVideos(props),
      { initialProps: { userId: IRIS, currentPost: open, enabled: true } }
    );
    await waitFor(() => expect(result.current.error).toBeTruthy());

    getCreatorPosts.mockResolvedValue(page([open, make('i2', IRIS, '2026-06-01T00:00:00.000Z')]));
    // Re-entering creator mode on the same creator must try again.
    rerender({ userId: IRIS, currentPost: open, enabled: false });
    rerender({ userId: IRIS, currentPost: open, enabled: true });

    await waitFor(() => expect(result.current.posts).toHaveLength(2));
  });
});
