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
  data: any[];
  hasMore: boolean;
  sessionId: string;
  nextCursor: string | null;
  chainId: string;
  chainExhausted: boolean;
}> = {}) {
  return {
    data: overrides.data ?? [],
    hasMore: overrides.hasMore ?? false,
    sessionId: overrides.sessionId ?? 'session-1',
    nextCursor: overrides.nextCursor ?? null,
    chainId: overrides.chainId ?? 'chain-under-test',
    chainExhausted: overrides.chainExhausted ?? false
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
   * Scenario 3/5 — the stop condition is the SERVER's, and a post is never
   * rendered twice in one browse.
   *
   * `06g` inferred exhaustion from the client's own de-duplication and ended
   * Home at 89 of 160. `06h` replaced that with server-side recycling, which
   * re-offered the catalogue under a per-cycle render key — Home grew to 410
   * cards of a 160-post corpus, visibly repeating itself.
   */
  it('never renders a post twice, even if the server re-offers it', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }, { _id: 'p2' }], hasMore: false, sessionId: 'sess-1' })
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(2));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }, { _id: 'p3' }], hasMore: false, sessionId: 'sess-2' })
    });
    await act(async () => {
      latest.loadMore();
    });
    await waitFor(() => expect(latest.posts).toHaveLength(3));

    const ids = latest.posts.map((p) => p._id);
    expect(ids).toEqual(['p1', 'p2', 'p3']);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('stops when the server reports the chain exhausted', async () => {
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }], hasMore: false, sessionId: 'sess-1' })
    });
    render(<Probe />);
    await waitFor(() => expect(latest.posts).toHaveLength(1));

    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({
        data: [], hasMore: false, sessionId: 'sess-2', chainExhausted: true
      })
    });
    await act(async () => {
      latest.loadMore();
    });
    await waitFor(() => expect(latest.hasMore).toBe(false));

    mockGetPersonalizedHomePosts.mockClear();
    await act(async () => {
      latest.loadMore();
    });
    expect(mockGetPersonalizedHomePosts).not.toHaveBeenCalled();
  });

  it('accumulates every eligible post exactly once across a long chain', async () => {
    // The production shape: 160 posts, 70 per session, paged 20 at a time.
    const corpus = Array.from({ length: 160 }, (_, index) => ({ _id: 'p' + index }));
    let served = 0;
    mockGetPersonalizedHomePosts.mockImplementation((query) => {
      if (served >= corpus.length) {
        return Promise.resolve({
          data: page({
            data: [],
            hasMore: false,
            sessionId: 'sess-end',
            chainExhausted: Boolean(query.rollover)
          })
        });
      }
      const slice = corpus.slice(served, served + 20);
      served += slice.length;
      const moreInSession = served % 70 !== 0 && served < corpus.length;
      return Promise.resolve({
        data: page({
          data: slice,
          hasMore: moreInSession,
          sessionId: 'sess-' + Math.floor(served / 70),
          nextCursor: moreInSession ? String(served) : null
        })
      });
    });

    render(<Probe />);
    await waitFor(() => expect(latest.posts.length).toBeGreaterThan(0));

    for (let step = 0; step < 30 && latest.hasMore; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        latest.loadMore();
      });
    }

    const ids = latest.posts.map((p) => p._id);
    expect(ids.length).toBeGreaterThan(70);
    expect(ids.length).toBeGreaterThan(100);
    expect(ids.length).toBeGreaterThan(140);
    expect(ids.length).toBe(160);
    // Rendered count == unique count, never a multiple of the corpus.
    expect(ids.length).toBe(new Set(ids).size);
    expect(latest.hasMore).toBe(false);
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

    // Explicitly starting a new browse: a fresh chain id goes out, and posts
    // the spent chain already showed are allowed again.
    mockGetPersonalizedHomePosts.mockResolvedValueOnce({
      data: page({ data: [{ _id: 'p1' }], hasMore: false, sessionId: 'sess-3', chainId: 'chain-after-refresh' })
    });
    await act(async () => {
      await latest.refresh();
    });

    expect(latest.hasMore).toBe(true);
    expect(latest.posts.map((p) => p._id)).toEqual(['p1']);
    const chainIds = mockGetPersonalizedHomePosts.mock.calls.map(([q]) => q.chainId);
    expect(chainIds[chainIds.length - 1]).not.toBe(chainIds[0]);
  });
});
