'use client';

import { videoDuration } from '@lib/duration';
import {
  closePopupPip,
  PopupPipState,
  PopupPipVideo,
  readPopupPipState,
  requestPopupPipDetail,
  subscribePopupPipState,
  writePopupPipState
} from '@lib/popup-pip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';
import { DetailPlayerIcon, FullscreenIcon, MuteIcon, PauseIcon, PlayIcon, VolumeIcon } from 'src/icons';

function getVideoIndex(state: PopupPipState | null) {
  if (!state) return -1;
  return state.playlist.findIndex((item) => item.videoId === state.video.videoId);
}

export default function PopupPipPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasClosedRef = useRef(false);
  const [state, setState] = useState<PopupPipState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showChrome, setShowChrome] = useState(true);

  const scheduleChromeHide = () => {
    if (chromeTimerRef.current) {
      clearTimeout(chromeTimerRef.current);
    }
    chromeTimerRef.current = setTimeout(() => {
      setShowChrome(false);
    }, 2200);
  };

  useEffect(() => {
    setState(readPopupPipState());
    return subscribePopupPipState((nextState) => {
      setState(nextState);
      setCurrentTime(0);
      setIsPlaying(false);
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !state) return;
    const initialTime = Math.max(0, state.video.currentTime || 0);
    video.muted = true;
    try {
      video.currentTime = initialTime;
    } catch {
      // Seek again when metadata is ready.
    }
    setCurrentTime(initialTime);
    setIsMuted(true);
    if (state.video.isPlaying === false) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
    setShowChrome(true);
  }, [state?.video.videoId]);

  useEffect(() => {
    const handleClose = () => {
      if (hasClosedRef.current) return;
      hasClosedRef.current = true;
      const video = videoRef.current;
      closePopupPip(video?.currentTime, video ? !video.paused : true);
    };

    window.addEventListener('beforeunload', handleClose);
    window.addEventListener('pagehide', handleClose);
    return () => {
      window.removeEventListener('beforeunload', handleClose);
      window.removeEventListener('pagehide', handleClose);
    };
  }, []);

  useEffect(() => {
    const handleBlur = () => scheduleChromeHide();
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  useEffect(() => {
    return () => {
      if (chromeTimerRef.current) {
        clearTimeout(chromeTimerRef.current);
      }
    };
  }, []);

  const activeIndex = useMemo(() => getVideoIndex(state), [state]);
  const canPrevious = Boolean(state && activeIndex > 0);
  const canNext = Boolean(state && activeIndex >= 0 && activeIndex < state.playlist.length - 1);
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const playVideo = useCallback((video: PopupPipVideo) => {
    if (!state) return;
    writePopupPipState({
      ...state,
      active: true,
      video
    });
  }, [state]);

  const goPrevious = () => {
    if (!state || !canPrevious) return;
    playVideo(state.playlist[activeIndex - 1]);
  };

  const goNext = () => {
    if (!state || !canNext) return;
    playVideo(state.playlist[activeIndex + 1]);
  };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play();
      setIsPlaying(true);
      return;
    }
    video.pause();
    setIsPlaying(false);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const openDetail = () => {
    const video = videoRef.current;
    requestPopupPipDetail(state.video.videoId, video?.currentTime || 0);
    closePopupPip(video?.currentTime, video ? !video.paused : true);
    window.opener?.focus();
    const pipWindow = window.parent && window.parent !== window ? window.parent : window;
    window.setTimeout(() => pipWindow.close(), 0);
  };

  const seek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    video.currentTime = (Number(event.target.value) / 100) * duration;
    setCurrentTime(video.currentTime);
  };

  const revealChrome = () => {
    if (chromeTimerRef.current) {
      clearTimeout(chromeTimerRef.current);
      chromeTimerRef.current = null;
    }
    setShowChrome(true);
  };

  if (!state) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#12131a] text-sm font-semibold text-white">
        No video is playing
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-black text-white">
      <section
        className="relative h-screen overflow-hidden bg-black"
        onPointerEnter={revealChrome}
        onPointerMove={revealChrome}
        onPointerLeave={scheduleChromeHide}
      >
        {state.video.poster ? (
          <div
            className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center opacity-70 blur-2xl"
            style={{ backgroundImage: `url(${state.video.poster})` }}
            aria-hidden
          />
        ) : null}
        <video
          key={state.video.videoId}
          ref={videoRef}
          src={state.video.src}
          poster={state.video.poster}
          autoPlay
          muted
          playsInline
          className="relative z-10 h-full w-full object-contain"
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedMetadata={(event) => {
            const initialTime = Math.max(0, state.video.currentTime || 0);
            const maxTime = Number.isFinite(event.currentTarget.duration)
              ? Math.max(0, event.currentTarget.duration - 0.05)
              : initialTime;
            event.currentTarget.currentTime = Math.min(initialTime, maxTime);
            setCurrentTime(event.currentTarget.currentTime);
            setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
            setIsMuted(event.currentTarget.muted);
          }}
          onCanPlay={(event) => {
            event.currentTarget.play()
              .then(() => setIsPlaying(true))
              .catch(() => setIsPlaying(false));
          }}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime);
            setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
          }}
        />

        <button
          type="button"
          onClick={togglePlay}
          className="absolute inset-0 z-20 flex cursor-pointer items-center justify-center bg-transparent"
          aria-label={isPlaying ? 'Pause video' : 'Play video'}
        >
          {!isPlaying ? (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm">
              <PlayIcon className="text-6xl" />
            </span>
          ) : null}
        </button>

        <button
          type="button"
          onClick={openDetail}
          className={`absolute left-3 top-3 z-30 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-black/45 text-sm text-white backdrop-blur-sm transition hover:bg-black/65 ${showChrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          aria-label="Open video detail"
          title="Open detail"
        >
          <DetailPlayerIcon className='text-xl' />
        </button>

        <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 h-32 bg-linear-to-t from-black/90 via-black/35 to-transparent transition-opacity duration-300 ${showChrome ? 'opacity-100' : 'opacity-0'}`} />
        <div className={`pointer-events-none absolute bottom-14 left-3 right-3 z-30 min-w-0 transition-opacity duration-300 ${showChrome ? 'opacity-100' : 'opacity-0'}`}>
          <div className="min-w-0 text-white drop-shadow">
            {state.video.author ? <div className="truncate text-xs font-semibold leading-4">{state.video.author}</div> : null}
            <div className="truncate text-[11px] font-medium leading-4 text-white/90">{state.video.description}</div>
          </div>
        </div>

        <div className={`absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col overflow-hidden rounded-full border border-white/10 bg-black/20 backdrop-blur-md transition-opacity duration-300 ${showChrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <button
            type="button"
            disabled={!canPrevious}
            onClick={goPrevious}
            className="flex h-10 w-10 cursor-pointer items-center justify-center text-white transition hover:bg-white/15 disabled:cursor-default disabled:opacity-30"
            aria-label="Previous video"
          >
            <FaChevronUp />
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={goNext}
            className="flex h-10 w-10 cursor-pointer items-center justify-center text-white transition hover:bg-white/15 disabled:cursor-default disabled:opacity-30"
            aria-label="Next video"
          >
            <FaChevronDown />
          </button>
        </div>

        <div className={`absolute inset-x-0 bottom-0 z-30 h-12 px-3 transition-opacity duration-300 ${showChrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progress}
            onChange={seek}
            aria-label="Seek video"
            style={{
              background: `linear-gradient(to right, rgba(255,255,255,.95) 0%, rgba(255,255,255,.95) ${progress}%, rgba(255,255,255,.24) ${progress}%, rgba(255,255,255,.24) 100%)`
            }}
            className="video-player-range absolute left-3 right-3 top-1.5 h-0.5 cursor-pointer appearance-none rounded-full"
          />
          <div className="absolute bottom-1.5 left-3 right-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={togglePlay}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-xs hover:bg-white/15"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <PauseIcon className='text-3xl' /> : <PlayIcon className='text-3xl' />}
              </button>
              <span className="text-[11px] font-semibold leading-none">{videoDuration(currentTime)} / {state.video.duration || videoDuration(duration)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleMute}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-sm hover:bg-white/15"
                aria-label={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <MuteIcon className='text-3xl' /> : <VolumeIcon className='text-3xl' />}
              </button>
              <button
                type="button"
                onClick={openDetail}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-xs hover:bg-white/15"
                aria-label="Open video detail"
                title="Open detail"
              >
                <FullscreenIcon className='text-3xl' />
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
