import { act, render, screen } from '@testing-library/react';

import {
  CommentLiveStatsProvider, CommentLiveStatsStore, useCommentLiveStats
} from './comment-live-stats';

/**
 * The rules that let a viral post stay usable, and stop a late frame rolling a
 * count backwards.
 */
describe('CommentLiveStatsStore', () => {
  const flushFrames = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
  };

  it('keeps the newest snapshot and ignores one that arrives late', () => {
    const store = new CommentLiveStatsStore();

    store.apply('c1', { likesCount: 10, replyCount: 0, revision: 200 });
    store.apply('c1', { likesCount: 9, replyCount: 0, revision: 100 });

    // Absolute snapshots can overtake each other in flight. Applying the older
    // one would visibly roll the count backwards for every viewer.
    expect(store.get('c1')?.likesCount).toBe(10);
  });

  it('ignores a repeat of the snapshot it already holds', () => {
    const store = new CommentLiveStatsStore();
    store.apply('c1', { likesCount: 5, replyCount: 0, revision: 100 });
    store.apply('c1', { likesCount: 99, replyCount: 0, revision: 100 });

    expect(store.get('c1')?.likesCount).toBe(5);
  });

  it('applying the same snapshot twice reaches the same number', () => {
    // Why the HTTP response and the socket echo of one like cannot add up:
    // the value is a total, not a step.
    const store = new CommentLiveStatsStore();
    const snapshot = { likesCount: 3, replyCount: 1, revision: 500 };

    store.apply('c1', snapshot);
    store.apply('c1', { ...snapshot, revision: 501 });

    expect(store.get('c1')?.likesCount).toBe(3);
  });

  it('notifies only the subscribers of the comment that changed', async () => {
    const store = new CommentLiveStatsStore();
    const first = jest.fn();
    const second = jest.fn();
    store.subscribe('c1', first);
    store.subscribe('c2', second);

    store.apply('c1', { likesCount: 1, replyCount: 0, revision: 1 });
    await flushFrames();

    expect(first).toHaveBeenCalled();
    // A like on one comment must not re-render every other row on the post.
    expect(second).not.toHaveBeenCalled();
  });

  it('collapses a burst into one notification carrying the final value', async () => {
    const store = new CommentLiveStatsStore();
    const listener = jest.fn();
    store.subscribe('c1', listener);

    for (let index = 1; index <= 1000; index += 1) {
      store.apply('c1', { likesCount: index, replyCount: 0, revision: index });
    }
    await flushFrames();

    // A thousand snapshots, one render, and the only value that was ever going
    // to be displayed.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get('c1')?.likesCount).toBe(1000);
  });

  it('stops notifying once a row unsubscribes', async () => {
    const store = new CommentLiveStatsStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe('c1', listener);
    unsubscribe();

    store.apply('c1', { likesCount: 1, replyCount: 0, revision: 1 });
    await flushFrames();

    expect(listener).not.toHaveBeenCalled();
  });

  it('forgets everything on reset, so another post starts clean', () => {
    const store = new CommentLiveStatsStore();
    store.apply('c1', { likesCount: 42, replyCount: 0, revision: 1 });

    store.reset();

    expect(store.get('c1')).toBeUndefined();
  });
});

describe('useCommentLiveStats', () => {
  function Row({ commentId, fallback }: { commentId: string; fallback: number }) {
    const stats = useCommentLiveStats(commentId);
    return <span data-testid={commentId}>{stats?.likesCount ?? fallback}</span>;
  }

  it('shows the fetched value until a snapshot arrives', () => {
    render(
      <CommentLiveStatsProvider postId="p1">
        <Row commentId="c1" fallback={7} />
      </CommentLiveStatsProvider>
    );

    // `undefined` has to mean "nothing reported", not zero, or every count
    // would blank on first render.
    expect(screen.getByTestId('c1').textContent).toBe('7');
  });

  it('renders the fetched value with no provider at all', () => {
    // The comment list is used on surfaces that have no live store; it must
    // degrade to the server values rather than crash.
    render(<Row commentId="c1" fallback={4} />);

    expect(screen.getByTestId('c1').textContent).toBe('4');
  });
});
