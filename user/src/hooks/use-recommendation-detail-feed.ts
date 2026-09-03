'use client';

import { IPost } from '@interfaces/post';
import {
  findOne,
  openPostDetailRecommendationSession,
  stepPostDetailRecommendationNext,
  stepPostDetailRecommendationPrevious
} from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getRecommendationAnonymousId } from '../lib/recommendation-anonymous-id';

const MAX_DEAD_POST_RETRIES = 3;

/**
 * How many posts to keep loaded beyond the one on screen.
 *
 * One was not enough, and not only for latency: reaching the tail was the
 * *only* thing that armed the prefetch, so a single dropped refill ended the
 * sequence permanently. Three means an ordinary step never lands on the tail at
 * all, and a fast sequence of clicks has slack to absorb.
 */
const PREFETCH_AHEAD = 3;

interface UseRecommendationDetailFeedOptions {
  /** True for a non-feed-scoped, non-creator-scoped open — Home grid clicks and `modal_id` deep links. */
  enabled: boolean;
  /** The post currently shown in the modal (changes as the viewer navigates, not just on open). */
  currentPost: IPost | null;
}

export interface RecommendationDetailFeed {
  feedPosts: IPost[];
  sessionId: string | null;
  /**
   * The server has not yet said this session is exhausted, so "next" is a
   * real option even when the array happens to end at the open post. Without
   * this the control could only ever report what was already loaded, which
   * makes a slow refill indistinguishable from the end of the feed.
   */
  hasMoreAhead: boolean;
  /** True while a refill is in flight — used to keep "next" honest, not to show a spinner. */
  refilling: boolean;
}

/**
 * Feeds `PostDetailModal`'s `posts` prop for Home/notification/message/
 * direct-link opens, backed by the server's anchor-based Post Detail
 * recommendation session (`PostDetailRecommendationSessionService`) instead
 * of the Home grid array — "next" therefore need not be the next grid card,
 * and "previous" replays exactly what this array already holds.
 *
 * ## Why the prefetch is shaped like this
 *
 * The first version cancelled its in-flight fetch from a `useEffect` cleanup
 * whose dependency list included `currentPost` — the whole object. That object
 * is replaced on every interaction patch, and opening a post fires a view
 * count update almost immediately, so an ordinary `POST /posts/:id/view`
 * response re-created `currentPost`, ran the cleanup, and threw away a post
 * that had *already been fetched successfully*. The re-run that followed hit
 * the `fetchingRef` guard (the discarded request had not settled yet) and
 * returned early, and because nothing in the dependency list changed again,
 * no further attempt was ever scheduled.
 *
 * Measured in a production build: the server handed out a third post
 * (`GET /detail-session/:id/next -> 6a99308c…`, `GET /posts/6a99308c… 200`)
 * while the Next control stayed disabled forever. The sequence ended at the
 * second post with the catalogue barely touched.
 *
 * So: identity is tracked by post *id*, cancellation belongs to the session
 * rather than to a render, and a refill that ends without appending re-arms
 * instead of latching.
 */
