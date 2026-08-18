import { VIDEO_PLAYER_EVENT } from '@constants/event';
import { useCallback, useEffect, useEffectEvent, useRef } from 'react';

import { useIsInViewport } from './use-is-in-viewport';

interface VideoManagerOptions {
  /** Whether to pause videos when container is out of viewport */
  pauseOnOutOfView?: boolean;
  /** Whether to pause videos when switching slides/content */
  pauseOnSlideChange?: boolean;
  /** Threshold for viewport detection (0-1) */
  viewportThreshold?: number;
}

/**
 * useVideoManager - Advanced hook for managing video players lifecycle and behavior
 *
 * A comprehensive video management solution that handles multiple video players within
 * a container, providing automatic pause/play behavior based on viewport visibility
 * and slide changes. Essential for carousel-based video content and post displays.
 *
 * Features:
 * - Automatic video pause when container scrolls out of viewport
 * - Video pause when switching slides in carousels
 * - Centralized video reference management with registration system
 * - Proper cleanup on component unmount to prevent memory leaks
 * - Error handling for video operations with graceful fallbacks
 * - Viewport intersection detection with configurable threshold
 * - Autoplay functionality with delay support for smooth transitions
 * - Batch video operations (pause all, play specific video)
 *
 * Video Registration System:
 * - Videos register themselves with the manager on mount
 * - Manager maintains references to all video players
 * - Automatic cleanup when videos unmount
 * - Support for both HTML5 video elements and video.js players
 *
 * Viewport Management:
 * - Uses Intersection Observer API for efficient viewport detection
 * - Configurable threshold for when videos should pause/play
 * - Automatic pause when container is not visible
 * - Resume capability when container comes back into view
 *
 * Usage:
 * ```tsx
 * const {
 *   containerRef,
 *   registerVideo,
 *   unregisterVideo,
 *   handleSlideChange,
 *   autoplayVideoOnSlide,
 *   isInViewport
 * } = useVideoManager({
 *   pauseOnOutOfView: true,
 *   pauseOnSlideChange: true,
 *   viewportThreshold: 0.5
 * });
 *
 * // In your component
 * <div ref={containerRef}>
 *   <VideoPlayer onReady={(player) => registerVideo('video1', player)} />
 * </div>
 * ```
 */
