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

export function useCreatorVideos({ userId, currentPost, enabled }: UseCreatorVideosOptions) {
  const [posts, setPosts] = useState<IPost[]>(currentPost ? [currentPost] : []);
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const loadedUserIdRef = useRef<string | null>(null);

  const fetchPage = useCallback(async (cursor: CursorInfo | null, reset: boolean) => {
    if (!userId || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const response = await getCreatorPosts(userId, {
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
    } catch {
      setError('Unable to load posts from this creator.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [currentPost, userId]);

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
    if (enabled) {
      loadedUserIdRef.current = userId;
      void fetchPage(null, true);
    }
  }, [currentPost, enabled, fetchPage, userId]);

  const loadMore = useCallback(() => {
    if (!enabled || loadingRef.current || !hasMore || !nextCursor) return;
    void fetchPage(nextCursor, false);
  }, [enabled, fetchPage, hasMore, nextCursor]);

  return { posts, hasMore, loading, error, loadMore };
}
