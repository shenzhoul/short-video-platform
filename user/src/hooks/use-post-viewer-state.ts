'use client';

import { publishPostInteraction } from '@lib/post-interaction-bus';
import { findOne } from '@services/post.service';
import { useEffect, useRef } from 'react';

/**
 * Hydrate the **viewer's own** state for a post the modal has just opened.
 *
 * ## Why the modal cannot trust the post it was handed
 *
 * `isLiked` is viewer-specific: the API only sets it when the request carried
 * an authenticated user (`ContentService.populatePostData` → `setIsLiked`).
 * Every listing that forgets to thread the viewer through answers with
 * `isLiked: false` and a perfectly correct `totalLike`, because the total is an
 * aggregate on the document.
 *
 * That shipped. `SearchService.searchAll` — the Summary tab, the default
 * search — called `searchPosts(...)` without its `user` argument while the
 * `type=post` branch passed it. Opening an already-liked post from Summary
 * search showed the right total with a **white heart**; the same post opened
 * from the creator grid showed it red. The server bug is fixed, but a heart
 * that silently lies is a bad failure mode to leave one forgotten argument away
 * from returning.
 *
 * So the modal asks for the canonical post once per open and applies the
 * viewer-specific answer through the shared interaction bus, which corrects
 * every mounted copy at the same time. It is a *correction*, not the initial
 * render: the post it was handed still paints immediately, so a source that was
 * already right shows no flicker at all.
 *
 * Deliberately separate from `usePostStatsSync`, which reconciles the *shared*
 * counters from socket snapshots and must never take `isLiked` from them — B
 * liking a post says nothing about whether C does. This hook only ever applies
 * an answer to a request made as *this* viewer.
 */
export function usePostViewerStateHydration(postId: string | undefined, enabled = true) {
  /** Post ids already hydrated in this mount, so navigating back is not a second fetch. */
  const hydratedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !postId) return undefined;
    if (hydratedRef.current.has(postId)) return undefined;
    hydratedRef.current.add(postId);

    let cancelled = false;
    void findOne(postId)
      .then((response) => {
        const post = response?.data;
        if (cancelled || !post || post._id !== postId) return;
        publishPostInteraction(postId, {
          isLiked: Boolean(post.isLiked),
          totalLike: post.totalLike || 0,
          totalComment: post.totalComment || 0,
          totalShare: post.totalShare || 0
        });
      })
      .catch(() => {
        // The post already on screen keeps whatever state it arrived with. A
        // failed correction must never blank a heart or a counter — and the id
        // is left marked so a flapping network cannot retry in a loop.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, postId]);
}
