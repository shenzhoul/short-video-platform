import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import { useRecommendationDetailFeed } from './use-recommendation-detail-feed';

const mockOpen = jest.fn();
const mockNext = jest.fn();
const mockPrevious = jest.fn();
const mockFindOne = jest.fn();
jest.mock('@services/post.service', () => ({
  openPostDetailRecommendationSession: (...args: any[]) => mockOpen(...args),
  stepPostDetailRecommendationNext: (...args: any[]) => mockNext(...args),
  stepPostDetailRecommendationPrevious: (...args: any[]) => mockPrevious(...args),
  findOne: (...args: any[]) => mockFindOne(...args)
}));
jest.mock('../lib/recommendation-anonymous-id', () => ({
  getRecommendationAnonymousId: () => undefined
}));

let latest: ReturnType<typeof useRecommendationDetailFeed>;

function Probe({ enabled = true, currentPost }: { enabled?: boolean; currentPost: any }) {
  latest = useRecommendationDetailFeed({ enabled, currentPost });
  return null;
}

function post(id: string, over: Record<string, unknown> = {}) {
  return { _id: id, type: 'video', ...over };
}

/** Answers `next` with an endless supply of distinct posts. */
function serveSequence(ids: string[]) {
  let index = 0;
  mockNext.mockImplementation(() => Promise.resolve(
    index < ids.length ? { data: { postId: ids[index++] } } : { data: null }
  ));
  mockFindOne.mockImplementation((id: string) => Promise.resolve({ data: post(id) }));
}

