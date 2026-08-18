'use client';

import { IPost } from '@interfaces/post';
import { getFollowingPosts } from '@services/post.service';
import { unfollowCreator as requestUnfollowCreator } from '@services/user.service';
import { useCallback, useRef, useState } from 'react';

import { usePostInteractionUpdater } from './use-post-interactions';

export interface FollowingFeedPage {
  data: IPost[];
  hasMore: boolean;
  nextCursor?: { id: string; createdAt: number } | null;
  total?: number;
}

export function useFollowingFeed(initialData?: FollowingFeedPage | null) {
  const [posts, setPosts] = useState(initialData?.data || []);
  const [hasMore, setHasMore] = useState(initialData?.hasMore ?? true);
  const [nextCursor, setNextCursor] = useState(initialData?.nextCursor || null);
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
      const response = await getFollowingPosts({
        limit: 10,
        sortBy: 'createdAt',
        sort: 'desc',
        ...(nextCursor ? {
          cursor: nextCursor.id,
          lastCreatedAt: new Date(nextCursor.createdAt).toISOString()
        } : {})
      });
      const page = response.data as FollowingFeedPage;
      setPosts(current => {
        const ids = new Set(current.map(post => post._id));
        return [...current, ...(page.data || []).filter(post => !ids.has(post._id))];
      });
      setHasMore(Boolean(page.hasMore));
      setNextCursor(page.nextCursor || null);
    } catch {
      setError('Unable to load posts from followed creators.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hasMore, nextCursor]);

  const markCreatorFollowed = useCallback((creatorId: string) => {
    setPosts(current => current.map(post => post.user?._id === creatorId
      ? { ...post, user: { ...post.user, isFollowed: true } }
      : post));
  }, []);

  const unfollowCreator = useCallback(async (creatorId: string) => {
    const response = await requestUnfollowCreator(creatorId);
    setPosts(current => current.filter(post => post.user?._id !== creatorId));
    return response;
  }, []);

  return { posts, hasMore, loading, error, loadMore, updatePostInteraction, markCreatorFollowed, unfollowCreator };
}
