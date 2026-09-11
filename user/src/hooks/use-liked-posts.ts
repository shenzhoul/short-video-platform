'use client';

import { POST_PAGE_LIMIT } from '@constants/pagination';
import { toast } from '@douyin-clone/shared-toast';
import type { CursorInfo } from '@interfaces/pagination';
import { IPost, PostInteractionPatch } from '@interfaces/post';
import { applyPostInteractionPatchToPosts } from '@lib/post-interactions';
import { likedPosts as getLikedPosts, unlikePosts as unlikePostsService } from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseLikedPostsOptions {
  enabled: boolean;
  limit?: number;
  /**
   * Show a toast when a page fails to load. On by default for the profile tab;
   * the account menu turns it off and draws its own inline retry, because a
   * menu opened by hovering should not raise a toast.
   */
  notifyOnError?: boolean;
}

function appendUniquePosts(current: IPost[], incoming: IPost[]) {
  const posts = new Map(current.map((post) => [post._id, post]));
  incoming.forEach((post) => posts.set(post._id, post));
  return [...posts.values()];
}

export function useLikedPosts({ enabled, limit = POST_PAGE_LIMIT, notifyOnError = true }: UseLikedPostsOptions) {
  const [posts, setPosts] = useState<IPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(null);
  const [isUnliking, setIsUnliking] = useState(false);
  /** A first page has come back, successfully or not: "nothing yet" versus "nothing". */
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState(false);
  const loadingRef = useRef(false);
  const previousEnabledRef = useRef(false);
  const likedPostIdsRef = useRef<Set<string>>(new Set());
  /**
   * Whether the first page has ever been requested.
   *
   * Separate from `posts.length` so an account with no likes is still counted
   * as loaded and does not re-request on every return to the tab.
   */
  const startedRef = useRef(false);

  const loadPage = useCallback(async (cursor: CursorInfo | null = null, mode: 'append' | 'replace' = 'append') => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    try {
      const response = await getLikedPosts({
        limit,
        ...(cursor ? {
          cursor: cursor.id,
          lastCreatedAt: cursor.createdAt.toString()
        } : {})
      });
      const page = response.data;
      const incoming = page?.data || [];

      setPosts((current) => (mode === 'replace' ? incoming : appendUniquePosts(current, incoming)));
      setTotal((current) => typeof page?.total === 'number'
        ? page.total
        : cursor ? current : incoming.length);
      setNextCursor(page?.nextCursor || null);
      setHasMore(Boolean(page?.hasMore));
      setError(false);
    } catch {
      setError(true);
      if (notifyOnError) toast.error('Failed to load liked posts');
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setHasLoaded(true);
    }
  }, [limit, notifyOnError]);

  /**
   * Load the first page the first time the tab is opened, and only then.
   *
   * Re-requesting page one on every return to the tab looks harmless — the
   * merge de-duplicates, so nothing appears twice — but it rewinds `nextCursor`
   * and `hasMore` to the *first* page's values. After paging to the end of 67
   * liked posts, leaving the tab and coming back would set the cursor back to
   * item 20 and claim there was more to fetch, so the next three scrolls would
   * re-fetch pages the list already held before it could grow again.
   */
  useEffect(() => {
    const becameEnabled = enabled && !previousEnabledRef.current;
    previousEnabledRef.current = enabled;
    if (!becameEnabled || startedRef.current) return;
    startedRef.current = true;
    void loadPage();
  }, [enabled, loadPage]);

  useEffect(() => {
    likedPostIdsRef.current = new Set(posts.map((post) => post._id));
  }, [posts]);

  const loadMore = useCallback(() => {
    if (!enabled || loadingRef.current || !hasMore || !nextCursor) return;
    void loadPage(nextCursor);
  }, [enabled, hasMore, loadPage, nextCursor]);

  /**
   * Read the first page again and replace what is held.
   *
   * For a short list that must be current each time it is shown — the account
   * menu's three most recent likes, re-read on every opening so a like or unlike
   * made anywhere since is reflected. The paginated profile tab never calls it:
   * replacing would drop the pages already loaded and rewind the cursor (see
   * the load-once effect above). An in-flight request is not duplicated.
   */
  const refresh = useCallback(() => {
    startedRef.current = true;
    void loadPage(null, 'replace');
  }, [loadPage]);

  const unlikePosts = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return [];

    const confirmation = uniqueIds.length === 1
      ? 'Remove this post from your likes?'
      : `Remove ${uniqueIds.length} posts from your likes?`;
    if (!window.confirm(confirmation)) return [];

    setIsUnliking(true);
    try {
      const response = await unlikePostsService(uniqueIds);
      const unlikedIds = response.data?.removedPostIds || uniqueIds;
      const unlikedIdSet = new Set(unlikedIds);
      unlikedIds.forEach((postId) => likedPostIdsRef.current.delete(postId));
      setPosts((current) => current.filter((post) => !unlikedIdSet.has(post._id)));
      setTotal((current) => Math.max(0, current - unlikedIds.length));
      toast.success(unlikedIds.length === 1
        ? 'Post removed from likes'
        : `${unlikedIds.length} posts removed from likes`);
      return unlikedIds;
    } catch (error: any) {
      toast.error(error?.message || 'Posts could not be removed from likes. Please try again.');
      return [];
    } finally {
      setIsUnliking(false);
    }
  }, []);

  const updatePostInteraction = useCallback((postId: string, patch: PostInteractionPatch) => {
    if (patch.isLiked === false) {
      likedPostIdsRef.current.delete(postId);
      setPosts((current) => current.filter((post) => post._id !== postId));
      setTotal((current) => Math.max(0, current - 1));
      return;
    }
    setPosts((current) => applyPostInteractionPatchToPosts(current, postId, patch));
  }, []);

  const upsertLikedPost = useCallback((post: IPost, patch: PostInteractionPatch) => {
    const isNew = !likedPostIdsRef.current.has(post._id);
    likedPostIdsRef.current.add(post._id);
    setPosts((current) => {
      const existing = current.some((item) => item._id === post._id);
      if (existing) return applyPostInteractionPatchToPosts(current, post._id, patch);
      return [{ ...post, ...patch, isLiked: true }, ...current];
    });
    if (isNew) setTotal((current) => current + 1);
  }, []);

  return {
    posts,
    total,
    loading,
    hasLoaded,
    error,
    hasMore,
    loadMore,
    refresh,
    unlikePosts,
    isUnliking,
    updatePostInteraction,
    upsertLikedPost
  };
}
