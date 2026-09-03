'use client';

import { POST_PAGE_LIMIT } from '@constants/pagination';
import { IPost, PostInteractionPatch } from '@interfaces/post';
import { getRecommendationAnonymousId } from '@lib/recommendation-anonymous-id';
import { getPersonalizedHomePosts } from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';

import { usePostInteractionUpdater } from './use-post-interactions';

interface UseHomeFeedInfiniteScrollProps {
  initialData?: {
    data: IPost[];
    hasMore: boolean;
    sessionId?: string;
    nextCursor?: string | null;
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
  /** Starts a brand-new recommendation session with a fresh mix/order — "Refresh recommendations". */
  refresh: () => Promise<void>;
  sessionId: string | null;
  total: number;
  error: string | null;
  updatePostInteraction: (postId: string, patch: PostInteractionPatch) => void;
}

/**
 * Home is a recommendation feed, not a chronological one: each session's
 * ranked order is generated once server-side and stored in Redis
 * (`RecommendationSessionService`), so pagination here is a stateless
 * `sessionId` + opaque `cursor` walk through that fixed order — never a
 * client-side re-sort and never a second scoring pass per page.
 *
 * Reload semantics: omitting `sessionId` (the initial mount, or `refresh()`)
 * always starts a new session with a new mix; continuing an existing
 * `sessionId` always returns the same stable order, so `loadMore` can never
 * duplicate or skip a post within one session.
 */
export function useHomeFeedInfiniteScroll({
  initialData,
  enabled = true,
  topicKey = ''
}: UseHomeFeedInfiniteScrollProps): UseHomeFeedInfiniteScrollReturn {
  const [posts, setPosts] = useState<IPost[]>(initialData?.data || []);
  const [hasMore, setHasMore] = useState<boolean>(initialData?.hasMore ?? true);
  const [sessionId, setSessionId] = useState<string | null>(initialData?.sessionId || null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialData?.nextCursor || null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const updatePostInteraction = usePostInteractionUpdater(setPosts);

  /*
   * Make sure the guest subject id (and its cookie mirror) exists from the
   * first paint, not from the first request that happens to need it.
   *
   * The cookie is what lets the *next* server render create a session this
   * client can continue. Written lazily it did not exist yet when the second
   * page load happened, so the server render still built a session under a
   * throwaway subject and the client abandoned it — 77 rendered cards for a
   * 70-item session, every visit.
   */
  useEffect(() => {
    getRecommendationAnonymousId();
  }, []);

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

  const fetchPage = useCallback(async (params: { sessionId: string | null; cursor: string | null }, reset: boolean) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      /*
       * `anonymousId` is not optional decoration: a feed session belongs to the
       * subject that created it, and a request without one is answered under a
       * fresh throwaway subject. Omitting it meant every guest "load more" was
       * silently a *new session* — measured at five sessions in seven scrolls,
       * 100 rows for 43 distinct posts, and `hasMore` that never went false.
       * Signed-in callers are identified by their token and send nothing here.
       */
      const anonymousId = getRecommendationAnonymousId();
      const query: Record<string, any> = {
        limit: POST_PAGE_LIMIT,
        ...(anonymousId ? { anonymousId } : {}),
        ...(topicKey ? { topicKey } : {}),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {})
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
      setSessionId(page.sessionId || null);
      setNextCursor(page.nextCursor || null);
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
  }, [topicKey]);

  // Category changes start a brand-new recommendation session scoped to that
  // category. Keyed off a ref rather than `posts.length` so a category that
  // legitimately returns zero posts can still be re-fetched later, and so a
  // stale response can never suppress the load for the current category.
  useEffect(() => {
    if (!enabled) return;
    if (loadedTopicRef.current === topicKey) return;

    loadedTopicRef.current = topicKey;
    setPosts([]);
    setSessionId(null);
    setNextCursor(null);
    setHasMore(true);
    void fetchPage({ sessionId: null, cursor: null }, true);
  }, [enabled, fetchPage, topicKey]);

  const loadMore = useCallback(() => {
    if (!enabled || loadingRef.current || !hasMore || !sessionId || !nextCursor) return;
    void fetchPage({ sessionId, cursor: nextCursor }, false);
  }, [enabled, fetchPage, hasMore, nextCursor, sessionId]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setPosts([]);
    setSessionId(null);
    setNextCursor(null);
    setHasMore(true);
    await fetchPage({ sessionId: null, cursor: null }, true);
  }, [enabled, fetchPage]);

  return {
    posts,
    hasMore,
    loading,
    loadMore,
    refresh,
    sessionId,
    total: initialData?.total || posts.length,
    error,
    updatePostInteraction
  };
}
