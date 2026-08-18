'use client';

import { VIDEO_PLAYER_EVENT } from '@constants/event';
import { useIsInViewport } from '@hooks/use-is-in-viewport';
import { videoDuration } from '@lib/duration';
import {
  openPopupPip,
  PopupPipState,
  PopupPipVideo,
  readPopupPipState,
  subscribePopupPipState
} from '@lib/popup-pip';
import {
  ChangeEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { AddToWatchLaterIcon, FullscreenIcon, MuteIcon, PauseIcon, PiPIcon, PlayIcon, VolumeIcon } from 'src/icons';
import { isIOS } from 'src/utils/device';

import VideoVolumeControl from './video-volume-control';

interface VideoPlayerProps {
  id: string;
  src: string;
  poster?: string;
  muted?: boolean;
  controls?: boolean;
  preload?: 'auto' | 'metadata' | 'none';
  className?: string;
  classVideo?: string;
  alwaysShowControls?: boolean;
  initialTime?: number;

  // Carousel integration
  isActiveSlide?: boolean;
  autoplayOnActive?: boolean;

  // Event callbacks
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onVolumeChange?: (volume: number, muted: boolean) => void;
  onError?: (error: any) => void;
  onReady?: (videoElement: HTMLVideoElement) => void;
  onPictureInPictureOpen?: () => void;

  // External control callbacks
  onPlayingStateChange?: (isPlaying: boolean, videoId: string) => void;
  pictureInPicturePayload?: PopupPipVideo;
  pictureInPicturePlaylist?: PopupPipVideo[];
  showFullscreenControl?: boolean;
  showVolumeSlider?: boolean;
  forceBackgroundBlur?: boolean;
  showCenterPlayButton?: boolean;
  objectFit?: 'auto' | 'contain' | 'cover' | 'portrait-cover';
  /** Skip rendering the built-in "Currently playing" overlay — use when a parent renders its own PiP-active overlay covering a larger area. */
  suppressPictureInPictureOverlay?: boolean;
}

export interface VideoPlayerRef {
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  mute: () => void;
  unmute: () => void;
  getVolume: () => number;
  isMuted: () => boolean;
  isPaused: () => boolean;
  togglePictureInPicture: () => Promise<void>;
  getVideoElement: () => HTMLVideoElement | null;
}

const VideoPlayer = forwardRef<VideoPlayerRef, VideoPlayerProps>(({
  id,
  src,
  poster,
  muted = false,
  controls = true,
  preload = 'metadata',
  className = '',
  classVideo = '',
  alwaysShowControls = false,
  initialTime = 0,
  isActiveSlide = true,
  autoplayOnActive = false,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  onVolumeChange,
  onError,
  onReady,
  onPictureInPictureOpen,
  onPlayingStateChange,
  pictureInPicturePayload,
  pictureInPicturePlaylist,
  showFullscreenControl = true,
  showVolumeSlider = false,
  forceBackgroundBlur = false,
  showCenterPlayButton = false,
  objectFit = 'contain',
  suppressPictureInPictureOverlay = false,
  ...rest
}, ref) => {
  const videoElementRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressPauseInteractionRef = useRef(false);
  const autoplayAttemptKeyRef = useRef<string | null>(null);
  const lastAudibleVolumeRef = useRef(1);
  const isIntersecting = useIsInViewport(videoElementRef);
  const [isPlaying, setIsPlaying] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false); // Track if user manually paused
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(muted ? 0 : 1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isSeeking, setIsSeeking] = useState(false);
  const [isMuted, setIsMuted] = useState(!!muted);
  const [isPortraitVideo, setIsPortraitVideo] = useState(false);
  const [pictureInPictureState, setPictureInPictureState] = useState<PopupPipState | null>(() => readPopupPipState());
  const pictureInPictureVideoId = pictureInPicturePayload?.videoId || id;
  const isCurrentPictureInPicture = pictureInPictureState?.active
    && pictureInPictureState.video.videoId === pictureInPictureVideoId;
  const shouldShowBackgroundBlur = Boolean(poster && (forceBackgroundBlur || isPortraitVideo));
  const shouldCoverVideo = objectFit === 'auto'
    ? !isPortraitVideo
    : objectFit === 'portrait-cover'
      ? isPortraitVideo
      : objectFit === 'cover';

  // Handle play event
  const handlePlay = useCallback(() => {
    // Always dispatch global event to pause other videos, regardless of current state
    // This ensures other videos are paused even if there's a state sync issue
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(VIDEO_PLAYER_EVENT, { detail: { videoId: id } }));
    }

    if (!isPlaying) {
      setIsPlaying(true);
      // Reset user interaction flag when they manually play
      setUserInteracted(false);
      onPlay?.();
      onPlayingStateChange?.(true, id);
      // turn on volume if not muted
      if (!muted && !userInteracted) {
        videoElementRef.current.muted = false;
        videoElementRef.current.volume = 1;
        setVolume(1);
      }
    }
  }, [id, isPlaying, muted, onPlay, onPlayingStateChange, userInteracted]);

  // Handle pause event
  const handlePause = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      if (suppressPauseInteractionRef.current) {
        suppressPauseInteractionRef.current = false;
        setUserInteracted(false);
      } else {
        setUserInteracted(true);
      }
      onPause?.();
      onPlayingStateChange?.(false, id);
    }
  }, [isPlaying, onPause, onPlayingStateChange, id]);

  // Handle ended event
  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    onEnded?.();
    onPlayingStateChange?.(false, id);
  }, [onEnded, onPlayingStateChange, id]);

  // Handle time update
  const handleTimeUpdate = useCallback(() => {
    if (videoElementRef.current) {
      const currentTime = videoElementRef.current.currentTime;
      const duration = videoElementRef.current.duration;
      if (!isSeeking) {
        setCurrentTime(currentTime);
      }
      setDuration(Number.isFinite(duration) ? duration : 0);
      onTimeUpdate?.(currentTime, duration);
    }
  }, [isSeeking, onTimeUpdate]);

  // Handle volume change
  const handleVolumeChange = useCallback(() => {
    if (videoElementRef.current) {
      const volume = videoElementRef.current.volume;
      const muted = videoElementRef.current.muted;
      if (!muted && volume > 0) lastAudibleVolumeRef.current = volume;
      setVolume(volume);
      setIsMuted(muted || volume === 0);
      onVolumeChange?.(volume, muted);
    }
  }, [onVolumeChange]);

  // Handle error
  const handleError = useCallback((error: any) => {
    setIsPlaying(false);
    onError?.(error);
    onPlayingStateChange?.(false, id);
  }, [onError, onPlayingStateChange, id]);

  // Setup video element when ready
  useEffect(() => {
    if (!videoElementRef.current) return;

    const videoElement = videoElementRef.current;
    const nextInitialTime = Math.max(0, initialTime || 0);
    videoElement.muted = muted;
    videoElement.defaultMuted = muted;
    try {
      videoElement.currentTime = nextInitialTime;
    } catch {
      // Apply the initial position again after media metadata is available.
    }
    autoplayAttemptKeyRef.current = null;
    setCurrentTime(nextInitialTime);
    setIsPlaying(false);
    setUserInteracted(false);
    setIsPortraitVideo(false);
    setIsMuted(muted);
    setVolume(muted ? 0 : videoElement.volume || 1);
  }, [initialTime, muted, src]);

  // Reset player-local state when the media source changes.
  useEffect(() => {
    if (!videoElementRef.current) return;

    const videoElement = videoElementRef.current;
    // Add event listeners
    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('ended', handleEnded);
    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('volumechange', handleVolumeChange);
    videoElement.addEventListener('error', handleError);

    const updateVideoOrientation = () => {
      if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        setIsPortraitVideo(videoElement.videoHeight > videoElement.videoWidth);
      }
    };

    // Call onReady when video is loaded
    const handleLoadedData = () => {
      const nextInitialTime = Math.max(0, initialTime || 0);
      if (nextInitialTime > 0 && Math.abs(videoElement.currentTime - nextInitialTime) > 0.25) {
        const maxTime = Number.isFinite(videoElement.duration)
          ? Math.max(0, videoElement.duration - 0.05)
          : nextInitialTime;
        videoElement.currentTime = Math.min(nextInitialTime, maxTime);
      }
      setDuration(Number.isFinite(videoElement.duration) ? videoElement.duration : 0);
      setCurrentTime(videoElement.currentTime || 0);
      setVolume(videoElement.volume);
      setIsMuted(videoElement.muted || videoElement.volume === 0);
      updateVideoOrientation();
      onReady?.(videoElement);
    };
    const handleDurationChange = () => {
      setDuration(Number.isFinite(videoElement.duration) ? videoElement.duration : 0);
    };
    videoElement.addEventListener('loadeddata', handleLoadedData);
    videoElement.addEventListener('loadedmetadata', updateVideoOrientation);
    videoElement.addEventListener('durationchange', handleDurationChange);
    updateVideoOrientation();

    return () => {
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('ended', handleEnded);
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('volumechange', handleVolumeChange);
      videoElement.removeEventListener('error', handleError);
      videoElement.removeEventListener('loadeddata', handleLoadedData);
      videoElement.removeEventListener('loadedmetadata', updateVideoOrientation);
      videoElement.removeEventListener('durationchange', handleDurationChange);
    };
  }, [handlePlay, handlePause, handleEnded, handleTimeUpdate, handleVolumeChange, handleError, initialTime, onReady]);

  // Reset user interaction when slide becomes active (allow autoplay on new slides)
  useEffect(() => {
    if (isActiveSlide) {
      setUserInteracted(false);
    }
  }, [isActiveSlide]);

  useEffect(() => {
    if (!isActiveSlide || !autoplayOnActive || !isIntersecting) {
      autoplayAttemptKeyRef.current = null;
    }
  }, [isActiveSlide, autoplayOnActive, isIntersecting]);

  // Handle autoplay when slide becomes active
  useEffect(() => {
    if (!videoElementRef.current || !isIntersecting || !isActiveSlide || !autoplayOnActive || userInteracted) return;

    const autoplayKey = `${id}:${src}`;
    if (autoplayAttemptKeyRef.current === autoplayKey) return;
    autoplayAttemptKeyRef.current = autoplayKey;

    const timer = setTimeout(async () => {
      const videoElement = videoElementRef.current;
      if (!videoElement || !videoElement.paused) return;

      try {
        videoElement.muted = true;
        setIsMuted(true);
        setVolume(0);
        await videoElement.play();
      } catch {
        // If autoplay fails, leave the player ready for manual playback.
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [isActiveSlide, autoplayOnActive, isIntersecting, userInteracted, id, src]);

  // Handle viewport intersection (auto pause when out of view)
  useEffect(() => {
    if (!videoElementRef.current) return;

    if (!isIntersecting && isPlaying) {
      videoElementRef.current.pause();
    }
  }, [isIntersecting, isPlaying]);

  useEffect(() => {
    if (isFullscreen) {
      videoElementRef.current.play && videoElementRef.current.play().catch(() => {
        // ignore error
      });
    }
  }, [isFullscreen]);

  // Listen for global video play events to pause this video when others start
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleGlobalVideoPlay = (event: Event) => {
      const customEvent = event as CustomEvent<{ videoId: string }>;
      const playingVideoId = customEvent.detail.videoId;

      // If another video is playing and this one is currently playing, pause this one
      // Check the actual video element state, not just the React state, to ensure we catch all playing videos
      if (playingVideoId !== id && videoElementRef.current && !videoElementRef.current.paused) {
        suppressPauseInteractionRef.current = true;
        videoElementRef.current.pause();
        setUserInteracted(false);
      }
    };

    window.addEventListener(VIDEO_PLAYER_EVENT, handleGlobalVideoPlay);
    return () => {
      window.removeEventListener(VIDEO_PLAYER_EVENT, handleGlobalVideoPlay);
    };
  }, [id]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onFullscreenChange = () => {
      const fsEl = document.fullscreenElement as HTMLElement | null;
      setIsFullscreen(Boolean(fsEl && wrapperRef.current && (fsEl === wrapperRef.current || wrapperRef.current.contains(fsEl))));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    setPictureInPictureState(readPopupPipState());
    return subscribePopupPipState((nextState) => {
      setPictureInPictureState(nextState);
      if (nextState && !nextState.active && nextState.video.videoId === pictureInPictureVideoId) {
        setUserInteracted(false);
        autoplayAttemptKeyRef.current = null;
      }
    });
  }, [pictureInPictureVideoId]);

  // iOS Safari only exposes fullscreen via the video element (webkitEnterFullscreen).
  // document.fullscreenchange does not fire for that path; use WebKit-specific events.
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video || !isIOS()) return;

    const onWebkitBeginFullscreen = () => setIsFullscreen(true);
    const onWebkitEndFullscreen = () => setIsFullscreen(false);

    video.addEventListener('webkitbeginfullscreen', onWebkitBeginFullscreen);
    video.addEventListener('webkitendfullscreen', onWebkitEndFullscreen);
    return () => {
      video.removeEventListener('webkitbeginfullscreen', onWebkitBeginFullscreen);
      video.removeEventListener('webkitendfullscreen', onWebkitEndFullscreen);
    };
  }, [id, src]);

  useEffect(() => {
    return () => {
      if (controlsHideTimerRef.current) {
        clearTimeout(controlsHideTimerRef.current);
      }
    };
  }, []);

  const keepControlsVisible = useCallback(() => {
    setShowControls(true);
    if (!controls) return;
    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current);
    }
    if (isPlaying && !isSeeking) {
      controlsHideTimerRef.current = setTimeout(() => setShowControls(false), 2200);
    }
  }, [controls, isPlaying, isSeeking]);

  const handlePlayPauseClick = useCallback(async () => {
    if (!videoElementRef.current) return;
    keepControlsVisible();
    if (videoElementRef.current.paused) {
      try {
        await videoElementRef.current.play();
      } catch {
        // keep silent, user can retry
      }
      return;
    }
    videoElementRef.current.pause();
  }, [keepControlsVisible]);

  const handleSeek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    if (!videoElementRef.current) return;
    const nextPercent = Number(event.target.value);
    const nextDuration = videoElementRef.current.duration;
    if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;
    const nextTime = (nextPercent / 100) * nextDuration;
    videoElementRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
    keepControlsVisible();
  }, [keepControlsVisible]);

  const toggleMute = useCallback(() => {
    if (!videoElementRef.current) return;
    const el = videoElementRef.current;
    if (el.muted || el.volume === 0) {
      const fallbackVolume = lastAudibleVolumeRef.current;
      el.muted = false;
      el.volume = fallbackVolume;
      setVolume(fallbackVolume);
    } else {
      el.muted = true;
    }
    keepControlsVisible();
  }, [keepControlsVisible]);

  const handleVolumeChangeInput = useCallback((nextVolume: number) => {
    if (!videoElementRef.current) return;
    const normalizedVolume = Math.max(0, Math.min(1, nextVolume));
    const video = videoElementRef.current;
    video.volume = normalizedVolume;
    video.muted = normalizedVolume === 0;
    if (normalizedVolume > 0) lastAudibleVolumeRef.current = normalizedVolume;
    setVolume(normalizedVolume);
    setIsMuted(normalizedVolume === 0);
    keepControlsVisible();
  }, [keepControlsVisible]);

  const toggleFullscreen = useCallback(async () => {
    if (!wrapperRef.current || typeof document === 'undefined') return;
    keepControlsVisible();
    const video = videoElementRef.current;
    const webkitVideo = video as
      | (HTMLVideoElement & {
        webkitEnterFullscreen?: () => void;
        webkitExitFullscreen?: () => void;
      })
      | null;

    try {

      // iOS: only the native video element can enter fullscreen (not the wrapper div).
      if (isIOS() && webkitVideo) {
        if (isFullscreen && typeof webkitVideo.webkitExitFullscreen === 'function') {
          webkitVideo.webkitExitFullscreen();
          return;
        }
        if (typeof webkitVideo.webkitEnterFullscreen === 'function') {
          webkitVideo.webkitEnterFullscreen();
          return;
        }
      }

      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }

      await wrapperRef.current.requestFullscreen();
    } catch {
      // ignore unsupported fullscreen environments
    }
  }, [keepControlsVisible, isFullscreen]);

  const togglePictureInPicture = useCallback(async () => {
    keepControlsVisible();
    const payload = pictureInPicturePayload || {
      videoId: id,
      src,
      poster,
      title: '',
      description: ''
    };
    openPopupPip(payload, pictureInPicturePlaylist || [payload], {
      videoElement: videoElementRef.current
    });
    videoElementRef.current?.pause();
    onPictureInPictureOpen?.();
  }, [id, keepControlsVisible, onPictureInPictureOpen, pictureInPicturePayload, pictureInPicturePlaylist, poster, src]);

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  // Expose video control methods
  useImperativeHandle(ref, () => ({
    play: async () => {
      if (videoElementRef.current) {
        await videoElementRef.current.play();
      }
    },
    pause: () => {
      if (videoElementRef.current) {
        videoElementRef.current.pause();
      }
    },
    stop: () => {
      if (videoElementRef.current) {
        videoElementRef.current.pause();
        videoElementRef.current.currentTime = 0;
      }
    },
    seek: (time: number) => {
      if (videoElementRef.current) {
        videoElementRef.current.currentTime = time;
      }
    },
    setVolume: (volume: number) => {
      if (videoElementRef.current) {
        videoElementRef.current.volume = Math.max(0, Math.min(1, volume));
      }
    },
    mute: () => {
      if (videoElementRef.current) {
        videoElementRef.current.muted = true;
      }
    },
    unmute: () => {
      if (videoElementRef.current) {
        videoElementRef.current.muted = false;
      }
    },
    getVolume: () => {
      return videoElementRef.current?.volume || 0;
    },
    isMuted: () => {
      return videoElementRef.current?.muted || false;
    },
    isPaused: () => {
      return videoElementRef.current?.paused ?? true;
    },
    togglePictureInPicture,
    getVideoElement: () => {
      return videoElementRef.current;
    }
  }), [togglePictureInPicture]);

  return (
    <div
      ref={wrapperRef}
      className={`group relative flex h-full min-h-75 w-full items-center justify-center overflow-hidden bg-black ${className}`}
      onMouseMove={keepControlsVisible}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onTouchStart={keepControlsVisible}
    >
      {shouldShowBackgroundBlur ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 scale-110 bg-cover bg-center opacity-70 blur-2xl"
          style={{ backgroundImage: `url(${poster})` }}
          aria-hidden
        />
      ) : null}
      <video
        ref={videoElementRef}
        className={`relative z-10 h-full w-full ${shouldShowBackgroundBlur ? 'bg-transparent' : 'bg-black'} ${shouldCoverVideo ? 'object-cover' : 'object-contain'} ${classVideo} ${isCurrentPictureInPicture ? 'opacity-0' : ''}`}
        data-video-id={id}
        src={src}
        poster={poster}
        controls={false}
        controlsList="nodownload noplaybackrate"
        muted={muted}
        preload={preload}
        onClick={controls ? handlePlayPauseClick : undefined}
        playsInline
        // eslint-disable-next-line react/no-unknown-property
        webkit-playsinline="true"
        {...rest}
        onLoadedMetadata={(event) => {
          setIsPortraitVideo(event.currentTarget.videoHeight > event.currentTarget.videoWidth);
        }}
      />
      {controls && showCenterPlayButton && !isCurrentPictureInPicture ? (
        <button
          type="button"
          onClick={handlePlayPauseClick}
          className="absolute inset-0 z-15 flex cursor-pointer items-center justify-center bg-transparent"
          aria-label={isPlaying ? 'Pause video' : 'Play video'}
        >
          {!isPlaying ? (
            <span className="flex h-18 w-18 items-center justify-center rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm">
              <PlayIcon className="text-7xl" />
            </span>
          ) : null}
        </button>
      ) : null}
      {isCurrentPictureInPicture && !suppressPictureInPictureOverlay ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden bg-black">
          {poster ? (
            <div
              className="absolute inset-0 scale-110 bg-cover bg-center opacity-55 blur-xl"
              style={{ backgroundImage: `url(${poster})` }}
              aria-hidden
            />
          ) : null}
          <div className="relative z-10 flex flex-col items-center gap-2 text-sm font-semibold text-white">
            <span className="currently-playing-bars flex h-7 items-end gap-0.5" aria-hidden>
              <i className="h-3 w-1 rounded-full bg-white" />
              <i className="h-5 w-1 rounded-full bg-white" />
              <i className="h-4 w-1 rounded-full bg-white" />
            </span>
            <span>Currently playing</span>
          </div>
        </div>
      ) : null}
      {controls && !isCurrentPictureInPicture ? (
        <div
          className={`absolute inset-x-0 bottom-0 z-50 bg-linear-to-t from-black/95 via-black/70 to-transparent px-3 pb-2 pt-7 text-white transition-opacity duration-300 sm:px-4 ${alwaysShowControls || showControls || !isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <div className="absolute left-4 right-4 top-2">
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={progress}
              aria-label="Seek video"
              onMouseDown={() => setIsSeeking(true)}
              onMouseUp={() => setIsSeeking(false)}
              onTouchStart={() => setIsSeeking(true)}
              onTouchEnd={() => setIsSeeking(false)}
              onChange={handleSeek}
              style={{
                background: `linear-gradient(to right, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.95) ${progress}%, rgba(255, 255, 255, 0.22) ${progress}%, rgba(255, 255, 255, 0.22) 100%)`
              }}
              className="video-player-range h-1 w-full cursor-pointer appearance-none rounded-full"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={handlePlayPauseClick}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm hover:bg-white/15"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <PauseIcon className='text-3xl' /> : <PlayIcon className='text-3xl' />}
              </button>
              <div className="min-w-21.5 text-xs font-semibold text-white">
                {`${videoDuration(currentTime)} / ${videoDuration(duration)}`}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xl hover:bg-white/15"
                aria-label="Add to watch later"
              >
                <AddToWatchLaterIcon className='text-3xl' />
              </button>
              <button
                type="button"
                onClick={togglePictureInPicture}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-base hover:bg-white/15"
                aria-label="Picture in picture"
              >
                <PiPIcon className='text-3xl' />
              </button>
              {showVolumeSlider ? (
                <VideoVolumeControl
                  volume={volume}
                  muted={isMuted}
                  onChange={handleVolumeChangeInput}
                  onToggleMute={toggleMute}
                />
              ) : (
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm hover:bg-white/15"
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  onClick={toggleMute}
                >
                  {isMuted ? <MuteIcon className='text-3xl' /> : <VolumeIcon className='text-3xl' />}
                </button>
              )}
              {showFullscreenControl ? (
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs hover:bg-white/15"
                  aria-label="Toggle fullscreen"
                >
                  <FullscreenIcon className='text-3xl' />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
