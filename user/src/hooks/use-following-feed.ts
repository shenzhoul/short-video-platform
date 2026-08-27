'use client';

import { IPost } from '@interfaces/post';
import { getFollowingPosts, getFriendPosts } from '@services/post.service';
import { unfollowCreator as requestUnfollowCreator } from '@services/user.service';
import { useCallback, useRef, useState } from 'react';

import { usePostInteractionUpdater } from './use-post-interactions';

export interface FollowingFeedPage {
  data: IPost[];
  hasMore: boolean;
  nextCursor?: { id: string; createdAt: number } | null;
  total?: number;
}

/**
 * Which relationship the feed is scoped to.
 *
 * `following` is everyone the viewer follows; `friends` is the mutual subset.
 * One hook rather than two because the paging, de-duplication, interaction
 * updates and unfollow handling are identical — only the endpoint differs.
 */
export type FollowingFeedSource = 'following' | 'friends';

const FEED_SOURCES: Record<FollowingFeedSource, {
  fetchPage: typeof getFollowingPosts;
  errorMessage: string;
}> = {
  following: {
    fetchPage: getFollowingPosts,
    errorMessage: 'Unable to load posts from followed creators.'
  },
  friends: {
    fetchPage: getFriendPosts,
    errorMessage: 'Unable to load posts from your friends.'
  }
};

export function useFollowingFeed(
  initialData?: FollowingFeedPage | null,
  source: FollowingFeedSource = 'following'
) {
  const { fetchPage, errorMessage } = FEED_SOURCES[source] || FEED_SOURCES.following;
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
      const response = await fetchPage({
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
      setError(errorMessage);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [errorMessage, fetchPage, hasMore, nextCursor]);

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
