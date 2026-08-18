'use client';

import { usePostInteractionUpdater } from '@hooks/use-post-interactions';
import type { CursorInfo } from '@interfaces/pagination';
import { IPost } from '@interfaces/post';
import {
  deletePost as deletePostService,
  myPosts,
  pinPost as pinPostService,
  unpinPost as unpinPostService
} from '@services/post.service';
import { useCallback, useState } from 'react';
import { toast } from 'react-toastify';

interface UseCreatorPostSearchProps {
  initialPosts?: IPost[];
  initialTotal?: number;
  initialHasMore?: boolean;
  initialNextCursor?: CursorInfo | null;
  limit?: number;
}

export const useCreatorPostSearch = ({
  initialPosts = [],
  initialTotal = initialPosts.length,
  initialHasMore,
  initialNextCursor = null,
  limit = 12
}: UseCreatorPostSearchProps) => {
  const [posts, setPosts] = useState<IPost[]>(initialPosts);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<any>({});
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(initialNextCursor);
  const defaultHasMore = typeof initialHasMore === 'boolean' ? initialHasMore : initialPosts.length < initialTotal;
  const [hasMore, setHasMore] = useState(defaultHasMore);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pinningPostId, setPinningPostId] = useState<string | null>(null);
  const updatePostInteraction = usePostInteractionUpdater(setPosts);

  const searchPosts = useCallback(async (newFilter: any, isNewSearch: boolean) => {
    try {
      setLoading(true);

      const queryParams: any = {
        ...newFilter,
        limit
      };

      // Add cursor parameters for pagination (except on new search)
      if (!isNewSearch && nextCursor) {
        queryParams.cursor = nextCursor.id;
        queryParams.lastCreatedAt = nextCursor.createdAt.toString();
        if (typeof nextCursor.isPinned === 'boolean') queryParams.lastIsPinned = nextCursor.isPinned;
        if (nextCursor.pinnedAt) queryParams.lastPinnedAt = nextCursor.pinnedAt.toString();
      }

      const response = await myPosts(queryParams);

      const newPosts = response.data?.data || [];
      const responseNextCursor = response.data?.nextCursor || null;
      const responseTotal = typeof response.data?.total === 'number' ? response.data.total : newPosts.length;
      const responseHasMore = response.data?.hasMore ?? (newPosts.length < responseTotal);

      if (isNewSearch) {
        setPosts(newPosts);
        setNextCursor(responseNextCursor);
      } else {
        setPosts(prev => [...prev, ...newPosts]);
        setNextCursor(responseNextCursor);
      }

      setHasMore(responseHasMore);
      setTotal(responseTotal);
    } catch {
      toast.error('Failed to load posts');
    } finally {
      setLoading(false);
    }
  }, [limit, nextCursor]);

  const handleFilter = (newFilter: any) => {
    setFilter(newFilter);
    setNextCursor(null); // Reset cursor for new search
    searchPosts(newFilter, true);
  };

  const loadMore = () => {
    if (loading || !hasMore || !nextCursor) return;
    searchPosts(filter, false);
  };

  const performDeletePosts = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return [];

    setIsDeleting(true);
    try {
      const results = await Promise.allSettled(uniqueIds.map((id) => deletePostService(id)));
      const deletedIds = uniqueIds.filter((_, index) => results[index].status === 'fulfilled');
      const failedCount = uniqueIds.length - deletedIds.length;

      if (deletedIds.length) {
        const deletedIdSet = new Set(deletedIds);
        setPosts((current) => current.filter((post) => !deletedIdSet.has(post._id)));
        setTotal((current) => Math.max(0, current - deletedIds.length));
      }

      if (!failedCount) {
        toast.success(deletedIds.length === 1
          ? 'Post deleted successfully'
          : `${deletedIds.length} posts deleted successfully`);
      } else if (deletedIds.length) {
        toast.warning(`${deletedIds.length} posts deleted, ${failedCount} failed`);
      } else {
        const firstFailure = results.find((result) => result.status === 'rejected');
        const reason = firstFailure?.status === 'rejected' ? firstFailure.reason : null;
        toast.error(reason?.message || 'Posts could not be deleted. Please try again.');
      }

      return deletedIds;
    } finally {
      setIsDeleting(false);
    }
  }, []);

  const deletePosts = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return [];

    const confirmation = uniqueIds.length === 1
      ? 'Are you sure you want to delete this post?'
      : `Are you sure you want to delete ${uniqueIds.length} posts?`;
    if (!window.confirm(confirmation)) return [];
    return performDeletePosts(uniqueIds);
  }, [performDeletePosts]);

  const deletePost = useCallback(async (id: string) => {
    return deletePosts([id]);
  }, [deletePosts]);

  const deletePostConfirmed = useCallback(
    async (id: string) => performDeletePosts([id]),
    [performDeletePosts]
  );

  const togglePinned = useCallback(async (post: IPost) => {
    if (pinningPostId) return;
    setPinningPostId(post._id);
    try {
      const response = post.isPinned
        ? await unpinPostService(post._id)
        : await pinPostService(post._id);
      const updated = response.data as IPost;

      setPosts((current) => current
        .map((item) => item._id === post._id ? {
          ...item,
          isPinned: Boolean(updated.isPinned),
          pinnedAt: updated.pinnedAt || null
        } : item)
        .sort((left, right) => {
          if (Boolean(left.isPinned) !== Boolean(right.isPinned)) return left.isPinned ? -1 : 1;
          if (left.isPinned && right.isPinned) {
            return new Date(right.pinnedAt || 0).getTime() - new Date(left.pinnedAt || 0).getTime();
          }
          return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
        }));
      toast.success(updated.isPinned ? 'Post pinned to top' : 'Post unpinned');
    } catch (error: any) {
      toast.error(error?.message || 'Unable to update the pinned post');
    } finally {
      setPinningPostId(null);
    }
  }, [pinningPostId]);

  return {
    posts,
    total,
    loading,
    hasMore,
    nextCursor,
    handleFilter,
    loadMore,
    deletePost,
    deletePostConfirmed,
    deletePosts,
    isDeleting,
    pinningPostId,
    togglePinned,
    updatePostInteraction
  };
};
