'use client';

import { useCommentLiveStatsStore } from '@components/comment/comment-live-stats';
import { IComment } from '@interfaces/comment';
import { useCallback, useRef, useState } from 'react';
import { useSocketListener } from 'src/socket/use-socket-listener';

const COMMENT_CREATED = 'post:comment_created';
const REPLY_CREATED = 'post:reply_created';
const COMMENT_DELETED = 'post:comment_deleted';
const COMMENT_STATS_UPDATED = 'post:comment_stats_updated';

/**
 * How incoming comments are absorbed without disrupting the reader.
 *
 * Auto-insert is only ever a courtesy for someone already sitting at the newest
 * comments during quiet traffic. Everything else queues behind a count, because
 * the two failure modes to avoid are pushing content out from under a reader and
 * turning a viral post into hundreds of DOM insertions per second.
 */
export const LIVE_COMMENT_POLICY = {
  /**
   * Auto-insert only while arrivals stay below this many inside the window.
   * Above it the post is busy enough that inserting would thrash the list, so
   * arrivals collapse into a count instead.
   */
  AUTO_INSERT_BURST_LIMIT: 3,
  /** Window the burst is measured over. */
  BURST_WINDOW_MS: 2000
} as const;

interface UsePostLiveCommentsOptions {
  postId?: string | null;
  /** False while the reader is scrolled away from the newest comments. */
  atNewest: boolean;
  /** Insert a comment that arrived live at the top of the list. */
  onInsert: (comment: IComment) => void;
  /** Drop a comment that was removed elsewhere. */
  onRemove: (commentId: string) => void;
  /** A thread on this post gained a reply. Carries the parent's id. */
  onThreadGrew?: (parentCommentId?: string) => void;
}

/**
 * Apply a post's live comment events to the open comment list.
 *
 * Deletions are always applied immediately — a comment that no longer exists
 * must not stay on screen, and removing one cannot push anything the reader is
 * looking at further down.
 */
export function usePostLiveComments({
  postId,
  atNewest,
  onInsert,
  onRemove,
  onThreadGrew
}: UsePostLiveCommentsOptions) {
  const statsStore = useCommentLiveStatsStore();
  const [pending, setPending] = useState<IComment[]>([]);
  // Events already applied. A queue retry redelivers the same comment id, and
  // the reader must not see it twice.
  const seenRef = useRef<Set<string>>(new Set());
  // Arrival timestamps inside the current window, for the burst check.
  const recentRef = useRef<number[]>([]);

  const isBursting = useCallback(() => {
    const now = Date.now();
    recentRef.current = recentRef.current.filter(
      (at) => now - at < LIVE_COMMENT_POLICY.BURST_WINDOW_MS
    );
    recentRef.current.push(now);
    return recentRef.current.length > LIVE_COMMENT_POLICY.AUTO_INSERT_BURST_LIMIT;
  }, []);

  useSocketListener<any>(COMMENT_CREATED, (payload) => {
    if (!postId || payload?.postId !== postId) return;
    const comment = payload.comment as IComment;
    if (!comment?._id || seenRef.current.has(comment._id)) return;
    seenRef.current.add(comment._id);

    // Queue unless the reader is at the newest comments AND traffic is calm.
    // Either condition failing means inserting would move content under them.
    if (!atNewest || isBursting()) {
      setPending((current) => [comment, ...current]);
      return;
    }
    onInsert(comment);
  }, { enabled: Boolean(postId) });

  /**
   * A thread on this post grew.
   *
   * Carries no reply body by design — that goes to the thread room, to the
   * people actually reading it. Nothing is inserted here, and nothing needs to
   * be: the parent's new reply count arrives in the coalesced snapshot below and
   * moves the "Expand N replies" control, whether the thread is open or not.
   *
   * Listened to anyway rather than dropped, because it is what tells a reader
   * with the thread *open* that they are about to receive one, and because
   * ignoring an event the server sends is how a contract quietly rots.
   */
  useSocketListener<any>(REPLY_CREATED, (payload) => {
    if (!postId || payload?.postId !== postId) return;
    onThreadGrew?.(payload.parentCommentId);
  }, { enabled: Boolean(postId) });

  /**
   * Authoritative counters for one comment.
   *
   * Absolute totals, never deltas, so this is also what makes the local
   * optimistic like and the server's own echo agree instead of adding up: the
   * snapshot states the total outright, and applying it twice reaches the same
   * number. Writes land in the shared store rather than in this hook's state, so
   * only the row for that comment re-renders.
   */
  useSocketListener<any>(COMMENT_STATS_UPDATED, (payload) => {
    if (!postId || payload?.postId !== postId || !payload.commentId) return;
    statsStore?.apply(payload.commentId, {
      likesCount: payload.likesCount || 0,
      replyCount: payload.replyCount || 0,
      revision: payload.revision || 0
    });
  }, { enabled: Boolean(postId) });

  useSocketListener<any>(COMMENT_DELETED, (payload) => {
    if (!postId || payload?.postId !== postId || !payload.commentId) return;
    // Applied immediately: removing a row cannot push content under the reader,
    // and leaving a deleted comment visible is worse than a small reflow.
    onRemove(payload.commentId);
    setPending((current) => current.filter((item) => item._id !== payload.commentId));
  }, { enabled: Boolean(postId) });

  /**
   * Reveal what arrived while the reader was busy.
   *
   * Inserts the buffered comments the reader was actually told about. The count
   * shown and the rows revealed therefore always match, and the canonical cursor
   * pages are left untouched.
   */
  const revealPending = useCallback(() => {
    setPending((current) => {
      [...current].reverse().forEach(onInsert);
      return [];
    });
  }, [onInsert]);

  return { pendingCount: pending.length, revealPending };
}
