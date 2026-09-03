import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import { useRecommendedVideos } from './use-recommended-videos';

const mockGetRecommendedPosts = jest.fn();
jest.mock('@services/post.service', () => ({
  getRecommendedPosts: (...args: any[]) => mockGetRecommendedPosts(...args)
}));

let latest: ReturnType<typeof useRecommendedVideos>;

function Probe() {
  latest = useRecommendedVideos(null);
  return null;
}

function page(overrides: Partial<{ data: any[]; hasMore: boolean; sessionId: string; nextCursor: string | null }> = {}) {
  return {
    data: overrides.data ?? [],
    hasMore: overrides.hasMore ?? false,
    sessionId: overrides.sessionId ?? 'session-1',
    nextCursor: overrides.nextCursor ?? null
  };
}

describe('useRecommendedVideos (For You)', () => {
  beforeEach(() => {
    mockGetRecommendedPosts.mockReset();
  });

  it('loadMore with no prior session starts a new one', async () => {
    mockGetRecommendedPosts.mockResolvedValue({ data: page({ data: [{ _id: 'p1' }], hasMore: true, sessionId: 'sess-1', nextCursor: '10' }) });
    render(<Probe />);

    await act(async () => {
      await latest.loadMore();
    });

    expect(latest.posts.map((p) => p._id)).toEqual(['p1']);
    expect(latest.sessionId).toBe('sess-1');
    const [query] = mockGetRecommendedPosts.mock.calls[0];
    expect(query.sessionId).toBeUndefined();
  });

  it('continues an existing session with sessionId + cursor, deduping overlapping ids', async () => {
    mockGetRecommendedPosts.mockResolvedValueOnce({ data: page({ data: [{ _id: 'p1' }], hasMore: true, sessionId: 'sess-1', nextCursor: '10' }) });
    render(<Probe />);
    await act(async () => { await latest.loadMore(); });

    mockGetRecommendedPosts.mockResolvedValueOnce({ data: page({ data: [{ _id: 'p1' }, { _id: 'p2' }], hasMore: false, sessionId: 'sess-1' }) });
    await act(async () => { await latest.loadMore(); });

    expect(latest.posts.map((p) => p._id)).toEqual(['p1', 'p2']);
    const [secondQuery] = mockGetRecommendedPosts.mock.calls[1];
    expect(secondQuery.sessionId).toBe('sess-1');
    expect(secondQuery.cursor).toBe('10');
  });

  it('refresh() starts a brand-new session, replacing the post list', async () => {
    mockGetRecommendedPosts.mockResolvedValueOnce({ data: page({ data: [{ _id: 'p1' }], sessionId: 'sess-1' }) });
    render(<Probe />);
    await act(async () => { await latest.loadMore(); });

    mockGetRecommendedPosts.mockResolvedValueOnce({ data: page({ data: [{ _id: 'p9' }], sessionId: 'sess-2' }) });
    await act(async () => { await latest.refresh(); });

    expect(latest.posts.map((p) => p._id)).toEqual(['p9']);
    expect(latest.sessionId).toBe('sess-2');
  });

  it('does not fetch again while a request is already in flight', async () => {
    let resolveFirst: (value: any) => void = () => {};
    mockGetRecommendedPosts.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    render(<Probe />);

    let firstCall: Promise<void>;
    act(() => {
      firstCall = latest.loadMore();
    });
    act(() => {
      void latest.loadMore(); // Second call while the first is still pending.
    });

    resolveFirst({ data: page({ data: [{ _id: 'p1' }] }) });
    await act(async () => { await firstCall; });

    expect(mockGetRecommendedPosts).toHaveBeenCalledTimes(1);
  });
});
