'use client';

import { POST_PAGE_LIMIT } from '@constants/pagination';
import { IPost, PostInteractionPatch } from '@interfaces/post';
import { adoptBrowsingChainId, getBrowsingChainId, resetBrowsingChain } from '@lib/browsing-chain';
import { getRecommendationAnonymousId } from '@lib/recommendation-anonymous-id';
import { getPersonalizedHomePosts } from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  FeedChainPage,
  FeedFetchMode,
  isChainSpent,
  MAX_RENDERED_FEED_POSTS,
  mergeFeedPage
} from './use-feed-chain-page';
import { usePostInteractionUpdater } from './use-post-interactions';

interface UseHomeFeedInfiniteScrollProps {
  initialData?: (FeedChainPage & { total?: number }) | null;
  enabled?: boolean;
  /** Restrict the feed to one content category. Empty means "All". */
  topicKey?: string;
}

interface UseHomeFeedInfiniteScrollReturn {
  posts: IPost[];
  hasMore: boolean;
  loading: boolean;
  loadMore: () => void;
  /** Starts a brand-new browsing chain with a fresh mix — "Refresh recommendations". */
  refresh: () => Promise<void>;
  sessionId: string | null;
  /** The session that ranked this post — not merely the newest one open. */
  sessionForPost: (postId?: string | null) => string | null;
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
 * ## One browse is a *chain* of sessions
 *
 * A session is a bounded ranked sample (70 of 160 on this catalogue), which is
 * what stops a reload being a re-sort of one fixed set. Reaching its end is
 * therefore normal, not the end of the feed: the hook rolls over into a
 * successor session in the same **browsing chain**, and the server ranks that
 * successor over the posts the chain has not served yet.
 *
 * The chain id is minted client-side, once per page load per category
 * (`@lib/browsing-chain`), and sent on every request. That is deliberate:
 *
 * - a **reload** mints a new chain, so it starts a fresh browse. In
 *   `deploy-2026-09-06g` the chain was derived from the first session id and a
 *   reload inherited the subject's cross-session "recently seen" memory
 *   instead — a reload after a long browse served **11 posts** and reported the
 *   feed exhausted;
 * - **two tabs** get different chains and never consume each other's catalogue;
 * - **switching category** starts a new chain, because a small category must
 *   not be starved by what "All" already showed.
 *
 * ## When the scroll actually stops
 *
 * When the server says the chain has served every eligible post
 * (`chainExhausted`), or answers a rollover with nothing at all. Both are the
 * server's statement; neither is inferred from the client's own book-keeping,
 * which is what reported an exhausted catalogue at 89 of 160 posts.
 *
 * **Every post appears at most once in a browse.** `mergeFeedPage` de-duplicates
 * by real post id across the whole chain. The chain does not recycle: the
 * version that did gave a repeated post a per-cycle render key, which the client
 * then treated as new — Home grew to 410 cards on a 160-post corpus. Starting
 * over is the viewer's decision ("Refresh recommendations", or a reload), and
 * both mint a new chain.
 */
export function useHomeFeedInfiniteScroll({
  initialData,
  enabled = true,
  topicKey = ''
}: UseHomeFeedInfiniteScrollProps): UseHomeFeedInfiniteScrollReturn {
  const [posts, setPosts] = useState<IPost[]>(() => initialData?.data || []);
  const [hasMore, setHasMore] = useState<boolean>(initialData?.hasMore ?? true);
  const [sessionId, setSessionId] = useState<string | null>(initialData?.sessionId || null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialData?.nextCursor || null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The server answered a rollover with nothing at all. Latched so the rollover
   * branch cannot fire again on every scroll to the bottom.
   */
  const [catalogueSpent, setCatalogueSpent] = useState(false);
  /**
   * Which session ranked each loaded post, keyed by its render key.
   *
   * A chain crosses several sessions while the earlier ones' cards are still on
   * screen. Reporting their impressions and watch time under whichever session
   * is newest would file that evidence against a ranking that never chose them.
   * Keyed per cycle, so a post served again in a later cycle is attributed to
   * the session that actually served it that time.
   */
  const [sessionByPostId, setSessionByPostId] = useState<Record<string, string>>(
    () => Object.fromEntries(
      (initialData?.data || [])
        .filter(() => Boolean(initialData?.sessionId))
        .map((post) => [post._id, initialData!.sessionId as string])
    )
  );
  const updatePostInteraction = usePostInteractionUpdater(setPosts);

  /*
   * Adopt the chain the server render already used, so its posts sit inside the
   * chain's seen-set rather than outside it. Without this the first rollover
   * could re-offer the whole first page.
   *
   * Done during render, not in an effect: the first `loadMore` can be triggered
   * by a scroll that happens before effects for this commit have run, and it
   * must send the same chain id the server used.
   */
  const chainScopeRef = useRef<string>(topicKey);
  if (chainScopeRef.current === topicKey) {
    adoptBrowsingChainId('home', initialData?.chainId, topicKey);
  }

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

  const fetchPage = useCallback(async (
    params: { sessionId: string | null; cursor: string | null },
    mode: FeedFetchMode
  ) => {
    const reset = mode === 'reset';
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
        chainId: getBrowsingChainId('home', topicKey),
        ...(anonymousId ? { anonymousId } : {}),
        ...(topicKey ? { topicKey } : {}),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
        // Only ever sent alongside a sessionId; the server ignores it otherwise.
        ...(mode === 'rollover' ? { rollover: 'true' } : {})
      };

      const response = await getPersonalizedHomePosts(query);
      // A newer request has started since this one; its results are the ones that matter.
      if (requestId !== requestIdRef.current) return;

      const page = (response?.data || {}) as FeedChainPage;
      const incoming = page.data || [];

      setPosts((current) => mergeFeedPage(current, incoming, mode).posts);

      if (page.sessionId) {
        setSessionByPostId((current) => {
          const next = reset ? {} : { ...current };
          // The first session to serve a post owns its attribution; a later
          // page re-offering it must not relabel the exposure already logged.
          incoming.forEach((post) => {
            if (!next[post._id]) next[post._id] = page.sessionId as string;
          });
          return next;
        });
      }

      /*
       * The stop condition is the server's, not the client's: `chainExhausted`,
       * or a rollover that returned nothing. Inferring it from "did the client
       * add anything new" reported an exhausted catalogue at 89 of 160 posts;
       * papering over it by recycling instead grew the feed to 410 cards of a
       * 160-post corpus.
       */
      if (isChainSpent(page, mode)) setCatalogueSpent(true);
      if (reset) setCatalogueSpent(false);
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

  // Category changes start a brand-new browsing chain scoped to that category.
  // Keyed off a ref rather than `posts.length` so a category that legitimately
  // returns zero posts can still be re-fetched later, and so a stale response
  // can never suppress the load for the current category.
  useEffect(() => {
    if (!enabled) return;
    if (loadedTopicRef.current === topicKey) return;

    loadedTopicRef.current = topicKey;
    chainScopeRef.current = topicKey;
    // A category is its own browsing context: starting it inside the previous
    // chain would exclude everything "All" had already shown, which can empty a
    // small category outright.
    resetBrowsingChain('home', topicKey);
    setPosts([]);
    setSessionId(null);
    setNextCursor(null);
    setHasMore(true);
    setCatalogueSpent(false);
    setSessionByPostId({});
    void fetchPage({ sessionId: null, cursor: null }, 'reset');
  }, [enabled, fetchPage, topicKey]);

  const loadMore = useCallback(() => {
    if (!enabled || loadingRef.current) return;
    // A rendering ceiling, not a statement about the catalogue.
    if (posts.length >= MAX_RENDERED_FEED_POSTS) return;

    /*
     * The end of a session is not the end of the feed. Roll over into a
     * successor session of the same chain and keep appending; the server
     * excludes everything the chain has served, and recycles the chain once it
     * has served everything eligible.
     */
    if (!hasMore || !nextCursor) {
      if (!sessionId || catalogueSpent) return;
      void fetchPage({ sessionId, cursor: null }, 'rollover');
      return;
    }

    void fetchPage({ sessionId, cursor: nextCursor }, 'append');
  }, [catalogueSpent, enabled, fetchPage, hasMore, nextCursor, posts.length, sessionId]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    // A new browse, not the remainder of the one being abandoned: "Refresh
    // recommendations" asks for a fresh mix of the whole catalogue.
    resetBrowsingChain('home', topicKey);
    setPosts([]);
    setSessionId(null);
    setNextCursor(null);
    setHasMore(true);
    setCatalogueSpent(false);
    setSessionByPostId({});
    await fetchPage({ sessionId: null, cursor: null }, 'reset');
  }, [enabled, fetchPage, topicKey]);

  /** The session that ranked this post — not merely the newest one open. */
  const sessionForPost = useCallback(
    (postId?: string | null) => (postId ? sessionByPostId[postId] || null : null),
    [sessionByPostId]
  );

  return {
    posts,
    /**
     * More posts can still arrive — this session, the next one after a
     * rollover, or a recycled cycle — until the server says nothing is
     * eligible or the rendering ceiling is reached.
     */
    hasMore: (hasMore || !catalogueSpent) && posts.length < MAX_RENDERED_FEED_POSTS,
    loading,
    loadMore,
    refresh,
    sessionId,
    sessionForPost,
    total: initialData?.total || posts.length,
    error,
    updatePostInteraction
  };
}
