'use client';

import { IPost } from '@interfaces/post';
import { getRecommendationAnonymousId } from '@lib/recommendation-anonymous-id';
import { getRecommendedPosts } from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';

import { usePostInteractionUpdater } from './use-post-interactions';

export interface RecommendedVideoPage {
  data: IPost[];
  hasMore: boolean;
  sessionId?: string;
  nextCursor?: string | null;
}

/**
 * For You: a personalized ranked session, same session-pagination model as
 * Home (`useHomeFeedInfiniteScroll`) — one ranked order generated once
 * server-side per session and paginated by `sessionId` + opaque `cursor`, so
 * scrolling forward can never duplicate or skip a post, and a fresh mount
 * (or `refresh()`) always starts a new session with a new mix.
 */
export function useRecommendedVideos(initialData?: RecommendedVideoPage | null) {
  const [posts, setPosts] = useState<IPost[]>(initialData?.data || []);
  const [hasMore, setHasMore] = useState(initialData?.hasMore ?? true);
  const [sessionId, setSessionId] = useState<string | null>(initialData?.sessionId || null);
  const [nextCursor, setNextCursor] = useState<string | null>(initialData?.nextCursor || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  /**
   * A rollover that added nothing means the catalogue, not just this session,
   * is spent — so stop asking. Without this the "open a fresh session" branch
   * below would loop forever once every eligible post had been shown.
   */
  const [catalogueSpent, setCatalogueSpent] = useState(false);
  /**
   * Which session ranked each loaded post.
   *
   * A session is a bounded segment, so a long scroll crosses into a second and
   * third one — and the posts from earlier segments stay on screen. Attributing
   * their impressions and watch time to whichever session happens to be newest
   * would file the evidence under a ranking that never chose them. Every event
   * is keyed on the session the post actually came from.
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

  const fetchPage = useCallback(async (
    params: { sessionId: string | null; cursor: string | null },
    mode: 'reset' | 'append' | 'rollover'
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
        ...(anonymousId ? { anonymousId } : {}),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.cursor ? { cursor: params.cursor } : {})
      });
      const page = response.data as RecommendedVideoPage;
      let added = 0;
      setPosts((current) => {
        if (mode === 'reset') {
          added = (page.data || []).length;
          return page.data || [];
        }
        const knownIds = new Set(current.map((post) => post._id));
        const incoming = (page.data || []).filter((post) => !knownIds.has(post._id));
        added = incoming.length;
        return incoming.length ? [...current, ...incoming] : current;
      });
      // Record which session ranked each newly arrived post, before anything
      // else can move `sessionId` on.
      if (page.sessionId) {
        const arrived = (page.data || []).map((post) => post._id);
        setSessionByPostId((current) => {
          const next = mode === 'reset' ? {} : { ...current };
          arrived.forEach((id) => {
            // First session to serve a post owns its attribution; a rollover
            // that re-offers one must not relabel the exposure already logged.
            if (!next[id]) next[id] = page.sessionId as string;
          });
          return next;
        });
      }
      if (mode === 'rollover' && added === 0) setCatalogueSpent(true);
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
    /*
     * A ranked session is a bounded segment, not the whole catalogue, so
     * reaching its end is normal rather than the end of the feed. Opening a
     * fresh session and appending keeps scrolling continuous; ids already shown
     * are filtered out above, so a rollover cannot repeat a post inside this
     * mount — and one that yields nothing new stops the rollover for good.
     */
    if (!hasMore) {
      if (!sessionId || catalogueSpent) return;
      await fetchPage({ sessionId: null, cursor: null }, 'rollover');
      return;
    }
    // No session yet (first load, or a previous session expired) starts a new
    // one; an existing session continues its stable pagination.
    await fetchPage(
      { sessionId, cursor: sessionId ? nextCursor : null },
      sessionId ? 'append' : 'reset'
    );
  }, [catalogueSpent, fetchPage, hasMore, nextCursor, sessionId]);

  const refresh = useCallback(async () => {
    await fetchPage({ sessionId: null, cursor: null }, 'reset');
  }, [fetchPage]);

  /** The session that ranked this post — not merely the newest one open. */
  const sessionForPost = useCallback(
    (postId?: string | null) => (postId ? sessionByPostId[postId] || null : null),
    [sessionByPostId]
  );

  return {
    posts,
    /** More posts can still arrive — this session, or the next one after a rollover. */
    hasMore: hasMore || !catalogueSpent,
    loading,
    error,
    sessionId,
    sessionForPost,
    loadMore,
    refresh,
    updatePostInteraction
  };
}
