'use client';

import { findOne } from '@services/post.service';
import { useCallback, useEffect, useRef } from 'react';
import { useSocket } from 'src/socket/socket-context';
import { useSocketListener } from 'src/socket/use-socket-listener';

const STATS_UPDATED = 'post:stats_updated';

export interface PostStatsSnapshot {
  postId: string;
  totalLike: number;
  totalComment: number;
  totalShare: number;
  /** Post.updatedAt in ms. Not a strict sequence — see the ordering note below. */
  version?: number;
  at?: string;
}

/**
 * Keeps the open post's shared counters reconciled to the server.
 *
 * Owns no state of its own: it feeds the snapshot into whichever state the
 * caller already uses for the post, so the video stage, the detail panel and the
 * action rail all move together instead of disagreeing.
 *
 * Two jobs, both about not trusting the client for shared numbers:
 *
 * - apply authoritative snapshots as they arrive;
 * - after a reconnect, fetch once, because any snapshot emitted while the socket
 *   was down is simply gone and waiting for the next mutation could leave the
 *   counters wrong indefinitely on a quiet post.
 */
export function usePostStatsSync(
  postId: string | undefined,
  applySnapshot: (snapshot: PostStatsSnapshot) => void
) {
  const { isConnected } = useSocket();
  /**
   * Highest version applied for the post currently open.
   *
   * `version` is `Post.updatedAt` in milliseconds, which is monotonic per
   * document under a single writer but is NOT a strict sequence across
   * instances with clock skew. So the guard is deliberately narrow: reject a
   * snapshot strictly older than one already applied, and accept equal
   * versions, since two snapshots sharing a millisecond cannot be ordered and
   * absolute values make re-applying harmless.
   */
  const lastVersionRef = useRef<number | null>(null);
  const lastPostIdRef = useRef<string | undefined>(undefined);

  // Version numbers only mean something within one post, so switching posts
  // must not let P1's version suppress P2's first snapshot.
  if (lastPostIdRef.current !== postId) {
    lastPostIdRef.current = postId;
    lastVersionRef.current = null;
  }

  const applyIfFresh = useCallback((snapshot: PostStatsSnapshot) => {
    const version = typeof snapshot.version === 'number' ? snapshot.version : null;
    if (version !== null && lastVersionRef.current !== null && version < lastVersionRef.current) {
      // A snapshot that lost a race in flight; the newer one already applied.
      return;
    }
    if (version !== null) lastVersionRef.current = version;
    applySnapshot(snapshot);
  }, [applySnapshot]);

  useSocketListener<PostStatsSnapshot>(STATS_UPDATED, (snapshot) => {
    // Rooms are per post, but a snapshot for the post being left can still be
    // in flight during a switch, and it must never overwrite the new one.
    if (!postId || snapshot?.postId !== postId) return;
    applyIfFresh(snapshot);
  }, { enabled: Boolean(postId) });

  useEffect(() => {
    if (!postId || !isConnected) return;

    // Runs on connect and on every reconnect, never in a loop: the effect is
    // keyed on the connection and the post, not on the counters it writes.
    let cancelled = false;
    void findOne(postId)
      .then((response) => {
        const post = response?.data;
        if (cancelled || !post) return;
        applyIfFresh({
          postId,
          totalLike: post.totalLike || 0,
          totalComment: post.totalComment || 0,
          totalShare: post.totalShare || 0,
          version: post.updatedAt ? new Date(post.updatedAt).getTime() : undefined
        });
      })
      .catch(() => {
        // The counters on screen stay as they were; the next snapshot corrects
        // them. A failed reconciliation must not blank the UI.
      });

    return () => {
      cancelled = true;
    };
  }, [postId, isConnected, applyIfFresh]);
}
