'use client';

import { IComment } from '@interfaces/comment';
import { fetchHotComment } from '@services/comment.service';
import { useCallback, useEffect, useState } from 'react';
import { useSocketListener } from 'src/socket/use-socket-listener';

/**
 * The post's most-liked comment, shown to its owner above the canonical list.
 *
 * The ranking lives entirely on the server — this only asks for the answer, so
 * the promotion rule cannot drift between client and backend, and a non-owner
 * simply receives null rather than a hidden extra comment.
 *
 * Refetched rather than subscribed per comment: comment likes do not move any
 * post-level counter, so no existing snapshot announces them, and one listener
 * per comment would be exactly the storm the room design avoids. A post-room
 * event that indicates *something* changed is enough to re-ask a single cheap
 * query.
 */
export function useHotComment(postId?: string | null, enabled = true) {
  const [comment, setComment] = useState<IComment | null>(null);

  const refresh = useCallback(async () => {
    if (!postId || !enabled) {
      setComment(null);
      return;
    }
    try {
      const response = await fetchHotComment(postId);
      setComment((response?.data?.comment as IComment) || null);
    } catch {
      // A failed lookup just leaves the slot empty; the canonical list is
      // unaffected and the next refresh can recover it.
      setComment(null);
    }
  }, [postId, enabled]);

  useEffect(() => {
 void refresh();
}, [refresh]);

  // A comment appearing or disappearing can change which comment is hottest.
  useSocketListener<any>('post:comment_created', (payload) => {
    if (payload?.postId === postId) void refresh();
  }, { enabled: Boolean(postId) && enabled });

  useSocketListener<any>('post:comment_deleted', (payload) => {
    if (payload?.postId === postId) void refresh();
  }, { enabled: Boolean(postId) && enabled });

  return { hotComment: comment, refreshHotComment: refresh };
}
