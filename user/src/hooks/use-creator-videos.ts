'use client';

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
        const base = reset ? incoming : [...existing, ...incoming];
        const unique = new Map(base.map((post) => [post._id, post]));
        if (currentPost && !unique.has(currentPost._id)) unique.set(currentPost._id, currentPost);
        return Array.from(unique.values());
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
      setPosts((existing) => existing.some((post) => post._id === currentPost._id)
        ? existing
        : [...existing, currentPost]);
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
