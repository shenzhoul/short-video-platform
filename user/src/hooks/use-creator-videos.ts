'use client';

import { insertPostInOrder, mergeCreatorPosts } from '@components/content/post/creator-post-order';
import { CursorInfo } from '@interfaces/pagination';
import { IPost } from '@interfaces/post';
import { getCreatorPosts } from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseCreatorVideosOptions {
  userId?: string;
  currentPost?: IPost | null;
  enabled: boolean;
}

interface CreatorPostPage {
  data: IPost[];
  hasMore: boolean;
  nextCursor: CursorInfo | null;
}

/**
 * One creator's posts, for the Post Detail creator grid and the sequence that
 * grid represents.
 *
 * ## Why responses are stamped with the creator they were asked for
 *
 * Two things could previously put another creator's posts in this list.
 *
 * The server side was the larger one: `getCreatorPosts` used to call
 * `/posts/home-posts`, which became the ranked Home recommendation feed and
 * stopped honouring `userId` — so a request for one creator answered with a mix
 * of eight. That is fixed at the route (`/posts/creator-posts`).
 *
 * The client side was a race. `loadedUserIdRef` was set *before* knowing the
 * fetch had actually begun, while `fetchPage` silently returned early whenever
 * another request was already in flight. Moving between creators quickly
 * therefore marked the new creator as loaded without ever asking for them, and
 * the previous creator's response — arriving after — was merged in and never
 * corrected, because the ref said the work was done. `loadMore` then paged the
 * *new* creator using the *old* creator's cursor, mixing both into one grid.
 *
 * So: every response carries the creator it was requested for and is discarded
 * if that is no longer the creator being shown, and the "already loaded" mark
 * is only set once a request has genuinely been issued.
 */
export function useCreatorVideos({ userId, currentPost, enabled }: UseCreatorVideosOptions) {
  const [posts, setPosts] = useState<IPost[]>(currentPost ? [currentPost] : []);
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightUserIdRef = useRef<string | null>(null);
  const loadedUserIdRef = useRef<string | null>(null);
  /** The creator the list currently represents; a late response for anyone else is dropped. */
  const activeUserIdRef = useRef<string | null>(null);
  activeUserIdRef.current = userId || null;

  const fetchPage = useCallback(async (requestedUserId: string, cursor: CursorInfo | null, reset: boolean) => {
    // Two requests for the *same* creator would duplicate a page; a request for
    // a different creator must not be dropped, because dropping it is what left
    // the grid showing somebody else.
    if (inFlightUserIdRef.current === requestedUserId) return;
    inFlightUserIdRef.current = requestedUserId;
    setLoading(true);
    setError(null);

    try {
      const response = await getCreatorPosts(requestedUserId, {
        limit: 12,
        sortBy: 'createdAt',
        sort: 'desc',
        ...(cursor ? {
          cursor: cursor.id,
          lastCreatedAt: new Date(cursor.createdAt).toISOString(),
          ...(typeof cursor.isPinned === 'boolean' ? { lastIsPinned: cursor.isPinned } : {}),
          ...(cursor.pinnedAt ? { lastPinnedAt: new Date(cursor.pinnedAt).toISOString() } : {})
        } : {})
      });
      // The viewer moved on while this was in flight: this page belongs to a
      // creator no longer on screen, and merging it would mix two catalogues.
      if (activeUserIdRef.current !== requestedUserId) return;

      const page = response.data as CreatorPostPage;
      const incoming = page.data || [];

      setPosts((existing) => {
        // Ordered by the shared comparator, not by arrival. The open post is
        // *placed*, not appended: it may live on a page that has not been
        // fetched yet, and putting it at the end made the grid highlight one
        // tile while the arrows moved between its neighbours somewhere else.
        const merged = mergeCreatorPosts(reset ? [] : existing, incoming);
        return insertPostInOrder(merged, currentPost);
      });
      setNextCursor(page.nextCursor || null);
      setHasMore(Boolean(page.hasMore));
      loadedUserIdRef.current = requestedUserId;
    } catch {
      if (activeUserIdRef.current === requestedUserId) {
        setError('Unable to load posts from this creator.');
        // Not marked loaded, so re-entering this creator tries again rather
        // than showing a permanently one-tile grid.
        loadedUserIdRef.current = null;
      }
    } finally {
      if (inFlightUserIdRef.current === requestedUserId) inFlightUserIdRef.current = null;
      if (activeUserIdRef.current === requestedUserId) setLoading(false);
    }
  }, [currentPost]);

  useEffect(() => {
    if (!currentPost || !userId) {
      setPosts([]);
      return;
    }

    if (loadedUserIdRef.current === userId) {
      // Navigating within the same creator: keep the loaded pages, and place the
      // newly opened post if it is not among them yet.
      setPosts((existing) => insertPostInOrder(existing, currentPost));
      return;
    }

    setPosts([currentPost]);
    setNextCursor(null);
    setHasMore(true);
    setError(null);
    if (enabled) void fetchPage(userId, null, true);
  }, [currentPost, enabled, fetchPage, userId]);

  const loadMore = useCallback(() => {
    if (!enabled || !userId || !hasMore || !nextCursor) return;
    // A cursor only means anything against the creator it came from.
    if (loadedUserIdRef.current !== userId) return;
    void fetchPage(userId, nextCursor, false);
  }, [enabled, fetchPage, hasMore, nextCursor, userId]);

  return {
    posts, hasMore, loading, error, loadMore
  };
}