export function useVideoManager(options: VideoManagerOptions = {}) {
  const {
    pauseOnOutOfView = true,
    pauseOnSlideChange = true,
    viewportThreshold = 0.5
  } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<{ [key: string]: any }>({});
  const isInViewport = useIsInViewport(containerRef, viewportThreshold);

  // Helper function to check if player is ready and safe to use
  const isPlayerReady = useCallback((player: any) => {
    try {
      // Check if it's a simplified player interface (as used in PostMediaDisplay)
      if (player && typeof player.pause === 'function' && typeof player.play === 'function' && typeof player.isDisposed === 'function') {
        return !player.isDisposed();
      }

      // Check if it's an HTML5 media element. Audio posts share this manager so
      // scrolling away can pause either video or audio playback.
      if (player && player instanceof HTMLMediaElement) {
        return !player.error;
      }

      // Check if it's a video.js player
      return player &&
        typeof player.pause === 'function' &&
        typeof player.play === 'function' &&
        !player.isDisposed() &&
        player.tech_ &&
        player.tech_.el_ &&
        player.readyState &&
        player.readyState() > 0;
    } catch {
      return false;
    }
  }, []);

  // Pause all videos in this manager
  const pauseAllVideos = useCallback(() => {
    if (videoRefs.current) {
      Object.keys(videoRefs.current).forEach((id) => {
        const player = videoRefs.current[id];
        if (isPlayerReady(player)) {
          try {
            player.pause();
          } catch {
            // Remove the problematic player from refs
            delete videoRefs.current[id];
          }
        }
      });
    }
  }, [isPlayerReady]);

  // Play specific video by ID
  const playVideo = useCallback((videoId: string) => {
    const player = videoRefs.current[videoId];
    if (isPlayerReady(player)) {
      try {
        player.play();
      } catch {
        // Remove the problematic player from refs
        delete videoRefs.current[videoId];
      }
    }
  }, [isPlayerReady]);

  // Pause specific video by ID
  const pauseVideo = useCallback((videoId: string) => {
    const player = videoRefs.current[videoId];
    if (isPlayerReady(player)) {
      try {
        player.pause();
      } catch {
        // Remove the problematic player from refs
        delete videoRefs.current[videoId];
      }
    }
  }, [isPlayerReady]);

  // Register a video player
  const registerVideo = useCallback((videoId: string, player: any) => {
    videoRefs.current[videoId] = player;
  }, []);

  // Unregister a video player
  const unregisterVideo = useCallback((videoId: string) => {
    if (videoRefs.current[videoId]) {
      delete videoRefs.current[videoId];
    }
  }, []);

  // Get all registered video IDs
  const getVideoIds = useCallback(() => {
    return Object.keys(videoRefs.current);
  }, []);

  // Check if a video is registered
  const hasVideo = useCallback((videoId: string) => {
    return !!videoRefs.current[videoId];
  }, []);

  // Pause videos when out of viewport
  const handleViewportChange = useEffectEvent(() => {
    if (pauseOnOutOfView && !isInViewport) {
      pauseAllVideos();
    }
  });

  useEffect(() => {
    handleViewportChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInViewport, pauseOnOutOfView]);

  // Cleanup on unmount
  const handleCleanup = useEffectEvent(() => {
    pauseAllVideos();
    videoRefs.current = {};
  });

  useEffect(() => {
    return () => {
      handleCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handler for slide changes (to be used with carousels)
  const handleSlideChange = useCallback((currentSlide: number) => {
    if (pauseOnSlideChange) {
      pauseAllVideos();
    }
    return currentSlide;
  }, [pauseOnSlideChange, pauseAllVideos]);

  // Autoplay video on specific slide (with delay for slide transition)
  const autoplayVideoOnSlide = useCallback((videoId: string, delay: number = 300) => {
    const player = videoRefs.current[videoId];
    if (isPlayerReady(player) && isInViewport) {
      setTimeout(() => {
        if (isPlayerReady(player)) {
          try {
            player.play();
            // eslint-disable-next-line no-empty
          } catch { }
        }
      }, delay);
    }
  }, [isPlayerReady, isInViewport]);

  // Notify global manager that a video is playing
  const notifyVideoPlay = useCallback((videoId: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VIDEO_PLAYER_EVENT, { detail: { videoId } }));
    }
  }, []);

  // Listen for global play event to pause other videos
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleGlobalPlay = (event: Event) => {
      const customEvent = event as CustomEvent<{ videoId: string }>;
      const playingVideoId = customEvent.detail.videoId;

      // Check if the playing video is managed by this instance
      const isMyVideo = !!videoRefs.current[playingVideoId];

      if (isMyVideo) {
        // If it's my video, pause all OTHER videos in this instance
        Object.keys(videoRefs.current).forEach((id) => {
          if (id !== playingVideoId) {
            const player = videoRefs.current[id];
            if (isPlayerReady(player)) {
              try {
                player.pause();
              } catch {
                // Ignore errors
              }
            }
          }
        });
      } else {
        // If it's not my video, pause ALL videos in this instance
        pauseAllVideos();
      }
    };

    window.addEventListener(VIDEO_PLAYER_EVENT, handleGlobalPlay);
    return () => {
      window.removeEventListener(VIDEO_PLAYER_EVENT, handleGlobalPlay);
    };
  }, [pauseAllVideos, isPlayerReady]);

  return {
    // Refs
    containerRef,

    // Video management
    pauseAllVideos,
    playVideo,
    pauseVideo,
    autoplayVideoOnSlide,
    registerVideo,
    unregisterVideo,
    notifyVideoPlay,

    // Utilities
    getVideoIds,
    hasVideo,
    handleSlideChange,

    // State
    isInViewport
  };
}

export default useVideoManager;
