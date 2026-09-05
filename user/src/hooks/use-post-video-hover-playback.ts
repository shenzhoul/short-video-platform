'use client';

import { getPopupVideo, getPostDuration, getPostMedia, getPostVideo, isVideoPost } from '@components/content/post/home-feed-media';
import { VideoPlayerRef } from '@components/ui/video-player';
import { IPost } from '@interfaces/post';
import { openPopupPip, PopupPipState } from '@lib/popup-pip';
import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';

interface UsePostVideoHoverPlaybackOptions {
  post: IPost;
  featured?: boolean;
  popupPipState: PopupPipState | null;
  onCompactHoverChange?: (postId: string | null) => void;
  onFeaturedTimeUpdate?: (currentTime: number) => void;
  onOpenDetail?: (post: IPost, currentTime: number) => void;
}

export function usePostVideoHoverPlayback({
  post,
  featured = false,
  popupPipState,
  onCompactHoverChange,
  onFeaturedTimeUpdate,
  onOpenDetail
}: UsePostVideoHoverPlaybackOptions) {
  const videoRef = useRef<VideoPlayerRef>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [showCompactChrome, setShowCompactChrome] = useState(true);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverDuration, setHoverDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  const mediaUrl = getPostMedia(post);
  const videoUrl = getPostVideo(post);
  const description = post.text || post.tagline;
  const duration = getPostDuration(post);
  const hasVideo = Boolean(videoUrl) && isVideoPost(post);
  const popupPayload = useMemo(() => getPopupVideo(post), [post]);
  const isPopupActive = Boolean(popupPipState?.active);
  const isCurrentPopup = Boolean(popupPipState?.active && popupPayload && popupPipState.video.videoId === popupPayload.videoId);
  const showFeaturedThumbnail = featured && isPopupActive && !isCurrentPopup;
  const showVideo = hasVideo && ((featured && !showFeaturedThumbnail) || (!featured && !isPopupActive && isHovered) || isCurrentPopup);
  const compactProgress = hoverDuration > 0 ? Math.min(100, Math.max(0, (hoverTime / hoverDuration) * 100)) : 0;

  const clearChromeTimer = () => {
    if (!chromeTimerRef.current) return;
    clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = null;
  };

  const revealChrome = () => {
    if (featured) return;
    clearChromeTimer();
    setShowCompactChrome(true);
    chromeTimerRef.current = setTimeout(() => setShowCompactChrome(false), 2200);
  };

  useEffect(() => () => {
    clearChromeTimer();
  }, []);

  useEffect(() => {
    if (!isPopupActive) return;
    setIsHovered(false);
  }, [isPopupActive]);

  useEffect(() => {
    setIsHovered(false);
  }, [post._id]);

  /**
   * Stop previewing once the card leaves the viewport.
   *
   * `mouseleave` is not enough on its own. It fires when the *pointer* moves off
   * the card, but a feed is usually scrolled with the pointer sitting still over
   * the grid — the content moves underneath it instead, and no boundary event is
   * dispatched for the card that slid away. That card kept `isHovered`, so its
   * `<video>` stayed mounted, downloading and decoding, several screens above
   * the viewport. Measured on a 160-post feed, one stationary-pointer scroll
   * left a video parked at `top: -6497px` that never went away, and a benchmark
   * pass accumulated six of them.
   *
   * Leaving the viewport is the honest signal here, so the observer -- not the
   * pointer -- is what tears the preview down. `handleMouseMove` restores it
   * immediately if the pointer really is still over the card when it scrolls
   * back, so nothing is lost by being aggressive.
   *
   * Featured cards are exempt: their video is mounted by design, not by hover.
   */
  useEffect(() => {
    const element = mediaRef.current;
    if (featured || !hasVideo || !element) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) return;
        setIsHovered(false);
        setHoverTime(0);
        setIsMuted(true);
        onCompactHoverChange?.(null);
      },
      // A little margin so a card grazing the edge is not torn down and rebuilt
      // repeatedly while the user nudges the scroll position.
      { rootMargin: '100px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
    // `onCompactHoverChange` is a stable setter from the feed; re-subscribing on
    // every render would defeat the observer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featured, hasVideo, post._id]);

  const togglePlay = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const player = videoRef.current;
    if (!player) return;
    if (player.isPaused()) void player.play();
    else player.pause();
  };

  const toggleMute = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const player = videoRef.current;
    if (!player) return;
    if (player.isMuted()) player.unmute();
    else player.mute();
    setIsMuted(player.isMuted());
  };

  const openPip = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!popupPayload) return;
    openPopupPip(popupPayload, { videoElement: videoRef.current?.getVideoElement() });
  };

  const seek = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const video = videoRef.current?.getVideoElement();
    if (!video || !hoverDuration) return;
    video.currentTime = (Number(event.target.value) / 100) * hoverDuration;
    setHoverTime(video.currentTime);
  };

  const handleMouseEnter = () => {
    if (isPopupActive) return;
    if (!featured && hasVideo) {
      setHoverTime(0);
      setIsMuted(true);
      onCompactHoverChange?.(post._id);
    }
    setIsHovered(true);
    revealChrome();
  };

  const handleMouseMove = () => {
    if (isPopupActive) return;
    if (!isHovered && hasVideo) {
      if (!featured) onCompactHoverChange?.(post._id);
      setIsHovered(true);
    }
    revealChrome();
  };

  const handleMouseLeave = () => {
    if (!featured && hasVideo) {
      setHoverTime(0);
      setIsMuted(true);
      onCompactHoverChange?.(null);
    }
    setIsHovered(false);
    setShowCompactChrome(true);
    clearChromeTimer();
  };

  const handleOpenDetail = () => {
    if (isPopupActive && popupPayload) {
      openPopupPip(popupPayload, { videoElement: videoRef.current?.getVideoElement() });
      return;
    }
    if (hasVideo) {
      onOpenDetail?.(post, featured ? videoRef.current?.getVideoElement()?.currentTime || 0 : 0);
    }
  };

  const handleReady = (video: HTMLVideoElement) => setHoverDuration(Number.isFinite(video.duration) ? video.duration : 0);
  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleEnded = () => setIsPlaying(false);
  const handleTimeUpdate = (currentTime: number, nextDuration: number) => {
    if (featured) onFeaturedTimeUpdate?.(currentTime);
    else {
      setHoverTime(currentTime);
      setHoverDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
    }
  };

  return {
    videoRef,
    mediaRef,
    mediaUrl,
    videoUrl,
    description,
    duration,
    hasVideo,
    popupPayload,
    isPopupActive,
    isCurrentPopup,
    showFeaturedThumbnail,
    showVideo,
    compactProgress,
    isHovered,
    showCompactChrome,
    hoverTime,
    hoverDuration,
    isMuted,
    isPlaying,
    handleMouseEnter,
    handleMouseMove,
    handleMouseLeave,
    handleOpenDetail,
    handleReady,
    handlePlay,
    handlePause,
    handleEnded,
    handleTimeUpdate,
    togglePlay,
    toggleMute,
    openPip,
    seek
  };
}
