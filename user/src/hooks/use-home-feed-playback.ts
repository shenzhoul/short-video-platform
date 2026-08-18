'use client';

import { getPopupVideo, getPostIdFromPopupVideoId } from '@components/content/post/home-feed-media';
import type { PostVideoDetailTab } from '@components/content/post/post-video-detail-panel';
import { IPost } from '@interfaces/post';
import {
  PopupPipState,
  PopupPipVideo,
  readPopupPipState,
  subscribePopupPipDetailRequest,
  subscribePopupPipState
} from '@lib/popup-pip';
import { applyPostInteractionPatch } from '@lib/post-interactions';
import { findOne } from '@services/post.service';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import { PostInteractionChangeHandler } from './use-post-interactions';
import { useVideoPlaybackContinuity } from './use-video-playback-continuity';

function updateModalUrl(postId: string | null, mode: 'push' | 'replace') {
  const url = new URL(window.location.href);
  if (postId) url.searchParams.set('modal_id', postId);
  else url.searchParams.delete('modal_id');
  // The tab only ever qualifies an open modal, so it never outlives one. It is
  // also dropped once consumed, so reopening the same post later starts on the
  // default view rather than inheriting a tab from an old notification click.
  if (!postId) {
    url.searchParams.delete('modal_tab');
    url.searchParams.delete('target_comment_id');
    url.searchParams.delete('target_comment_fallback_id');
  }
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function useHomeFeedPlayback(
  posts: IPost[],
  onInteractionChange?: PostInteractionChangeHandler
) {
  const [popupPipState, setPopupPipState] = useState<PopupPipState | null>(null);
  const [detailPost, setDetailPost] = useState<IPost | null>(null);
  const [detailInitialTime, setDetailInitialTime] = useState(0);
  // Which post id the open modal currently reflects. Cleared when the modal_id
  // param goes away, so the same post can be opened again later in the session.
  const restoredModalIdRef = useRef<string | null>(null);
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const searchParams = useSearchParams();
  const modalIdParam = searchParams.get('modal_id');
  // Which panel the modal should open on. Notifications about a comment set
  // this to `comments`; everything else leaves it absent and gets the default.
  const modalTabParam = searchParams.get('modal_tab') as PostVideoDetailTab | null;
  // The exact comment a notification is about. Only an id — whether it still
  // exists is resolved by the comment list, never claimed by the URL.
  const targetCommentIdParam = searchParams.get('target_comment_id');
  // Only present for an aggregate whose newest event differs from its first.
  const targetCommentFallbackIdParam = searchParams.get('target_comment_fallback_id');
  const {
    resumeTime: featuredResumeTime,
    getPlaybackTime,
    rememberPlaybackTime,
    resumePlayback
  } = useVideoPlaybackContinuity(posts[0]?._id);

  const popupPlaylist = useMemo(() => posts
    .map(getPopupVideo)
    .filter((video): video is PopupPipVideo => Boolean(video)), [posts]);

  const openDetailPost = useCallback((post: IPost, currentTime = 0, historyMode: 'push' | 'replace' = 'push') => {
    const isFeaturedPost = post._id === postsRef.current[0]?._id;
    if (isFeaturedPost) rememberPlaybackTime(post._id, currentTime);
    setDetailInitialTime(currentTime);
    setDetailPost(post);
    // Claim the id here as well as in the restore effect below, so the URL change
    // this triggers is recognised as already handled and does not re-open the
    // post with a reset playback position.
    restoredModalIdRef.current = post._id;
    updateModalUrl(post._id, historyMode);
  }, [rememberPlaybackTime]);

  // Opens the post named by `modal_id`. Reads the param through the router
  // rather than `window.location` so that arriving at an already-mounted feed
  // with a new `modal_id` — following a notification, for example — re-runs this
  // instead of only working on first mount.
  useEffect(() => {
    if (!modalIdParam) {
      // The modal was closed or navigated away from. Release the id so the same
      // post can be opened again; without this, a second visit to a post already
      // opened once in this session would be silently ignored.
      restoredModalIdRef.current = null;
      return;
    }

    if (restoredModalIdRef.current === modalIdParam) return;

    const localPost = posts.find((post) => post._id === modalIdParam);
    if (localPost) {
      restoredModalIdRef.current = modalIdParam;
      openDetailPost(localPost, 0, 'replace');
      return;
    }

    restoredModalIdRef.current = modalIdParam;
    let cancelled = false;
    void findOne(modalIdParam)
      .then((response) => {
        if (!cancelled && response?.data) {
          openDetailPost(response.data as IPost, 0, 'replace');
        }
      })
      .catch(() => {
        if (cancelled) return;
        restoredModalIdRef.current = null;
        // Deleting a post removes its notifications, so this is the defensive
        // path only: a link that raced the cleanup, or a bookmarked URL. Say so
        // and clear the dead param rather than leaving an empty modal shell.
        toast.info('This post is no longer available.');
        updateModalUrl(null, 'replace');
      });

    return () => {
      cancelled = true;
    };
  }, [modalIdParam, openDetailPost, posts]);

  useEffect(() => {
    setDetailPost((current) => {
      if (!current) return current;
      return posts.find((post) => post._id === current._id) || current;
    });
  }, [posts]);

  /**
   * Applies an interaction change to both the list and the open modal.
   *
   * The list updater alone is not enough: a post reached by `modal_id` that is
   * not in the loaded feed — a notification target, a shared link — exists only
   * as `detailPost`, so patching the array matches nothing and its like, comment
   * and view counters would never move. Patching `detailPost` directly keeps the
   * modal in step without introducing a second counter, because both sides go
   * through the same `applyPostInteractionPatch`.
   */
  const handleInteractionChange = useCallback<PostInteractionChangeHandler>((postId, patch) => {
    onInteractionChange?.(postId, patch);
    setDetailPost((current) => (current && current._id === postId
      ? applyPostInteractionPatch(current, patch)
      : current));
  }, [onInteractionChange]);

  useEffect(() => {
    setPopupPipState(readPopupPipState());
    return subscribePopupPipState((nextState) => {
      setPopupPipState(nextState);
      if (!nextState?.active && nextState?.video.videoId === `home-feed-${postsRef.current[0]?._id}`) {
        const time = nextState.video.currentTime;
        if (Number.isFinite(time)) {
          resumePlayback(postsRef.current[0]?._id, time as number);
        }
      }
    });
  }, [resumePlayback]);

  useEffect(() => subscribePopupPipDetailRequest((request) => {
    const postId = getPostIdFromPopupVideoId(request.videoId);
    const post = postsRef.current.find((item) => item._id === postId);
    if (post) openDetailPost(post, request.currentTime);
  }), [openDetailPost]);

  const navigateDetailPost = useCallback((post: IPost) => {
    const initialTime = getPlaybackTime(post._id);
    openDetailPost(post, initialTime, 'replace');
  }, [getPlaybackTime, openDetailPost]);

  const closeDetailPost = useCallback(() => {
    if (detailPost && detailPost._id === postsRef.current[0]?._id) {
      resumePlayback(detailPost._id);
    }
    setDetailPost(null);
    updateModalUrl(null, 'push');
  }, [detailPost, resumePlayback]);

  const updateFeaturedPlaybackTime = useCallback((currentTime: number) => {
    rememberPlaybackTime(postsRef.current[0]?._id, currentTime);
  }, [rememberPlaybackTime]);

  return {
    popupPipState,
    popupPlaylist,
    detailPost,
    detailInitialTime,
    detailInitialTab: modalTabParam,
    detailTargetCommentId: targetCommentIdParam,
    detailTargetCommentFallbackId: targetCommentFallbackIdParam,
    featuredResumeTime,
    openDetailPost,
    navigateDetailPost,
    closeDetailPost,
    updateFeaturedPlaybackTime,
    handleInteractionChange
  };
}
