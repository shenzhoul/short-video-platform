'use client';

import { IPost } from '@interfaces/post';
import { getRecommendedPosts } from '@services/post.service';
import { useCallback, useRef, useState } from 'react';

import { usePostInteractionUpdater } from './use-post-interactions';

export interface RecommendationCursor {
  id: string;
  score: number;
}

export interface RecommendedVideoPage {
  data: IPost[];
  hasMore: boolean;
  nextCursor: RecommendationCursor | null;
}

export function useRecommendedVideos(initialData?: RecommendedVideoPage | null) {
  const [posts, setPosts] = useState<IPost[]>(initialData?.data || []);
  const [hasMore, setHasMore] = useState(initialData?.hasMore ?? true);
  const [nextCursor, setNextCursor] = useState<RecommendationCursor | null>(initialData?.nextCursor || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const updatePostInteraction = usePostInteractionUpdater(setPosts);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await getRecommendedPosts({
        limit: 10,
        ...(nextCursor ? { cursor: nextCursor.id, score: nextCursor.score } : {})
      });
      const page = response.data as RecommendedVideoPage;
      setPosts((current) => {
        const knownIds = new Set(current.map((post) => post._id));
        return [...current, ...(page.data || []).filter((post) => !knownIds.has(post._id))];
      });
      setHasMore(Boolean(page.hasMore));
      setNextCursor(page.nextCursor || null);
    } catch {
      setError('Unable to load recommendations. Please try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hasMore, nextCursor]);

  return { posts, hasMore, loading, error, loadMore, updatePostInteraction };
}