export function useRecommendationDetailFeed({
  enabled, currentPost
}: UseRecommendationDetailFeedOptions): RecommendationDetailFeed {
  const [feedPosts, setFeedPosts] = useState<IPost[]>([]);
  // A ref would not do here: setting it does not trigger a re-render, so the
  // prefetch/previous-sync effects below — which depend on the session id
  // being ready — would never re-run once the (async) session-open call
  // resolves. State is what makes their `useEffect` dependency arrays see it.
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Set once the server answers "no more candidates" for this session. */
  const [exhausted, setExhausted] = useState(false);
  const [refilling, setRefilling] = useState(false);

  // Mirrors `feedPosts`' ids so the anchor effect can do a synchronous "have I
  // already loaded this post?" check without needing `feedPosts` in its
  // dependency array — that would make ordinary forward/backward navigation
  // look identical to a brand-new anchor and wipe the array on every step.
  const knownIdsRef = useRef<Set<string>>(new Set());
  const fetchingRef = useRef(false);
  const lastIndexRef = useRef(0);
  /**
   * Bumped whenever the session changes. A refill checks it before committing,
   * which cancels work from an *abandoned session* — the only thing that
   * genuinely must not land — while leaving ordinary re-renders alone.
   */
  const sessionGenerationRef = useRef(0);

  const currentPostId = currentPost?._id || null;

  // New anchor (modal just opened, or reopened on a post this hook has never
  // loaded before) starts a brand-new detail session. A `currentPost` that
  // is already part of this session's array is ordinary navigation.
  useEffect(() => {
    if (!enabled || !currentPostId || !currentPost) {
      sessionGenerationRef.current += 1;
      setSessionId(null);
      setExhausted(false);
      knownIdsRef.current = new Set();
      setFeedPosts([]);
      return;
    }
    if (knownIdsRef.current.has(currentPostId)) return; // Already part of this session.

    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;
    knownIdsRef.current = new Set([currentPostId]);
    lastIndexRef.current = 0;
    setSessionId(null);
    setExhausted(false);
    setFeedPosts([currentPost]);

    void openPostDetailRecommendationSession(currentPostId, getRecommendationAnonymousId() || undefined)
      .then((response) => {
        if (sessionGenerationRef.current !== generation) return;
        setSessionId(response?.data?.sessionId || null);
      })
      .catch(() => {
        // No session — this open simply has no "next"/"previous" beyond the
        // anchor itself, which is honest (a feed-scoped source with no feed has
        // no neighbours either).
        if (sessionGenerationRef.current === generation) setExhausted(true);
      });
    // `currentPost` is deliberately absent: it is replaced on every interaction
    // patch (a view count, a like) while naming the same post, and reacting to
    // that identity change is what used to restart the session mid-sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, currentPostId]);

  // Keep the server's session cursor in sync with local "previous" navigation
  // so a later `next` resumes from the right position instead of re-appending
  // from the old cursor.
  useEffect(() => {
    if (!enabled || !currentPostId || !sessionId) return;
    const index = feedPosts.findIndex((post) => post._id === currentPostId);
    if (index < 0) return;
    if (index < lastIndexRef.current) {
      void stepPostDetailRecommendationPrevious(sessionId, getRecommendationAnonymousId() || undefined).catch(() => { });
    }
    lastIndexRef.current = index;
  }, [enabled, currentPostId, feedPosts, sessionId]);

  /**
   * Appends one post to the session, returning false when the server has none
   * left. Skips over a post that has been deleted since it was appended.
   */
  const fetchOneMore = useCallback(async (generation: number, retriesLeft: number): Promise<boolean> => {
    const step = await stepPostDetailRecommendationNext(sessionId as string, getRecommendationAnonymousId() || undefined);
    const nextPostId = step?.data?.postId;
    if (!nextPostId) return false; // End of session — no more candidates.
    if (sessionGenerationRef.current !== generation) return false;

    try {
      const response = await findOne(nextPostId);
      const post = response?.data as IPost | undefined;
      if (!post) throw new Error('empty post');
      // Only an abandoned session may discard a fetched post. A re-render of
      // the surface that asked for it may not.
      if (sessionGenerationRef.current !== generation) return false;
      // The server handing back a post already in this session means it has
      // nothing new left; reporting that as an append would spin the refill
      // effect against an array that never grows.
      if (knownIdsRef.current.has(post._id)) return false;
      knownIdsRef.current.add(post._id);
      setFeedPosts((current) => (current.some((item) => item._id === post._id) ? current : [...current, post]));
      return true;
    } catch {
      // The suggested post is gone (deleted between being appended to the
      // session and being fetched here) — ask for another rather than leaving
      // the sequence stuck.
      if (retriesLeft > 0 && sessionGenerationRef.current === generation) {
        return fetchOneMore(generation, retriesLeft - 1);
      }
      return false;
    }
  }, [sessionId]);

  // Keep `PREFETCH_AHEAD` posts loaded past the open one. Keyed on the open
  // post's *id* and the loaded length, both plain values, so an interaction
  // patch cannot restart or cancel it.
  useEffect(() => {
    if (!enabled || !currentPostId || !sessionId || exhausted) return;
    const index = feedPosts.findIndex((post) => post._id === currentPostId);
    if (index < 0) return;
    const ahead = feedPosts.length - 1 - index;
    if (ahead >= PREFETCH_AHEAD) return;
    if (fetchingRef.current) return;

    const generation = sessionGenerationRef.current;
    fetchingRef.current = true;
    setRefilling(true);

    void (async () => {
      let appended = false;
      try {
        appended = await fetchOneMore(generation, MAX_DEAD_POST_RETRIES);
      } finally {
        fetchingRef.current = false;
        if (sessionGenerationRef.current === generation) setRefilling(false);
      }
      // Nothing came back and the session is still current: the server has run
      // out. Recorded so "next" can say so instead of merely looking loaded.
      if (!appended && sessionGenerationRef.current === generation) setExhausted(true);
    })();
    // Re-runs on every append (`feedPosts.length` grows) until the buffer is
    // full, which is what fills the gap without a loop of its own.
  }, [enabled, currentPostId, sessionId, exhausted, feedPosts, fetchOneMore]);

  const currentIndex = currentPostId ? feedPosts.findIndex((post) => post._id === currentPostId) : -1;
  const loadedNextExists = currentIndex >= 0 && currentIndex < feedPosts.length - 1;

  return {
    feedPosts: enabled ? feedPosts : [],
    /** The detail session id, for `detail_open`/like/comment/share/follow attribution. */
    sessionId: enabled ? sessionId : null,
    hasMoreAhead: enabled && (loadedNextExists || (!exhausted && Boolean(sessionId))),
    refilling: enabled && refilling
  };
}
