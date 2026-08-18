'use client';

import { IPost, PostInteractionPatch } from '@interfaces/post';
import { applyPostInteractionPatchToPosts } from '@lib/post-interactions';
import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';

export type PostInteractionChangeHandler = (
  postId: string,
  patch: PostInteractionPatch
) => void;

interface PostInteractionState {
  isLiked: boolean;
  totalLike: number;
  totalComment: number;
  totalShare: number;
}

function getInteractionState(post?: IPost): PostInteractionState {
  return {
    isLiked: Boolean(post?.isLiked),
    totalLike: post?.totalLike || 0,
    totalComment: post?.totalComment || 0,
    totalShare: post?.totalShare || 0
  };
}

export function usePostInteractionState(
  post: IPost | undefined,
  onInteractionChange?: PostInteractionChangeHandler
) {
  const [state, setState] = useState<PostInteractionState>(() => getInteractionState(post));
  const postId = post?._id;
  const isLiked = Boolean(post?.isLiked);
  const totalLike = post?.totalLike || 0;
  const totalComment = post?.totalComment || 0;
  const totalShare = post?.totalShare || 0;

  useEffect(() => {
    setState((current) => current.isLiked === isLiked
      && current.totalLike === totalLike
      && current.totalComment === totalComment
      && current.totalShare === totalShare
      ? current
      : {
        isLiked, totalLike, totalComment, totalShare
      });
  }, [isLiked, postId, totalComment, totalLike, totalShare]);

  const updateInteraction = useCallback((patch: PostInteractionPatch) => {
    if (!postId) return;

    setState((current) => {
      const nextState = { ...current, ...patch };
      return current.isLiked === nextState.isLiked
        && current.totalLike === nextState.totalLike
        && current.totalComment === nextState.totalComment
        && current.totalShare === nextState.totalShare
        ? current
        : nextState;
    });
    onInteractionChange?.(postId, patch);
  }, [onInteractionChange, postId]);

  /**
   * Replace the shared counters with an authoritative server snapshot.
   *
   * Absolute assignment, never arithmetic: the snapshot *is* the truth, so a
   * client that missed frames is corrected by the next one instead of drifting
   * further with every miss. Applying a delta here would make a dropped frame
   * permanent.
   *
   * `isLiked` is deliberately absent. It is viewer-specific — B liking a post
   * says nothing about whether C likes it — so it is never taken from shared
   * state, only from this viewer's own action or their own fetch.
   */
  const applyStatsSnapshot = useCallback((snapshot: {
    totalLike: number; totalComment: number; totalShare: number;
  }) => {
    if (!postId) return;
    updateInteraction({
      totalLike: snapshot.totalLike,
      totalComment: snapshot.totalComment,
      totalShare: snapshot.totalShare
    });
  }, [postId, updateInteraction]);

  const handleLikeChange = useCallback((isLiked: boolean, totalLike: number) => {
    updateInteraction({ isLiked, totalLike });
  }, [updateInteraction]);

  const handleTotalCommentChange = useCallback((totalComment: number) => {
    updateInteraction({ totalComment });
  }, [updateInteraction]);

  /**
   * Records one more sharer.
   *
   * Counted optimistically from the value already on screen because the backend
   * increments the stored statistic asynchronously through the reaction queue,
   * so re-reading the post immediately after sharing would still return the old
   * number. The next load reconciles against the server.
   */
  const handleShared = useCallback(() => {
    setState((current) => {
      const nextTotalShare = current.totalShare + 1;
      if (postId) onInteractionChange?.(postId, { totalShare: nextTotalShare });
      return { ...current, totalShare: nextTotalShare };
    });
  }, [onInteractionChange, postId]);

  return {
    ...state,
    updateInteraction,
    applyStatsSnapshot,
    handleLikeChange,
    handleTotalCommentChange,
    handleShared
  };
}

export function usePostInteractionUpdater(setPosts: Dispatch<SetStateAction<IPost[]>>) {
  return useCallback<PostInteractionChangeHandler>((postId, patch) => {
    setPosts((current) => applyPostInteractionPatchToPosts(current, postId, patch));
  }, [setPosts]);
}
