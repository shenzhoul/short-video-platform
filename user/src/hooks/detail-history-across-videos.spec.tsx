import { IPost } from '@interfaces/post';
import { act, renderHook } from '@testing-library/react';

import { useRecommendationDetailFeed } from './use-recommendation-detail-feed';

/**
 * Entering the Videos tab must not destroy the detail-recommendation history.
 *
 * ## The defect
 *
 * The session reseeds whenever the open post is one it has never served:
 *
 *     if (knownIds.has(currentPostId)) return;   // ordinary navigation
 *     knownIds = new Set([currentPostId]);       // otherwise: a NEW session
 *     setFeedPosts([currentPost]);
 *
 * A creator post from the Videos tab is never in `knownIds` — it belongs to the
 * creator's list, not to this session — so entering Videos looked exactly like
 * a brand-new popup open. History `[P0, P1]` became `[C1]`, and pressing Back
 * reseeded again to `[P1]`, so Previous could no longer reach `P0`.
 *
 * `frozen` is the fix: while another list owns navigation this session holds
 * its id, its array and its known-id set completely still.
 */
jest.mock('@services/post.service', () => ({
  openPostDetailRecommendationSession: jest.fn()
    .mockResolvedValue({ data: { sessionId: 'detail-session-1' } }),
  stepPostDetailRecommendationNext: jest.fn().mockResolvedValue({ data: null }),
  stepPostDetailRecommendationPrevious: jest.fn().mockResolvedValue({ data: null }),
  findOne: jest.fn().mockResolvedValue({ data: null })
}));

jest.mock('../lib/recommendation-anonymous-id', () => ({
  getRecommendationAnonymousId: () => 'anon-1'
}));

const {
  openPostDetailRecommendationSession,
  stepPostDetailRecommendationNext,
  findOne
} = jest.requireMock('@services/post.service');

/**
 * Let the session genuinely serve one post, the way the server does.
 *
 * `feedPosts` cannot simply be pushed to from a test: what makes a post part of
 * the session is the hook's internal known-id set, and only a real append
 * through `fetchOneMore` writes to it. Faking the array instead produced a post
 * the hook did not recognise — which is the very condition under test.
 */
function serveOnce(next: IPost) {
  let handed = false;
  stepPostDetailRecommendationNext.mockImplementation(async () => {
    if (handed) return { data: null };
    handed = true;
    return { data: { postId: next._id } };
  });
  findOne.mockImplementation(async () => ({ data: next }));
}

