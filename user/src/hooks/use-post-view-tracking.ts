'use client';

import { PostInteractionChangeHandler } from '@hooks/use-post-interactions';
import { recordPostView } from '@services/post.service';
import { useEffect, useRef } from 'react';

/** Records each post once while a detail modal remains mounted. */
export function usePostViewTracking(
  postId: string | undefined,
  onInteractionChange?: PostInteractionChangeHandler
) {
  const trackedPostIdsRef = useRef(new Set<string>());
  const onInteractionChangeRef = useRef(onInteractionChange);
  onInteractionChangeRef.current = onInteractionChange;

  useEffect(() => {
    if (!postId || trackedPostIdsRef.current.has(postId)) return;
    trackedPostIdsRef.current.add(postId);

    recordPostView(postId)
      .then((response) => {
        if (typeof response.data?.totalView !== 'number') return;
        onInteractionChangeRef.current?.(postId, { totalView: response.data.totalView });
      })
      .catch(() => {
        trackedPostIdsRef.current.delete(postId);
      });
  }, [postId]);
}
