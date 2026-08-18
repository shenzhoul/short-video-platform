import { act, render } from '@testing-library/react';
import React from 'react';

import { usePostInteractionState } from './use-post-interactions';

/**
 * The boundary between the viewer's own optimistic action and the shared
 * counters the server owns.
 */

const onInteractionChange = jest.fn();
let api: ReturnType<typeof usePostInteractionState>;

function Probe({ post }: { post: any }) {
  api = usePostInteractionState(post, onInteractionChange);
  return null;
}

function build(overrides: Record<string, any> = {}) {
  return {
    _id: 'p1', isLiked: false, totalLike: 100, totalComment: 5, totalShare: 2, ...overrides
  };
}

beforeEach(() => onInteractionChange.mockClear());

describe('optimistic own action', () => {
  it('reacts immediately to the viewer liking', () => {
    render(<Probe post={build()} />);

    act(() => api.handleLikeChange(true, 101));

    // Responsiveness for one's own click is kept.
    expect(api.isLiked).toBe(true);
    expect(api.totalLike).toBe(101);
  });
});

describe('authoritative snapshot reconciliation', () => {
  it('replaces counters with the absolute server values', () => {
    render(<Probe post={build()} />);

    act(() => api.applyStatsSnapshot({ totalLike: 250, totalComment: 9, totalShare: 4 }));

    expect(api.totalLike).toBe(250);
    expect(api.totalComment).toBe(9);
    expect(api.totalShare).toBe(4);
  });

  it('corrects an optimistic count instead of stacking on it', () => {
    render(<Probe post={build()} />);

    // Viewer likes: optimistic 100 -> 101.
    act(() => api.handleLikeChange(true, 101));
    // The snapshot already includes that like.
    act(() => api.applyStatsSnapshot({ totalLike: 101, totalComment: 5, totalShare: 2 }));

    // Exactly the authoritative total — no double increment.
    expect(api.totalLike).toBe(101);
  });

  it('heals drift from a missed frame', () => {
    render(<Probe post={build()} />);

    // Several snapshots were missed while other viewers liked.
    act(() => api.applyStatsSnapshot({ totalLike: 512, totalComment: 5, totalShare: 2 }));

    // Absolute assignment means one frame is enough to converge.
    expect(api.totalLike).toBe(512);
  });

  it('never overwrites the viewer-specific liked flag', () => {
    render(<Probe post={build()} />);
    act(() => api.handleLikeChange(true, 101));

    // Another viewer's like raises the shared total.
    act(() => api.applyStatsSnapshot({ totalLike: 102, totalComment: 5, totalShare: 2 }));

    expect(api.totalLike).toBe(102);
    // B liking says nothing about whether this viewer likes it.
    expect(api.isLiked).toBe(true);
  });

  it('leaves a non-liking viewer unliked however high the total goes', () => {
    render(<Probe post={build({ isLiked: false })} />);

    act(() => api.applyStatsSnapshot({ totalLike: 999, totalComment: 5, totalShare: 2 }));

    expect(api.isLiked).toBe(false);
    expect(api.totalLike).toBe(999);
  });

  it('converges totalComment to the snapshot after a live comment arrives', () => {
    render(<Probe post={build()} />);

    // The content event path bumped the local count for list UX.
    act(() => api.handleTotalCommentChange(6));
    // The snapshot is the authoritative total.
    act(() => api.applyStatsSnapshot({ totalLike: 100, totalComment: 6, totalShare: 2 }));

    // Assignment, not addition, so the two paths cannot compound to 7.
    expect(api.totalComment).toBe(6);
  });

  it('converges totalShare after an optimistic share', () => {
    render(<Probe post={build()} />);

    act(() => api.handleShared());
    expect(api.totalShare).toBe(3);

    // A repeated share by the same user does not move the server total.
    act(() => api.applyStatsSnapshot({ totalLike: 100, totalComment: 5, totalShare: 3 }));

    expect(api.totalShare).toBe(3);
  });

  it('propagates the snapshot so the feed and modal cannot disagree', () => {
    render(<Probe post={build()} />);

    act(() => api.applyStatsSnapshot({ totalLike: 250, totalComment: 9, totalShare: 4 }));

    expect(onInteractionChange).toHaveBeenCalledWith('p1', {
      totalLike: 250, totalComment: 9, totalShare: 4
    });
  });
});