/** Let the prefetch effect run to completion. */
async function settle() {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

const post = (id: string): IPost => ({
  _id: id, title: id, type: 'video', files: [], user: { _id: 'creator-1' }
} as unknown as IPost);

const P0 = post('P0');
const P1 = post('P1');
const C1 = post('C1');
const C2 = post('C2');

/** Drives the hook the way `PostDetailModal` drives it. */
function setup() {
  return renderHook(
    ({ currentPost, frozen }: { currentPost: IPost | null; frozen: boolean }) => useRecommendationDetailFeed({
      enabled: Boolean(currentPost), currentPost, frozen
    }),
    { initialProps: { currentPost: P0 as IPost | null, frozen: false } }
  );
}

describe('detail history across Videos mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    openPostDetailRecommendationSession.mockResolvedValue({ data: { sessionId: 'detail-session-1' } });
    serveOnce(P1);
  });

  it('keeps [P0, P1] and the same session across a full Videos round trip', async () => {
    const { result, rerender } = setup();
    await act(async () => { await Promise.resolve(); });
    // The anchor is the head; the session prefetches ahead of it on its own.
    expect(result.current.feedPosts[0]._id).toBe('P0');
    const sessionAfterOpen = result.current.sessionId;
    expect(sessionAfterOpen).toBe('detail-session-1');
    expect(openPostDetailRecommendationSession).toHaveBeenCalledTimes(1);

    // The session serves P1, so it becomes part of the history.
    await act(async () => { await settle(); });
    expect(result.current.feedPosts.map((p) => p._id)).toEqual(['P0', 'P1']);
    await act(async () => { rerender({ currentPost: P1, frozen: false }); await settle(); });

    // --- enter Videos: creator posts arrive, and must change nothing --------
    await act(async () => { rerender({ currentPost: C1, frozen: true }); await Promise.resolve(); });
    await act(async () => { rerender({ currentPost: C2, frozen: true }); await Promise.resolve(); });

    expect(openPostDetailRecommendationSession).toHaveBeenCalledTimes(1);
    expect(result.current.sessionId).toBe(sessionAfterOpen);
    expect(result.current.feedPosts.map((p) => p._id)).toEqual(['P0', 'P1']);

    // --- Back: the base detail post is restored ----------------------------
    await act(async () => { rerender({ currentPost: P1, frozen: false }); await Promise.resolve(); });

    expect(openPostDetailRecommendationSession).toHaveBeenCalledTimes(1);
    expect(result.current.sessionId).toBe(sessionAfterOpen);
    expect(result.current.feedPosts.map((p) => p._id)).toEqual(['P0', 'P1']);
    // P0 is still ahead of P1 in the array, which is what enables Previous.
    expect(result.current.feedPosts.findIndex((p) => p._id === 'P1')).toBe(1);
  });

  it('the old behaviour is what this pins: unfrozen, a creator post reseeds', async () => {
    const { result, rerender } = setup();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await settle(); });
    await act(async () => { rerender({ currentPost: P1, frozen: false }); await settle(); });

    // Exactly the bug: without the freeze, C1 looks like a brand-new open.
    await act(async () => { rerender({ currentPost: C1, frozen: false }); await Promise.resolve(); });
    expect(openPostDetailRecommendationSession).toHaveBeenCalledTimes(2);
    expect(result.current.feedPosts.map((p) => p._id)).toEqual(['C1']);
  });

  it('entering Videos straight from the anchor leaves the anchor alone', async () => {
    const { result, rerender } = setup();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { rerender({ currentPost: C1, frozen: true }); await Promise.resolve(); });
    await act(async () => { rerender({ currentPost: P0, frozen: false }); await Promise.resolve(); });

    expect(openPostDetailRecommendationSession).toHaveBeenCalledTimes(1);
    // The session may have prefetched ahead — that is its job. What matters is
    // that the anchor is still the head, so Previous stays disabled on it.
    expect(result.current.feedPosts[0]._id).toBe('P0');
    expect(result.current.feedPosts.findIndex((p) => p._id === 'P0')).toBe(0);
  });

  it('repeated Videos enter/exit cycles never alter the history', async () => {
    const { result, rerender } = setup();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await settle(); });
    await act(async () => { rerender({ currentPost: P1, frozen: false }); await settle(); });
    const before = result.current.feedPosts.map((p) => p._id);

    for (let cycle = 0; cycle < 4; cycle += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { rerender({ currentPost: C1, frozen: true }); await Promise.resolve(); });
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { rerender({ currentPost: P1, frozen: false }); await Promise.resolve(); });
    }

    expect(result.current.feedPosts.map((p) => p._id)).toEqual(before);
    expect(openPostDetailRecommendationSession).toHaveBeenCalledTimes(1);
  });

  it('a genuinely new popup open still starts a new session', async () => {
    const { result, rerender } = setup();
    await act(async () => { await Promise.resolve(); });

    // Closed, then reopened on an unrelated post — not a mode change.
    await act(async () => { rerender({ currentPost: null, frozen: false }); await Promise.resolve(); });
    await act(async () => { rerender({ currentPost: post('P9'), frozen: false }); await Promise.resolve(); });

    expect(openPostDetailRecommendationSession).toHaveBeenCalledTimes(2);
    expect(result.current.feedPosts.map((p) => p._id)).toEqual(['P9']);
  });
});

/**
 * The wiring that makes the freeze reach the hook.
 */
const fs = require('fs');
const path = require('path');
const HOME = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'content', 'post', 'home-feed.tsx'), 'utf8'
);
const MODAL = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'content', 'post', 'post-detail-modal.tsx'), 'utf8'
);

describe('freeze wiring', () => {
  it('the popup publishes which list owns navigation', () => {
    expect(MODAL).toMatch(/onNavigationModeChange\?: \(mode: PostDetailMode\) => void;/);
    expect(MODAL).toMatch(/onModeChange\?\.\(mode\)/);
  });

  it('Home freezes the detail session in creator mode only', () => {
    expect(HOME).toMatch(/frozen: detailNavigationMode === 'creator'/);
    expect(HOME).toMatch(/onNavigationModeChange=\{setDetailNavigationMode\}/);
  });

  it('Home still owns no part of the popup sequence itself', () => {
    expect(HOME).toMatch(/posts=\{detailFeed\.feedPosts\}/);
    expect(HOME).not.toMatch(/usesHomeSession/);
  });
});
