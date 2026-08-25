'use client';

import { getFollowStats } from '@services/user.service';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from 'src/socket/socket-context';
import { useSocketListener } from 'src/socket/use-socket-listener';

/** Server -> the user's own sockets. Mirrors USER_STATS_EVENTS in the API. */
const FOLLOW_STATS_UPDATED = 'user:follow_stats_updated';

export interface FollowStats {
  followersCount: number;
  followingCount: number;
}

interface UseFollowStatsOptions {
  /** Whose counters these are. */
  userId?: string | null;
  /** Counts the page was rendered with, from the canonical profile response. */
  initial: FollowStats;
}

export interface FollowStatsResult extends FollowStats {
  /**
   * Move the counters locally, before the server has confirmed.
   *
   * Needed because a live snapshot only ever reaches the person the counts
   * belong to. Following somebody from *their* profile changes a number this
   * viewer is looking at but will never be sent — so the page has to show it
   * itself. Pass the inverse to roll back a failed mutation.
   *
   * Any later authoritative value replaces the whole state, so an optimistic
   * step and the server's total cannot end up added together.
   */
  applyDelta: (delta: Partial<{ followersCount: number; followingCount: number }>) => void;
}

/**
 * One user's follow counters, kept current without polling.
 *
 * The numbers arrive from three places and they must not fight:
 *
 * - the **canonical HTTP response** the page was rendered with, which is the
 *   truth at load time;
 * - **live snapshots**, sent only to the user the counts belong to;
 * - a **resynchronising fetch** after a reconnect, because a socket that was
 *   away missed whatever happened while it was gone.
 *
 * All three deliver absolute totals, never steps. That is what makes them safe
 * to interleave: an HTTP response and a socket echo describing the same follow
 * settle on the same number instead of adding up, and a client that missed a
 * frame is corrected by the next one rather than drifting further away.
 *
 * A snapshot older than the one already held is discarded, so a frame that
 * overtook a newer one cannot roll a count backwards.
 */
export function useFollowStats({ userId, initial }: UseFollowStatsOptions): FollowStatsResult {
  const { isConnected } = useSocket();
  const [stats, setStats] = useState<FollowStats>(initial);
  // Server time of the newest snapshot applied. An HTTP read has no revision of
  // its own, so it resets this: it is a fresh read of the same source and must
  // not be held back by a frame that arrived before it.
  const revisionRef = useRef(0);

  const initialFollowers = initial.followersCount;
  const initialFollowing = initial.followingCount;

  useEffect(() => {
    revisionRef.current = 0;
    setStats({ followersCount: initialFollowers, followingCount: initialFollowing });
  }, [userId, initialFollowers, initialFollowing]);

  const apply = useCallback((next: FollowStats, revision: number) => {
    if (revision && revision < revisionRef.current) return;
    revisionRef.current = revision;
    setStats((current) => (
      current.followersCount === next.followersCount
        && current.followingCount === next.followingCount
        ? current
        : next
    ));
  }, []);

  useSocketListener<any>(FOLLOW_STATS_UPDATED, (payload) => {
    if (!userId || payload?.userId !== userId) return;
    apply({
      followersCount: payload.followersCount || 0,
      followingCount: payload.followingCount || 0
    }, payload.revision || 0);
  }, { enabled: Boolean(userId) });

  /**
   * Resynchronise after the connection comes back.
   *
   * Room membership and delivery both stop while a socket is away, so anything
   * that happened in the gap was never sent. Two counters are refetched rather
   * than the whole profile — the point of the dedicated endpoint.
   */
  useEffect(() => {
    if (!userId || !isConnected) return;

    let cancelled = false;
    void getFollowStats(userId)
      .then((response: any) => {
        if (cancelled) return;
        const data = response?.data;
        if (!data) return;
        // A fresh authoritative read outranks anything held, so the revision
        // guard is reset rather than compared against.
        revisionRef.current = 0;
        apply({
          followersCount: data.followersCount || 0,
          followingCount: data.followingCount || 0
        }, 0);
      })
      .catch(() => {
        // The rendered counts stay as they are. A failed resync is a missed
        // correction, not a reason to blank a number the user is looking at.
      });

    return () => {
      cancelled = true;
    };
  }, [userId, isConnected, apply]);

  const applyDelta = useCallback((delta: Partial<{ followersCount: number; followingCount: number }>) => {
    setStats((current) => ({
      followersCount: Math.max(0, current.followersCount + (delta.followersCount || 0)),
      followingCount: Math.max(0, current.followingCount + (delta.followingCount || 0))
    }));
  }, []);

  return { ...stats, applyDelta };
}
