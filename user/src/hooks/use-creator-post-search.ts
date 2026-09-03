'use client';

import { toast } from '@douyin-clone/shared-toast';
import { usePostInteractionUpdater } from '@hooks/use-post-interactions';
import type { CursorInfo } from '@interfaces/pagination';
import { IPost } from '@interfaces/post';
import {
  deletePost as deletePostService,
  getCreatorPosts,
  myPosts,
  pinPost as pinPostService,
  unpinPost as unpinPostService
} from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseCreatorPostSearchProps {
  /**
   * The creator whose profile is being viewed.
   *
   * Present means "this is a profile listing": every page goes to
   * `/posts/creator-posts` scoped to this id, which is the same contract the
   * server-rendered first page uses. Absent means the owner's own management
   * screen, which lists through `/creator/posts` and takes no creator id
   * because it is *by definition* the caller's own posts.
   *
   * There is deliberately no third behaviour and no inference from the session:
   * a listing that guesses its own scope is how a profile grid ends up holding
   * whoever happens to be signed in.
   */
  creatorId?: string;
  initialPosts?: IPost[];
  initialTotal?: number;
  initialHasMore?: boolean;
  initialNextCursor?: CursorInfo | null;
  limit?: number;
}

export const useCreatorPostSearch = ({
  creatorId,
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
  /**
   * The creator this list currently represents. A response for anyone else is
   * dropped: navigating from one profile to another remounts nothing on a
   * client-side transition, so a slow page for the creator being left would
   * otherwise be appended to the creator being entered.
   */
  const activeCreatorIdRef = useRef<string | undefined>(creatorId);
  activeCreatorIdRef.current = creatorId;
  const loadingRef = useRef(false);

  const searchPosts = useCallback(async (newFilter: any, isNewSearch: boolean) => {
    if (loadingRef.current) return;
    const requestedCreatorId = creatorId;
    loadingRef.current = true;
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

      // A profile listing pages the creator route; the owner's own management
      // screen pages their own. Never the reverse, and never a shared feed
      // route filtered afterwards on the client.
      const response = requestedCreatorId
        ? await getCreatorPosts(requestedCreatorId, queryParams)
        : await myPosts(queryParams);

      // The viewer moved to another profile while this was in flight.
      if (activeCreatorIdRef.current !== requestedCreatorId) return;

      const newPosts = response.data?.data || [];
      const responseNextCursor = response.data?.nextCursor || null;
      const responseTotal = typeof response.data?.total === 'number' ? response.data.total : newPosts.length;
      const responseHasMore = response.data?.hasMore ?? (newPosts.length < responseTotal);

      if (isNewSearch) {
        setPosts(newPosts);
        setNextCursor(responseNextCursor);
      } else {
        // Defence in depth behind the scoped route: append only posts not
        // already held, so a repeated cursor page cannot duplicate a tile.
        setPosts((prev) => {
          const known = new Set(prev.map((post) => post._id));
          return [...prev, ...newPosts.filter((post: IPost) => !known.has(post._id))];
        });
        setNextCursor(responseNextCursor);
      }

      setHasMore(responseHasMore);
      setTotal(responseTotal);
    } catch {
      if (activeCreatorIdRef.current === requestedCreatorId) toast.error('Failed to load posts');
    } finally {
      loadingRef.current = false;
      if (activeCreatorIdRef.current === requestedCreatorId) setLoading(false);
    }
  }, [creatorId, limit, nextCursor]);

  // A different profile is a different list. Reset rather than append, so a
  // client-side navigation between two creators cannot leave the previous
  // creator's tiles on screen under the new creator's header.
  const seededCreatorIdRef = useRef(creatorId);
  useEffect(() => {
    if (seededCreatorIdRef.current === creatorId) return;
    seededCreatorIdRef.current = creatorId;
    setPosts(initialPosts);
    setTotal(initialTotal);
    setNextCursor(initialNextCursor);
    setHasMore(typeof initialHasMore === 'boolean' ? initialHasMore : initialPosts.length < initialTotal);
    // `initialPosts` is the server-rendered page for the creator now being
    // viewed; re-running on its identity alone would reset the list every time
    // the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId]);

  const handleFilter = (newFilter: any) => {
    setFilter(newFilter);
    setNextCursor(null); // Reset cursor for new search
    searchPosts(newFilter, true);
  };

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore || !nextCursor) return;
    searchPosts(filter, false);
  }, [filter, hasMore, nextCursor, searchPosts]);

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
