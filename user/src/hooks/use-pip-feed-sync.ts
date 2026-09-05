'use client';

import { getPopupVideo } from '@components/content/post/home-feed-media';
import { IPost } from '@interfaces/post';
import {
  getPostIdFromPopupVideoId,
  PopupPipState,
  pushPopupPipVideo,
  readPopupPipState,
  subscribePopupPipState
} from '@lib/popup-pip';
import { useEffect, useRef, useState } from 'react';

/**
 * Keeps a single-post feed (for-you / following) in sync with the popup PiP player, both ways:
 * - a PiP video that the feed also holds moves the feed to that post.
 * - navigating next/previous on the main feed pushes that post into the PiP window.
 *
 * The first direction is now a *best-effort* match rather than a contract. PiP
 * navigates its own recommendation session, so its next video is usually not in
 * this feed at all — `findIndex` returns -1 and the feed simply stays where it
 * is, which is correct: the feed is not the PiP window's playlist.
 *
 * Each direction reacts only to a genuine change on its own side, tracked by the refs below. That
 * matters because after either side moves there is a render where the two disagree: without these
 * guards each effect would read that disagreement as "the other side moved" and correct it, so the
 * two would push against each other indefinitely.
 */
export function usePipFeedSync(posts: IPost[], activePost: IPost | undefined, onNavigate: (index: number) => void) {
  const [popupPipState, setPopupPipState] = useState<PopupPipState | null>(() => readPopupPipState());
  // Starts null so a PiP session that is already open when this feed mounts is adopted once (moving
  // the feed to that post if needed) rather than ignored.
  const lastPipVideoIdRef = useRef<string | null>(null);
  const lastActivePostIdRef = useRef<string | undefined>(activePost?._id);

  useEffect(() => subscribePopupPipState(setPopupPipState), []);

  // PiP -> main feed. Only acts when the PiP window itself moved to a different video.
  useEffect(() => {
    if (!popupPipState?.active) {
      lastPipVideoIdRef.current = null;
      return;
    }
    const videoId = popupPipState.video.videoId;
    if (lastPipVideoIdRef.current === videoId) return;
    lastPipVideoIdRef.current = videoId;

    const postId = getPostIdFromPopupVideoId(videoId);
    if (postId === activePost?._id) return;
    const index = posts.findIndex((post) => post._id === postId);
    if (index >= 0) onNavigate(index);
  }, [popupPipState, posts, activePost?._id, onNavigate]);

  // Main feed -> PiP. Only acts when the feed itself moved to a different post.
  useEffect(() => {
    if (lastActivePostIdRef.current === activePost?._id) return;
    lastActivePostIdRef.current = activePost?._id;
    if (!activePost) return;

    const payload = getPopupVideo(activePost);
    if (!payload) return;
    const currentPipState = readPopupPipState();
    if (!currentPipState?.active || currentPipState.video.videoId === payload.videoId) return;

    lastPipVideoIdRef.current = payload.videoId;
    // Appends to the PiP window's own history and drops its recommendation
    // session: the anchor that session was built around is no longer what is
    // playing, so the next "next" opens a fresh one from here.
    pushPopupPipVideo(currentPipState, payload);
  }, [activePost]);

  return popupPipState;
}
