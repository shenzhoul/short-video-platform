'use client';

import type { CursorInfo } from '@interfaces/pagination';
import { IPost, PostInteractionPatch } from '@interfaces/post';
import { applyPostInteractionPatchToPosts } from '@lib/post-interactions';
import { likedPosts as getLikedPosts, unlikePosts as unlikePostsService } from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

interface UseLikedPostsOptions {
  enabled: boolean;
  limit?: number;
}

function appendUniquePosts(current: IPost[], incoming: IPost[]) {
  const posts = new Map(current.map((post) => [post._id, post]));
  incoming.forEach((post) => posts.set(post._id, post));
  return [...posts.values()];
}

export function useLikedPosts({ enabled, limit = 24 }: UseLikedPostsOptions) {
  const [posts, setPosts] = useState<IPost[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(null);
  const [isUnliking, setIsUnliking] = useState(false);
  const loadingRef = useRef(false);
  const previousEnabledRef = useRef(false);
  const likedPostIdsRef = useRef<Set<string>>(new Set());

  const loadPage = useCallback(async (cursor: CursorInfo | null = null) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    try {
      const response = await getLikedPosts({
        limit,
        ...(cursor ? {
          cursor: cursor.id,
          lastCreatedAt: cursor.createdAt.toString()
        } : {})
      });
      const page = response.data;
      const incoming = page?.data || [];

      setPosts((current) => appendUniquePosts(current, incoming));
      setTotal((current) => typeof page?.total === 'number'
        ? page.total
        : cursor ? current : incoming.length);
      setNextCursor(page?.nextCursor || null);
      setHasMore(Boolean(page?.hasMore));
    } catch {
      toast.error('Failed to load liked posts');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    const becameEnabled = enabled && !previousEnabledRef.current;
    previousEnabledRef.current = enabled;
    if (becameEnabled) void loadPage();
  }, [enabled, loadPage]);

  useEffect(() => {
    likedPostIdsRef.current = new Set(posts.map((post) => post._id));
  }, [posts]);

  const loadMore = useCallback(() => {
    if (!enabled || loadingRef.current || !hasMore || !nextCursor) return;
    void loadPage(nextCursor);
  }, [enabled, hasMore, loadPage, nextCursor]);

  const unlikePosts = useCallback(async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    if (!uniqueIds.length) return [];

    const confirmation = uniqueIds.length === 1
      ? 'Remove this post from your likes?'
      : `Remove ${uniqueIds.length} posts from your likes?`;
    if (!window.confirm(confirmation)) return [];

    setIsUnliking(true);
    try {
      const response = await unlikePostsService(uniqueIds);
      const unlikedIds = response.data?.removedPostIds || uniqueIds;
      const unlikedIdSet = new Set(unlikedIds);
      unlikedIds.forEach((postId) => likedPostIdsRef.current.delete(postId));
      setPosts((current) => current.filter((post) => !unlikedIdSet.has(post._id)));
      setTotal((current) => Math.max(0, current - unlikedIds.length));
      toast.success(unlikedIds.length === 1
        ? 'Post removed from likes'
        : `${unlikedIds.length} posts removed from likes`);
      return unlikedIds;
    } catch (error: any) {
      toast.error(error?.message || 'Posts could not be removed from likes. Please try again.');
      return [];
    } finally {
      setIsUnliking(false);
    }
  }, []);

  const updatePostInteraction = useCallback((postId: string, patch: PostInteractionPatch) => {
    if (patch.isLiked === false) {
      likedPostIdsRef.current.delete(postId);
      setPosts((current) => current.filter((post) => post._id !== postId));
      setTotal((current) => Math.max(0, current - 1));
      return;
    }
    setPosts((current) => applyPostInteractionPatchToPosts(current, postId, patch));
  }, []);

  const upsertLikedPost = useCallback((post: IPost, patch: PostInteractionPatch) => {
    const isNew = !likedPostIdsRef.current.has(post._id);
    likedPostIdsRef.current.add(post._id);
    setPosts((current) => {
      const existing = current.some((item) => item._id === post._id);
      if (existing) return applyPostInteractionPatchToPosts(current, post._id, patch);
      return [{ ...post, ...patch, isLiked: true }, ...current];
    });
    if (isNew) setTotal((current) => current + 1);
  }, []);

  return {
    posts,
    total,
    loading,
    hasMore,
    loadMore,
    unlikePosts,
    isUnliking,
    updatePostInteraction,
    upsertLikedPost
  };
}
