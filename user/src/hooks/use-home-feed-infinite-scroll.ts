'use client';

import { POST_PAGE_LIMIT } from '@constants/pagination';
import { IPost, PostInteractionPatch } from '@interfaces/post';
import { getPersonalizedHomePosts } from '@services/post.service';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { usePostInteractionUpdater } from './use-post-interactions';

interface CursorInfo {
  id: string;
  createdAt: number;
}

interface UseHomeFeedInfiniteScrollProps {
  initialData?: {
    data: IPost[];
    hasMore: boolean;
    nextCursor?: CursorInfo | null;
    total: number;
  } | null;
  enabled?: boolean;
  /** Restrict the feed to one content category. Empty means "All". */
  topicKey?: string;
}

interface UseHomeFeedInfiniteScrollReturn {
  posts: IPost[];
  hasMore: boolean;
  loading: boolean;
  loadMore: () => void;
  total: number;
  error: string | null;
  updatePostInteraction: (postId: string, patch: PostInteractionPatch) => void;
}

export function useHomeFeedInfiniteScroll({
  initialData,
  enabled = true,
  topicKey = ''
}: UseHomeFeedInfiniteScrollProps): UseHomeFeedInfiniteScrollReturn {
  const [posts, setPosts] = useState<IPost[]>(initialData?.data || []);
  const [hasMore, setHasMore] = useState<boolean>(initialData?.hasMore ?? true);
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(initialData?.nextCursor || null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const updatePostInteraction = usePostInteractionUpdater(setPosts);
  const params = useSearchParams();
  const pathname = usePathname();

  /**
   * Sequence number of the most recently *started* request.
   *
   * Rapid category switching leaves several requests in flight at once, and they can resolve out of
   * order. Every response checks this before touching state, so only the newest request can apply
   * its results — an older one that lands later is discarded instead of overwriting the newer
   * category. This also owns the loading flag, so a stale request finishing cannot clear (or strand)
   * the loading state belonging to a newer one.
   */
  const requestIdRef = useRef(0);
  const loadingRef = useRef(false);
  // The topic whose results are currently loaded. `null` means nothing has been fetched yet, which
  // is the case on mount when the server did not provide initial data.
  const loadedTopicRef = useRef<string | null>(initialData ? topicKey : null);

  const fetchPage = useCallback(async (cursor: CursorInfo | null, reset: boolean) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const query: Record<string, any> = {
        limit: POST_PAGE_LIMIT,
        offset: 0,
        sortBy: 'createdAt',
        sort: 'desc',
        ...(topicKey ? { topicKey } : {}),
        ...(cursor ? {
          cursor: cursor.id,
          lastCreatedAt: new Date(cursor.createdAt).toISOString()
        } : {})
      };

      const response = await getPersonalizedHomePosts(query);
      // A newer request has started since this one; its results are the ones that matter.
      if (requestId !== requestIdRef.current) return;

      const page = response?.data || {};
      const incoming: IPost[] = page.data || [];

      setPosts(current => (reset
        ? incoming
        : Array.from(new Map([...current, ...incoming].map(post => [post._id, post])).values())));
      setHasMore(Boolean(page.hasMore));
      setNextCursor(page.nextCursor || null);

      if (cursor) {
        const nextParams = new URLSearchParams(params.toString());
        nextParams.set('cursor', cursor.id);
        nextParams.set('lastCreatedAt', cursor.createdAt.toString());
        window.history.replaceState({ ...window.history.state }, '', `${pathname}?${nextParams.toString()}`);
      }
    } catch {
      if (requestId !== requestIdRef.current) return;
      setError(reset ? 'Failed to load posts' : 'Failed to load more posts');
    } finally {
      // Only the newest request may release the loading flag, otherwise an older response finishing
      // second would clear the flag while the current request is still running.
      if (requestId === requestIdRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [params, pathname, topicKey]);

  // Category changes reset the list and start a fresh first page. Keyed off a ref rather than
  // `posts.length` so a category that legitimately returns zero posts can still be re-fetched later,
  // and so a stale response can never suppress the load for the current category.
  useEffect(() => {
    if (!enabled) return;
    if (loadedTopicRef.current === topicKey) return;

    loadedTopicRef.current = topicKey;
    setPosts([]);
    setNextCursor(null);
    setHasMore(true);
    void fetchPage(null, true);
  }, [enabled, fetchPage, topicKey]);

  const loadMore = useCallback(() => {
    if (!enabled || loadingRef.current || !hasMore || !nextCursor) return;
    void fetchPage(nextCursor, false);
  }, [enabled, fetchPage, hasMore, nextCursor]);

  return {
    posts,
    hasMore,
    loading,
    loadMore,
    total: initialData?.total || posts.length,
    error,
    updatePostInteraction
  };
}
