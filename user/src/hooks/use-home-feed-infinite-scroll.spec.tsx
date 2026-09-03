import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import { useHomeFeedInfiniteScroll } from './use-home-feed-infinite-scroll';

const mockGetPersonalizedHomePosts = jest.fn();
jest.mock('@services/post.service', () => ({
  getPersonalizedHomePosts: (...args: any[]) => mockGetPersonalizedHomePosts(...args)
}));

let latest: ReturnType<typeof useHomeFeedInfiniteScroll>;

function Probe({ topicKey = '' }: { topicKey?: string }) {
  latest = useHomeFeedInfiniteScroll({ topicKey });
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

describe('useHomeFeedInfiniteScroll', () => {
  beforeEach(() => {
    mockGetPersonalizedHomePosts.mockReset();
  });

  it('fetches a fresh session with no sessionId/cursor on first mount', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValue({ data: page({ data: [{ _id: 'p1' }] }) });
    render(<Probe />);

    await waitFor(() => expect(latest.posts).toHaveLength(1));
    const [query] = mockGetPersonalizedHomePosts.mock.calls[0];
    expect(query.sessionId).toBeUndefined();
    expect(query.cursor).toBeUndefined();
  });

  it('load-more continues the same session and never duplicates a post', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }], hasMore: true, sessionId: 'sess-1', nextCursor: '10' })
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(1));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      // The server may legitimately echo an already-seen id at a page boundary; the hook must dedupe.
      data: page({ data: [{ _id: 'p1' }, { _id: 'p2' }], hasMore: false, sessionId: 'sess-1' })
    });
    await act(async () => {
      latest.loadMore();
    });

    await waitFor(() => expect(latest.posts.map((p) => p._id)).toEqual(['p1', 'p2']));
    const [secondQuery] = mockGetPersonalizedHomePosts.mock.calls[1];
    expect(secondQuery.sessionId).toBe('sess-1');
    expect(secondQuery.cursor).toBe('10');
  });

  it('does not load more without an active session or cursor', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValue({ data: page({ data: [{ _id: 'p1' }], hasMore: true, sessionId: undefined, nextCursor: null }) });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(1));

    mockGetPersonalizedHomePosts.mockClear();
    await act(async () => {
      latest.loadMore();
    });
    expect(mockGetPersonalizedHomePosts).not.toHaveBeenCalled();
  });

  it('refresh() abandons the current session and starts a brand-new one', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({ data: page({ data: [{ _id: 'p1' }], sessionId: 'sess-1' }) });
    render(<Probe />);
    await waitFor(() => expect(latest.sessionId).toBe('sess-1'));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({ data: page({ data: [{ _id: 'p9' }], sessionId: 'sess-2' }) });
    await act(async () => {
      await latest.refresh();
    });

    expect(latest.posts.map((p) => p._id)).toEqual(['p9']);
    expect(latest.sessionId).toBe('sess-2');
    const [refreshQuery] = mockGetPersonalizedHomePosts.mock.calls[1];
    expect(refreshQuery.sessionId).toBeUndefined();
  });
});
