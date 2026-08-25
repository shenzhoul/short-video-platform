import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { useFollowStats } from './use-follow-stats';

/**
 * Three sources feed one pair of numbers — the canonical HTTP response, live
 * snapshots, and a resync after reconnect — and they must not fight.
 */

const listeners = new Map<string, (payload: any) => void>();
let connected = true;

jest.mock('src/socket/socket-context', () => ({
  useSocket: () => ({ socket: {}, isConnected: connected })
}));

jest.mock('src/socket/use-socket-listener', () => ({
  useSocketListener: (event: string, handler: (payload: any) => void, options: any) => {
    if (options?.enabled !== false) listeners.set(event, handler);
  }
}));

const mockGetFollowStats = jest.fn();
jest.mock('@services/user.service', () => ({
  getFollowStats: (...args: any[]) => mockGetFollowStats(...args)
}));

const FOLLOW_STATS_UPDATED = 'user:follow_stats_updated';

let latest: ReturnType<typeof useFollowStats>;

function Probe({ userId, followers, following }: {
  userId?: string | null; followers: number; following: number;
}) {
  latest = useFollowStats({
    userId,
    initial: { followersCount: followers, followingCount: following }
  });
  return (
    <span data-testid="counts">
      {latest.followersCount}
      /
      {latest.followingCount}
    </span>
  );
}

const emit = async (payload: any) => {
  await act(async () => {
    listeners.get(FOLLOW_STATS_UPDATED)?.(payload);
  });
};

const counts = () => screen.getByTestId('counts').textContent;

beforeEach(() => {
  listeners.clear();
  connected = true;
  mockGetFollowStats.mockReset();
  // Inert by default: the hook ignores a body with no data, so the resync
  // cannot quietly overwrite what a test is actually asserting about.
  mockGetFollowStats.mockResolvedValue({ data: null });
});

describe('useFollowStats', () => {
  it('renders the canonical counts it was given', () => {
    render(<Probe userId="me" followers={12} following={3} />);
    expect(counts()).toBe('12/3');
  });

  it('applies a live snapshot for this user', async () => {
    render(<Probe userId="me" followers={12} following={3} />);

    await emit({
      userId: 'me', followersCount: 13, followingCount: 3, revision: 100
    });

    expect(counts()).toBe('13/3');
  });

  it('ignores a snapshot for somebody else', async () => {
    render(<Probe userId="me" followers={12} following={3} />);

    await emit({
      userId: 'someone-else', followersCount: 999, followingCount: 999, revision: 100
    });

    expect(counts()).toBe('12/3');
  });

  it('discards a snapshot that arrived late', async () => {
    render(<Probe userId="me" followers={1} following={1} />);

    await emit({
      userId: 'me', followersCount: 10, followingCount: 1, revision: 200
    });
    await emit({
      userId: 'me', followersCount: 5, followingCount: 1, revision: 100
    });

    // Absolute snapshots can overtake each other; applying the older one would
    // visibly roll the count backwards.
    expect(counts()).toBe('10/1');
  });

  it('does not add an optimistic step to the server total', async () => {
    // The whole reason snapshots are absolute: the local +1 and the server's
    // own count of the same follow must settle on one number, not two.
    render(<Probe userId="me" followers={4} following={0} />);

    await act(async () => { latest.applyDelta({ followersCount: 1 }); });
    expect(counts()).toBe('5/0');

    await emit({
      userId: 'me', followersCount: 5, followingCount: 0, revision: 100
    });
    expect(counts()).toBe('5/0');
  });

  it('rolls an optimistic step back with its inverse', async () => {
    render(<Probe userId="me" followers={4} following={0} />);

    await act(async () => { latest.applyDelta({ followersCount: 1 }); });
    await act(async () => { latest.applyDelta({ followersCount: -1 }); });

    expect(counts()).toBe('4/0');
  });

  it('never shows a negative count', async () => {
    render(<Probe userId="me" followers={0} following={0} />);

    await act(async () => { latest.applyDelta({ followersCount: -1 }); });

    expect(counts()).toBe('0/0');
  });

  it('refetches the canonical counts once connected', async () => {
    mockGetFollowStats.mockResolvedValue({
      data: { followersCount: 77, followingCount: 8 }
    });

    render(<Probe userId="me" followers={1} following={1} />);

    await waitFor(() => expect(counts()).toBe('77/8'));
    expect(mockGetFollowStats).toHaveBeenCalledWith('me');
  });

  it('lets a resync overrule a newer-looking revision', async () => {
    // A reconnect means frames were missed, so the fresh read is the truth even
    // though it carries no revision of its own. Held open deliberately so the
    // live frame is applied first and the ordering is the one under test.
    let resolveFetch: (value: any) => void = () => { };
    mockGetFollowStats.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    render(<Probe userId="me" followers={1} following={1} />);
    await emit({
      userId: 'me', followersCount: 2, followingCount: 1, revision: 9999
    });
    expect(counts()).toBe('2/1');

    await act(async () => {
      resolveFetch({ data: { followersCount: 50, followingCount: 4 } });
    });

    await waitFor(() => expect(counts()).toBe('50/4'));
  });

  it('does not refetch a whole profile for a socket frame', async () => {
    render(<Probe userId="me" followers={1} following={1} />);
    await waitFor(() => expect(mockGetFollowStats).toHaveBeenCalledTimes(1));

    await emit({
      userId: 'me', followersCount: 2, followingCount: 1, revision: 10
    });
    await emit({
      userId: 'me', followersCount: 3, followingCount: 1, revision: 20
    });

    // The frame carries the totals; nothing needs fetching to apply it.
    expect(mockGetFollowStats).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all without a user', () => {
    render(<Probe userId={null} followers={0} following={0} />);
    expect(mockGetFollowStats).not.toHaveBeenCalled();
  });

  it('keeps the rendered counts when the resync fails', async () => {
    mockGetFollowStats.mockRejectedValue(new Error('offline'));

    render(<Probe userId="me" followers={9} following={2} />);
    await waitFor(() => expect(mockGetFollowStats).toHaveBeenCalled());

    // A missed correction is not a reason to blank a number on screen.
    expect(counts()).toBe('9/2');
  });
});
