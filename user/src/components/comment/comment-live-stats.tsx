'use client';

import {
  createContext, ReactNode, useContext, useEffect, useMemo, useRef, useSyncExternalStore
} from 'react';

/** One comment's authoritative counters, as last reported by the server. */
export interface CommentLiveStats {
  likesCount: number;
  replyCount: number;
  /** Server-side write time of the snapshot these numbers came from. */
  revision: number;
}

type Listener = () => void;

/**
 * `requestAnimationFrame` where it exists, a timeout where it does not.
 *
 * Server rendering and jsdom both lack it, and a store that only batches in a
 * real browser would behave differently in the tests that check the batching.
 */
function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle as unknown as NodeJS.Timeout);
}

/**
 * A tiny store for live comment counters, subscribed to per comment.
 *
 * Counters deliberately do **not** live in the comment list's React state. A
 * post can hold hundreds of rendered comments, and putting the numbers in the
 * list would mean every like on any one of them produced a new array and
 * re-rendered the whole tree — the exact behaviour that makes a viral post
 * unusable.
 *
 * Instead each row subscribes to its own id. A snapshot for comment X notifies
 * only the rows showing X, so the cost of a like is one row re-render no matter
 * how long the list is.
 *
 * ## Why writes are batched
 *
 * A burst of likes on one comment would otherwise be a burst of renders. Writes
 * are collected and published once per animation frame, so a thousand snapshots
 * arriving in the same frame cost one render carrying the final value — which is
 * the only value that was ever going to be displayed.
 *
 * ## Why old snapshots are dropped
 *
 * Snapshots are absolute totals and can overtake each other in flight. Applying
 * a stale one would visibly roll a count backwards, so a snapshot older than the
 * one already held is discarded rather than applied.
 */
export class CommentLiveStatsStore {
  private stats = new Map<string, CommentLiveStats>();

  private listeners = new Map<string, Set<Listener>>();

  /** Ids written since the last publish, waiting for the frame to close. */
  private dirty = new Set<string>();

  private frame: number | null = null;

  public subscribe(commentId: string, listener: Listener): () => void {
    const existing = this.listeners.get(commentId) || new Set<Listener>();
    existing.add(listener);
    this.listeners.set(commentId, existing);

    return () => {
      const listeners = this.listeners.get(commentId);
      if (!listeners) return;
      listeners.delete(listener);
      // Dropped when empty so a long session browsing many posts does not
      // accumulate an entry per comment it ever rendered.
      if (!listeners.size) this.listeners.delete(commentId);
    };
  }

  public get(commentId: string): CommentLiveStats | undefined {
    return this.stats.get(commentId);
  }

  /**
   * Record an authoritative snapshot.
   *
   * Ignores anything not strictly newer than what is held, which is what makes
   * out-of-order delivery safe: a late frame cannot undo a newer one.
   */
  public apply(commentId: string, next: CommentLiveStats): void {
    if (!commentId) return;

    const current = this.stats.get(commentId);
    if (current && next.revision <= current.revision) return;

    this.stats.set(commentId, next);
    this.dirty.add(commentId);
    this.scheduleFlush();
  }

  /**
   * Forget everything.
   *
   * Called when the reader moves to another post: counters are per post, and
   * keeping them would let a stale number flash on a comment that happens to be
   * rendered again later.
   */
  public reset(): void {
    this.stats.clear();
    this.dirty.clear();
    if (this.frame !== null) {
      cancelFrame(this.frame);
      this.frame = null;
    }
  }

  private scheduleFlush(): void {
    if (this.frame !== null) return;

    this.frame = requestFrame(() => {
      this.frame = null;
      const ids = [...this.dirty];
      this.dirty.clear();
      ids.forEach((id) => {
        this.listeners.get(id)?.forEach((listener) => listener());
      });
    });
  }
}

const CommentLiveStatsContext = createContext<CommentLiveStatsStore | null>(null);

/**
 * Provide one store for a post's open comment list.
 *
 * Keyed by post so switching posts starts from an empty store rather than
 * inheriting the previous post's numbers.
 */
export function CommentLiveStatsProvider({
  postId,
  children
}: {
  postId?: string | null;
  children: ReactNode;
}) {
  const storeRef = useRef<CommentLiveStatsStore | null>(null);
  if (!storeRef.current) storeRef.current = new CommentLiveStatsStore();
  const store = storeRef.current;

  useEffect(() => {
    store.reset();
    return () => store.reset();
  }, [store, postId]);

  return (
    <CommentLiveStatsContext.Provider value={store}>
      {children}
    </CommentLiveStatsContext.Provider>
  );
}

/** The store for the current comment list, or null outside a provider. */
export function useCommentLiveStatsStore(): CommentLiveStatsStore | null {
  return useContext(CommentLiveStatsContext);
}

/**
 * The live counters for one comment, or `undefined` until one arrives.
 *
 * `undefined` rather than zeroes on purpose: the caller must be able to tell
 * "nothing has been reported" from "reported as zero", so it can keep showing
 * the value it was rendered with instead of blanking the count.
 */
export function useCommentLiveStats(commentId: string): CommentLiveStats | undefined {
  const store = useContext(CommentLiveStatsContext);

  const { subscribe, getSnapshot } = useMemo(() => ({
    subscribe: (listener: Listener) => (store
      ? store.subscribe(commentId, listener)
      : () => { }),
    getSnapshot: () => store?.get(commentId)
  }), [store, commentId]);

  // The server snapshot is deliberately the same reader: there is no live state
  // during SSR, so both must agree on `undefined` or React reports a mismatch.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
