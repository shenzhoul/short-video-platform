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

function page(overrides: Partial<{
  data: any[]; hasMore: boolean; sessionId: string; nextCursor: string | null; chainId: string; cycle: number;
}> = {}) {
  return {
    data: overrides.data ?? [],
    hasMore: overrides.hasMore ?? false,
    sessionId: overrides.sessionId ?? 'session-1',
    nextCursor: overrides.nextCursor ?? null,
    chainId: overrides.chainId ?? 'chain-under-test',
    cycle: overrides.cycle ?? 0
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
    expect(query.rollover).toBeUndefined();
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
    expect(secondQuery.rollover).toBeUndefined();
  });

  it('does not load more before any session exists', async () => {
    // A first fetch that produced no session at all — there is nothing to page
    // and nothing to roll over from, so the only correct action is none.
    mockGetPersonalizedHomePosts.mockResolvedValue({
      data: { data: [{ _id: 'p1' }], hasMore: true, sessionId: null, nextCursor: null }
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(1));

    mockGetPersonalizedHomePosts.mockClear();
    await act(async () => {
      latest.loadMore();
    });
    expect(mockGetPersonalizedHomePosts).not.toHaveBeenCalled();
  });

  /*
   * Scenario 1 — Home reaches the session boundary and continues.
   *
   * The session limit is 70 against a 160-post catalogue, so `hasMore: false`
   * at the end of a session used to be where the feed stopped. It now means
   * "this session is done", and the hook asks for a successor in the same
   * chain.
   */
  it('rolls over into a new session of the same chain when the current one is exhausted', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }, { _id: 'p2' }], hasMore: false, sessionId: 'sess-1', nextCursor: null })
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(2));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p3' }, { _id: 'p4' }], hasMore: true, sessionId: 'sess-2', nextCursor: '20' })
    });
    await act(async () => {
      latest.loadMore();
    });

    const [rolloverQuery] = mockGetPersonalizedHomePosts.mock.calls[1];
    // The exhausted session's id identifies the chain to continue; sending a
    // cursor as well would ask for another page of the session that just ended.
    expect(rolloverQuery.sessionId).toBe('sess-1');
    expect(rolloverQuery.cursor).toBeUndefined();
    expect(rolloverQuery.rollover).toBe('true');

    await waitFor(() => expect(latest.posts.map((p) => p._id)).toEqual(['p1', 'p2', 'p3', 'p4']));
    expect(latest.sessionId).toBe('sess-2');
  });

  /** Scenario 2 — immediate cross-session duplicates are avoided. */
  it('drops a post the previous session already showed, if the server ever re-offers one', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }, { _id: 'p2' }], hasMore: false, sessionId: 'sess-1' })
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(2));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p2' }, { _id: 'p3' }], hasMore: true, sessionId: 'sess-2', nextCursor: '20' })
    });
    await act(async () => {
      latest.loadMore();
    });

    await waitFor(() => expect(latest.posts.map((p) => p._id)).toEqual(['p1', 'p2', 'p3']));
  });

  /*
   * Scenario 3/5 — the stop condition is the SERVER's, not the client's.
   *
   * In `deploy-2026-09-06g` this was "the rollover added nothing the client did
   * not already hold", so a rollover re-offering posts already on screen ended
   * the feed at 89 of 160 with "recommendations are exhausted". Now only an
   * empty page stops it — and since an exhausted chain recycles server-side,
   * an empty page means nothing at all is eligible.
   */
  it('keeps rolling over when the server re-offers a post already on screen', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }], hasMore: false, sessionId: 'sess-1' })
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(1));

    // A recycled cycle legitimately re-offers p1 — and, because it arrives in
    // cycle 1, it is a distinct rendered entry rather than a discarded duplicate.
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({
        data: [{ _id: 'p1' }], hasMore: false, sessionId: 'sess-2', cycle: 1
      })
    });
    await act(async () => {
      latest.loadMore();
    });
    await waitFor(() => expect(latest.sessionId).toBe('sess-2'));

    expect(latest.posts.map((p) => p.feedKey)).toEqual(['p1', '1:p1']);
    expect(latest.hasMore).toBe(true);
  });

  it('stops only when a rollover comes back empty', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }], hasMore: false, sessionId: 'sess-1' })
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(1));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [], hasMore: false, sessionId: 'sess-2' })
    });
    await act(async () => {
      latest.loadMore();
    });
    await waitFor(() => expect(latest.hasMore).toBe(false));

    mockGetPersonalizedHomePosts.mockClear();
    await act(async () => {
      latest.loadMore();
    });
    // Latched, or the rollover branch would fire on every scroll to the bottom
    // for the rest of the browse.
    expect(mockGetPersonalizedHomePosts).not.toHaveBeenCalled();
  });

  it('reports hasMore while a rollover is still possible, so the scroller keeps asking', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }], hasMore: false, sessionId: 'sess-1' })
    });
    render(<Probe />);

    // The session is finished but the chain is not — the visible contract must
    // not be a hard stop at the session boundary.
    await waitFor(() => expect(latest.sessionId).toBe('sess-1'));
    expect(latest.hasMore).toBe(true);
  });

  it('attributes each post to the session that ranked it, not the newest one', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }], hasMore: false, sessionId: 'sess-1' })
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(1));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p2' }], hasMore: true, sessionId: 'sess-2', nextCursor: '20' })
    });
    await act(async () => {
      latest.loadMore();
    });
    await waitFor(() => expect(latest.posts).toHaveLength(2));

    // `p1` is still on screen while `sess-2` is the open session. Reporting its
    // impressions under `sess-2` would file that evidence against a ranking
    // that never chose it.
    expect(latest.sessionForPost('p1')).toBe('sess-1');
    expect(latest.sessionForPost('p2')).toBe('sess-2');
    expect(latest.sessionForPost(null)).toBeNull();
    // Keyed by render key, so the same post served again in a later cycle is
    // attributed to the session that actually served it that time.
    expect(latest.posts.map((p) => p.feedKey)).toEqual(['p1', 'p2']);
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
    expect(refreshQuery.rollover).toBeUndefined();
  });

  it('a refresh re-arms the rollover a spent catalogue had stopped', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }], hasMore: false, sessionId: 'sess-1' })
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(1));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [], hasMore: false, sessionId: 'sess-2' })
    });
    await act(async () => {
      latest.loadMore();
    });
    await waitFor(() => expect(latest.hasMore).toBe(false));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p7' }], hasMore: false, sessionId: 'sess-3' })
    });
    await act(async () => {
      await latest.refresh();
    });

    expect(latest.hasMore).toBe(true);
  });
});
