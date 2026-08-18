import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import { usePostStatsSync } from './use-post-stats-sync';

/**
 * Shared counters must converge on the server's absolute totals, while
 * viewer-specific state is never touched by them.
 */

const handlers = new Map<string, (payload: any) => void>();
jest.mock('src/socket/use-socket-listener', () => ({
  useSocketListener: (event: string, handler: (payload: any) => void, options: any) => {
    if (options?.enabled !== false) handlers.set(event, handler);
    else handlers.delete(event);
  }
}));

let isConnected = true;
jest.mock('src/socket/socket-context', () => ({
  useSocket: () => ({ socket: {}, isConnected })
}));

const mockFindOne = jest.fn();
jest.mock('@services/post.service', () => ({
  findOne: (...args: any[]) => mockFindOne(...args)
}));

const applySnapshot = jest.fn();

function Probe({ postId }: { postId?: string }) {
  usePostStatsSync(postId, applySnapshot);
  return null;
}

function deliver(payload: any) {
  act(() => { handlers.get('post:stats_updated')?.(payload); });
}

function snapshot(overrides: Record<string, any> = {}) {
  return {
    postId: 'p1', totalLike: 101, totalComment: 5, totalShare: 2, version: 2000, ...overrides
  };
}

beforeEach(() => {
  handlers.clear();
  applySnapshot.mockClear();
  mockFindOne.mockResolvedValue({ data: null });
  isConnected = true;
});

describe('applying snapshots to the open post', () => {
  it('applies a snapshot for the post being viewed', async () => {
    render(<Probe postId="p1" />);
    await waitFor(() => expect(mockFindOne).toHaveBeenCalled());
    applySnapshot.mockClear();

    deliver(snapshot());

    expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      postId: 'p1', totalLike: 101, totalComment: 5, totalShare: 2
    }));
  });

  it('ignores a snapshot for a different post', async () => {
    render(<Probe postId="p1" />);
    applySnapshot.mockClear();

    deliver(snapshot({ postId: 'p2', totalLike: 999 }));

    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it('ignores a late snapshot for the post just left', async () => {
    const { rerender } = render(<Probe postId="p1" />);
    rerender(<Probe postId="p2" />);
    applySnapshot.mockClear();

    // P1's snapshot was already in flight when the reader switched.
    deliver(snapshot({ postId: 'p1', totalLike: 999 }));

    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it('carries absolute totals, never a delta', async () => {
    render(<Probe postId="p1" />);
    applySnapshot.mockClear();

    deliver(snapshot({ totalLike: 38291 }));

    const applied = applySnapshot.mock.calls[0][0];
    expect(applied.totalLike).toBe(38291);
    // A delta would make any dropped frame permanent.
    expect(Object.keys(applied).some((key) => /delta/i.test(key))).toBe(false);
  });

  it('never carries viewer-specific state', async () => {
    render(<Probe postId="p1" />);
    applySnapshot.mockClear();

    deliver(snapshot());

    const applied = applySnapshot.mock.calls[0][0];
    // B liking a post says nothing about whether C likes it.
    expect(applied).not.toHaveProperty('isLiked');
    expect(applied).not.toHaveProperty('hasLikedByMe');
  });

  it('subscribes to nothing when no post is open', () => {
    render(<Probe postId={undefined} />);
    expect(handlers.has('post:stats_updated')).toBe(false);
  });
});

describe('stale frame guard', () => {
  it('accepts a newer snapshot', async () => {
    render(<Probe postId="p1" />);
    applySnapshot.mockClear();

    deliver(snapshot({ version: 1000, totalLike: 10 }));
    deliver(snapshot({ version: 2000, totalLike: 20 }));

    expect(applySnapshot).toHaveBeenCalledTimes(2);
    expect(applySnapshot.mock.calls[1][0].totalLike).toBe(20);
  });

  it('ignores a snapshot that arrives after a newer one', async () => {
    render(<Probe postId="p1" />);
    applySnapshot.mockClear();

    deliver(snapshot({ version: 2000, totalLike: 20 }));
    deliver(snapshot({ version: 1000, totalLike: 10 }));

    // The delayed frame must not roll the counters backwards.
    expect(applySnapshot).toHaveBeenCalledTimes(1);
    expect(applySnapshot.mock.calls[0][0].totalLike).toBe(20);
  });

  it('accepts an equal version, since two snapshots in one millisecond cannot be ordered', async () => {
    render(<Probe postId="p1" />);
    applySnapshot.mockClear();

    deliver(snapshot({ version: 2000, totalLike: 20 }));
    deliver(snapshot({ version: 2000, totalLike: 21 }));

    // Absolute values make re-applying harmless, so the safer choice is to apply.
    expect(applySnapshot).toHaveBeenCalledTimes(2);
  });

  it('applies a snapshot with no version at all', async () => {
    render(<Probe postId="p1" />);
    applySnapshot.mockClear();

    deliver(snapshot({ version: undefined, totalLike: 7 }));

    expect(applySnapshot).toHaveBeenCalledTimes(1);
  });

  it('scopes the version to the post, so a switch is not suppressed', async () => {
    const { rerender } = render(<Probe postId="p1" />);
    deliver(snapshot({ postId: 'p1', version: 9000 }));

    rerender(<Probe postId="p2" />);
    applySnapshot.mockClear();

    // P2's first snapshot has a lower version than P1's last; without
    // per-post scoping it would be wrongly discarded.
    deliver(snapshot({ postId: 'p2', version: 100, totalLike: 3 }));

    expect(applySnapshot).toHaveBeenCalledTimes(1);
    expect(applySnapshot.mock.calls[0][0].totalLike).toBe(3);
  });
});

describe('reconnect reconciliation', () => {
  it('fetches the post once on connect', async () => {
    mockFindOne.mockResolvedValue({
      data: {
        totalLike: 42, totalComment: 8, totalShare: 3, updatedAt: '2026-08-14T10:00:00.000Z'
      }
    });

    render(<Probe postId="p1" />);

    await waitFor(() => expect(applySnapshot).toHaveBeenCalledWith(expect.objectContaining({
      totalLike: 42, totalComment: 8, totalShare: 3
    })));
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  it('re-reconciles after a reconnect rather than waiting for a mutation', async () => {
    const { rerender } = render(<Probe postId="p1" />);
    await waitFor(() => expect(mockFindOne).toHaveBeenCalledTimes(1));

    isConnected = false;
    rerender(<Probe postId="p1" />);

    isConnected = true;
    rerender(<Probe postId="p1" />);

    // Snapshots emitted while the socket was down are gone; on a quiet post
    // nothing would ever repair the counters.
    await waitFor(() => expect(mockFindOne).toHaveBeenCalledTimes(2));
  });

  it('does not refetch in a loop', async () => {
    const { rerender } = render(<Probe postId="p1" />);
    await waitFor(() => expect(mockFindOne).toHaveBeenCalledTimes(1));

    rerender(<Probe postId="p1" />);
    rerender(<Probe postId="p1" />);
    deliver(snapshot());

    // Keyed on the connection and the post, not on the counters it writes.
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  it('leaves the counters alone when reconciliation fails', async () => {
    mockFindOne.mockRejectedValue(new Error('offline'));

    render(<Probe postId="p1" />);

    await waitFor(() => expect(mockFindOne).toHaveBeenCalled());
    expect(applySnapshot).not.toHaveBeenCalled();
  });
});
