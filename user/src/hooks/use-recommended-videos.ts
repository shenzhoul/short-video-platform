'use client';

import { IPost } from '@interfaces/post';
import { adoptBrowsingChainId, getBrowsingChainId, resetBrowsingChain } from '@lib/browsing-chain';
import { getRecommendationAnonymousId } from '@lib/recommendation-anonymous-id';
import { getRecommendedPosts } from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  FeedChainPage,
  FeedFetchMode,
  isChainSpent,
  MAX_RENDERED_FEED_POSTS,
  mergeFeedPage,
  withFeedKey
} from './use-feed-chain-page';
import { usePostInteractionUpdater } from './use-post-interactions';

export type RecommendedVideoPage = FeedChainPage;

/**
 * For You: a personalized ranked session, on the same browsing-chain contract
 * as Home (`useHomeFeedInfiniteScroll`) — one ranked order generated once
 * server-side per session, paginated by `sessionId` + opaque `cursor`, and
 * rolled over into a successor session in the same chain when it is spent.
 *
 * **The chain is shared infrastructure; the ranking is not.** For You keeps its
 * own candidate quotas, its own score weights, its own session size and its own
 * personalization from watch behaviour, likes, follows and replays. All the
 * chain contributes is "what has this browse already served", which is
 * bookkeeping rather than recommendation.
 *
 * The chain id is minted per page load (`@lib/browsing-chain`): a reload starts
 * a fresh browse, two tabs never consume each other's catalogue, and an
 * exhausted chain recycles server-side instead of dead-ending.
 */
export function useRecommendedVideos(initialData?: RecommendedVideoPage | null) {
  const [posts, setPosts] = useState<IPost[]>(
    () => (initialData?.data || []).map((post) => withFeedKey(post, initialData?.cycle || 0))
  );
  const [hasMore, setHasMore] = useState(initialData?.hasMore ?? true);
  const [sessionId, setSessionId] = useState<string | null>(initialData?.sessionId || null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialData?.nextCursor || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  /**
   * The server answered a rollover with nothing at all — which, since an
   * exhausted chain recycles server-side, means nothing is eligible for this
   * subject. Latched so the rollover branch cannot loop.
   */
  const [catalogueSpent, setCatalogueSpent] = useState(false);
  /**
   * Which session ranked each loaded post, keyed by its render key.
   *
   * A chain is a sequence of bounded segments, so a long scroll crosses into a
   * second and third one while posts from the first are still on screen.
   * Attributing their impressions to whichever session happens to be newest
   * would file the evidence under a ranking that never chose them.
   */
  const [sessionByFeedKey, setSessionByFeedKey] = useState<Record<string, string>>(
    () => Object.fromEntries(
      (initialData?.data || [])
        .filter(() => Boolean(initialData?.sessionId))
        .map((post) => [withFeedKey(post, initialData?.cycle || 0).feedKey as string, initialData!.sessionId as string])
    )
  );
  const updatePostInteraction = usePostInteractionUpdater(setPosts);

  // Adopt the chain the server render used, during render: the first
  // `loadMore` can fire before this commit's effects run, and it must send the
  // same chain id the server already recorded its first session under.
  adoptBrowsingChainId('for-you', initialData?.chainId);

  /*
   * Make sure the guest subject id (and its cookie mirror) exists from the
   * first paint, not from the first request that happens to need it.
   */
  useEffect(() => {
    getRecommendationAnonymousId();
  }, []);

  const fetchPage = useCallback(async (
    params: { sessionId: string | null; cursor: string | null },
    mode: FeedFetchMode
  ) => {
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      // Same reason as Home: without the subject id the server cannot recognise
      // the owner of `sessionId`, so it quietly starts a new session on every
      // page and the segment boundary loses all meaning.
      const anonymousId = getRecommendationAnonymousId();
      const response = await getRecommendedPosts({
        limit: 10,
        chainId: getBrowsingChainId('for-you'),
        ...(anonymousId ? { anonymousId } : {}),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {}),
        ...(mode === 'rollover' ? { rollover: 'true' } : {})
      });
      const page = response.data as RecommendedVideoPage;
      const cycle = page.cycle || 0;
      const incoming = (page.data || []).map((post) => withFeedKey(post, cycle));

      setPosts((current) => mergeFeedPage(current, incoming, mode).posts);

      if (page.sessionId) {
        setSessionByFeedKey((current) => {
          const next = mode === 'reset' ? {} : { ...current };
          incoming.forEach((post) => {
            const key = post.feedKey as string;
            if (!next[key]) next[key] = page.sessionId as string;
          });
          return next;
        });
      }

      if (isChainSpent(page, mode)) setCatalogueSpent(true);
      if (mode === 'reset') setCatalogueSpent(false);
      setHasMore(Boolean(page.hasMore));
      setSessionId(page.sessionId || null);
      setNextCursor(page.nextCursor || null);
    } catch {
      setError('Unable to load recommendations. Please try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    if (posts.length >= MAX_RENDERED_FEED_POSTS) return;

    // No session yet — the first mount, or a previous session that expired.
    // `loadMore` is For You's only loader, so this is where its feed starts.
    if (!sessionId) {
      await fetchPage({ sessionId: null, cursor: null }, 'reset');
      return;
    }

    /*
     * A ranked session is a bounded segment, not the whole catalogue, so
     * reaching its end is normal rather than the end of the feed. The rollover
     * continues the same chain, so the successor is ranked over what this
     * browse has *not* served — and the server recycles the chain rather than
     * dead-ending once it has served everything eligible.
     */
    if (!hasMore || !nextCursor) {
      if (catalogueSpent) return;
      await fetchPage({ sessionId, cursor: null }, 'rollover');
      return;
    }
    await fetchPage({ sessionId, cursor: nextCursor }, 'append');
  }, [catalogueSpent, fetchPage, hasMore, nextCursor, posts.length, sessionId]);

  const refresh = useCallback(async () => {
    resetBrowsingChain('for-you');
    setSessionByFeedKey({});
    await fetchPage({ sessionId: null, cursor: null }, 'reset');
  }, [fetchPage]);

  /** The session that ranked this post in this cycle — not merely the newest one open. */
  const sessionForPost = useCallback(
    (feedKey?: string | null) => (feedKey ? sessionByFeedKey[feedKey] || null : null),
    [sessionByFeedKey]
  );

  return {
    posts,
    /** More posts can still arrive — this session, the next after a rollover, or a recycled cycle. */
    hasMore: (hasMore || !catalogueSpent) && posts.length < MAX_RENDERED_FEED_POSTS,
    loading,
    error,
    sessionId,
    sessionForPost,
    loadMore,
    refresh,
    updatePostInteraction
  };
}