describe('useRecommendationDetailFeed', () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockNext.mockReset();
    mockPrevious.mockReset();
    mockFindOne.mockReset();
    mockOpen.mockResolvedValue({ data: { sessionId: 'detail-sess-1', postId: 'anchor-1' } });
    mockPrevious.mockResolvedValue({ data: null });
  });

  it('seeds feedPosts with the anchor immediately and opens a session', async () => {
    mockNext.mockResolvedValue({ data: null });
    render(<Probe currentPost={post('anchor-1')} />);
    expect(latest.feedPosts.map((p) => p._id)).toEqual(['anchor-1']);
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('anchor-1', undefined));
  });

  it('returns an empty array when disabled (feed-scoped/creator-scoped sources)', () => {
    render(<Probe enabled={false} currentPost={post('anchor-1')} />);
    expect(latest.feedPosts).toEqual([]);
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('keeps a buffer of posts loaded ahead of the open one', async () => {
    serveSequence(['n1', 'n2', 'n3', 'n4', 'n5']);

    render(<Probe currentPost={post('anchor-1')} />);
    await waitFor(() => expect(mockOpen).toHaveBeenCalled());

    // Three ahead: reaching the tail is no longer what arms the refill, so a
    // single dropped response cannot end the sequence.
    await waitFor(() => expect(latest.feedPosts.map((p) => p._id))
      .toEqual(['anchor-1', 'n1', 'n2', 'n3']));
  });

  it('skips a deleted next post (404) and retries for another', async () => {
    mockNext
      .mockResolvedValueOnce({ data: { postId: 'dead-1' } })
      .mockResolvedValueOnce({ data: { postId: 'alive-1' } })
      .mockResolvedValue({ data: null });
    mockFindOne
      .mockRejectedValueOnce(new Error('not found'))
      .mockImplementation((id: string) => Promise.resolve({ data: post(id) }));

    render(<Probe currentPost={post('anchor-1')} />);
    await waitFor(() => expect(mockOpen).toHaveBeenCalled());

    await waitFor(() => expect(latest.feedPosts.map((p) => p._id)).toEqual(['anchor-1', 'alive-1']));
  });

  it('gives up after the retry budget rather than looping forever on all-dead candidates', async () => {
    mockNext.mockResolvedValue({ data: { postId: 'always-dead' } });
    mockFindOne.mockRejectedValue(new Error('not found'));

    render(<Probe currentPost={post('anchor-1')} />);
    await waitFor(() => expect(mockOpen).toHaveBeenCalled());
    await waitFor(() => expect(mockNext.mock.calls.length).toBeGreaterThanOrEqual(4)); // 1 initial + 3 retries

    expect(latest.feedPosts.map((p) => p._id)).toEqual(['anchor-1']); // Nothing appended.
    await waitFor(() => expect(latest.hasMoreAhead).toBe(false));
  });

  it('notifies the server when the viewer navigates backward locally', async () => {
    serveSequence(['next-1']);

    const { rerender } = render(<Probe currentPost={post('anchor-1')} />);
    await waitFor(() => expect(latest.feedPosts).toHaveLength(2));

    rerender(<Probe currentPost={post('next-1')} />);
    await waitFor(() => expect(latest.feedPosts.map((p) => p._id)).toEqual(['anchor-1', 'next-1']));

    // Move back to the anchor — a local index decrease.
    act(() => {
      rerender(<Probe currentPost={post('anchor-1')} />);
    });

    await waitFor(() => expect(mockPrevious).toHaveBeenCalledWith('detail-sess-1', undefined));
  });

  it('starts a brand-new session when reopened on a different anchor', async () => {
    mockNext.mockResolvedValue({ data: null });
    const { rerender } = render(<Probe currentPost={post('anchor-1')} />);
    await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(1));

    mockOpen.mockResolvedValueOnce({ data: { sessionId: 'detail-sess-2', postId: 'anchor-2' } });
    rerender(<Probe currentPost={post('anchor-2')} />);

    expect(latest.feedPosts.map((p) => p._id)).toEqual(['anchor-2']);
    await waitFor(() => expect(mockOpen).toHaveBeenCalledTimes(2));
  });

  /*
   * The dead-end.
   *
   * Opening a post fires a view count, and the response patches the open post
   * object. That replaced object used to be a dependency of the prefetch
   * effect, so its cleanup ran and discarded a post that had *already been
   * fetched successfully* — and the re-run that followed hit the in-flight
   * guard and returned early. Nothing rescheduled it. Measured in a production
   * build, the server handed out a third post while the Next control stayed
   * disabled for good; the sequence ended at post two of a 160-post catalogue.
   */
  it('an interaction patch on the open post does not cancel the refill', async () => {
    serveSequence(['n1', 'n2', 'n3', 'n4']);

    const { rerender } = render(<Probe currentPost={post('anchor-1')} />);
    await waitFor(() => expect(latest.feedPosts.length).toBeGreaterThan(1));

    // Same post, new object identity and a changed counter — exactly what a
    // view/like response produces.
    rerender(<Probe currentPost={post('anchor-1', { totalView: 1 })} />);
    rerender(<Probe currentPost={post('anchor-1', { totalView: 2 })} />);

    await waitFor(() => expect(latest.feedPosts.map((p) => p._id))
      .toEqual(['anchor-1', 'n1', 'n2', 'n3']));
    // And it did not restart the session, which would have wiped the array.
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('walks twenty posts without stalling, patching the open post at every step', async () => {
    const ids = Array.from({ length: 30 }, (_, index) => `p${index}`);
    let index = 0;
    mockNext.mockImplementation(() => Promise.resolve(
      index < ids.length ? { data: { postId: ids[index++] } } : { data: null }
    ));
    // Resolved a tick late on purpose: the interaction patch below then lands
    // *while the fetch is in flight*, which is the shape of the real failure.
    mockFindOne.mockImplementation((id: string) => new Promise((resolve) => {
      setTimeout(() => resolve({ data: post(id) }), 5);
    }));

    const { rerender } = render(<Probe currentPost={post('anchor-1')} />);
    await waitFor(() => expect(latest.feedPosts.length).toBeGreaterThan(1));

    const visited: string[] = ['anchor-1'];
    for (let step = 0; step < 20; step += 1) {
      const index = latest.feedPosts.findIndex((p) => p._id === visited[visited.length - 1]);
      const next = latest.feedPosts[index + 1];
      expect(next).toBeDefined();
      visited.push(next._id);
      // Navigate, then patch it the way a view response does.
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        rerender(<Probe currentPost={next} />);
      });
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        rerender(<Probe currentPost={{ ...next, totalView: step }} />);
      });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(latest.feedPosts.length).toBeGreaterThan(visited.length));
    }

    expect(new Set(visited).size).toBe(21);
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('reports more ahead while a refill is in flight, and stops when the server says so', async () => {
    let release: (value: unknown) => void = () => undefined;
    mockNext.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    render(<Probe currentPost={post('anchor-1')} />);
    await waitFor(() => expect(mockNext).toHaveBeenCalled());
    // Still loading: "next" is a real option even though nothing is loaded yet.
    expect(latest.hasMoreAhead).toBe(true);

    await act(async () => { release({ data: null }); });
    await waitFor(() => expect(latest.hasMoreAhead).toBe(false));
  });
});
