'use client';

import { getPopupVideo } from '@components/content/post/home-feed-media';
import { videoDuration } from '@lib/duration';
import {
  appendPopupPipVideo,
  closePopupPip,
  playPopupPipHistoryIndex,
  PopupPipState,
  readPopupPipState,
  requestPopupPipDetail,
  subscribePopupPipState,
  writePopupPipState
} from '@lib/popup-pip';
import { getRecommendationAnonymousId } from '@lib/recommendation-anonymous-id';
import {
  findOne,
  openPostDetailRecommendationSession,
  stepPostDetailRecommendationNext
} from '@services/post.service';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';
import { DetailPlayerIcon, FullscreenIcon, MuteIcon, PauseIcon, PlayIcon, VolumeIcon } from 'src/icons';

/**
 * How many times "next" may ask the server before giving up on this press.
 *
 * The server already filters to video posts, so a rejection here means the post
 * it named could not be fetched or has no playable URL — rare, and worth one or
 * two retries rather than reporting the end of the feed. It is bounded because
 * every ask appends that post to the detail session permanently.
 */
const MAX_NEXT_ATTEMPTS = 4;

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
  /** True while "next" is waiting on the server, so a double-press cannot skip two. */
  const [advancing, setAdvancing] = useState(false);
  /**
   * The viewer's own mute choice, kept across track changes.
   *
   * Every video used to start muted because the load effect assigned
   * `video.muted = true` unconditionally — so unmuting was undone by the next
   * press of "next". It starts true because autoplay requires it; once the
   * viewer has decided, that decision follows them through the session.
   */
  const preferredMutedRef = useRef(true);
  /** The videoId the load effect last applied, so bookkeeping-only state writes do not restart playback. */
  const appliedVideoIdRef = useRef<string | null>(null);

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
      // Only a genuine track change resets the transport. A write that merely
      // records the session id or the history cursor must not send the video
      // the viewer is watching back to 0:00.
      if (nextState?.video.videoId !== appliedVideoIdRef.current) {
        setCurrentTime(0);
        setIsPlaying(false);
      }
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !state) return;
    appliedVideoIdRef.current = state.video.videoId;
    const initialTime = Math.max(0, state.video.currentTime || 0);
    video.muted = preferredMutedRef.current;
    try {
      video.currentTime = initialTime;
    } catch {
      // Seek again when metadata is ready.
    }
    setCurrentTime(initialTime);
    setIsMuted(preferredMutedRef.current);
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

  const historyIndex = state?.historyIndex ?? -1;
  const historyLength = state?.history.length ?? 0;
  /** "Previous" is history only — it replays what was shown, never a fresh pick. */
  const canPrevious = Boolean(state && historyIndex > 0);
  /*
   * "Next" is available unless there is nowhere at all to go: nothing further
   * forward in history, the server out of candidates, and no history to wrap
   * around to. Disabling it merely because the array ends here would make a
   * one-round-trip wait indistinguishable from the end of the feed.
   */
  const canNext = Boolean(state) && !advancing
    && (historyIndex < historyLength - 1 || !state?.exhausted || historyLength > 1);
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const goPrevious = () => {
    if (!state || !canPrevious) return;
    playPopupPipHistoryIndex(state, historyIndex - 1);
  };

  /**
   * Advance to another recommended video.
   *
   * The candidate comes from the **Post Detail recommendation session** — the
   * same anchor-based sequence `useRecommendationDetailFeed` walks — rather than
   * from the Home grid's rendered order, which is what this used to follow. That
   * session excludes everything it has already handed out, so "next" cannot
   * return the post that is playing and cannot repeat one it has already shown;
   * `videoOnly` keeps it to posts this window can actually draw.
   *
   * Three outcomes, in order:
   *  1. The viewer stepped back earlier — replay the video ahead of them.
   *  2. The server names an unseen video — append it and play it.
   *  3. The server has none left — wrap to the start of this window's history.
   *     Deterministic on purpose: after exhaustion "next" walks the same
   *     sequence again in the same order, rather than picking at random from
   *     posts the viewer has just rejected.
   */
  const goNext = useCallback(async () => {
    if (!state || advancing) return;

    if (historyIndex < historyLength - 1) {
      playPopupPipHistoryIndex(state, historyIndex + 1);
      return;
    }

    const anonymousId = getRecommendationAnonymousId() || undefined;
    const anchorPostId = state.video.postId;
    setAdvancing(true);
    try {
      let sessionId = state.sessionId || null;
      if (!sessionId && anchorPostId) {
        const opened = await openPostDetailRecommendationSession(anchorPostId, anonymousId);
        sessionId = opened?.data?.sessionId || null;
      }

      if (sessionId) {
        const knownPostIds = new Set(state.history.map((item) => item.postId));
        for (let attempt = 0; attempt < MAX_NEXT_ATTEMPTS; attempt += 1) {

          const step = await stepPostDetailRecommendationNext(sessionId, anonymousId, true);
          const nextPostId = step?.data?.postId;
          if (!nextPostId) break; // The session has nothing unseen left.
          if (knownPostIds.has(nextPostId)) continue;

          const response = await findOne(nextPostId).catch(() => null);
          const payload = response?.data ? getPopupVideo(response.data) : null;
          // No payload means the post lost its video between being ranked and
          // being fetched. Ask again rather than reporting the end of the feed.
          if (!payload) continue;

          appendPopupPipVideo(state, payload, sessionId);
          return;
        }
      }

      // Exhausted (or no anchor to open a session from): recycle through this
      // window's own history, which is the one sequence guaranteed playable.
      if (historyLength > 1) {
        writePopupPipState({
          ...state, active: true, video: state.history[0], historyIndex: 0, sessionId, exhausted: true
        });
        return;
      }
      writePopupPipState({ ...state, sessionId, exhausted: true });
    } catch {
      // A failed round trip is not the end of the sequence; leave the state
      // alone so the next press tries again.
    } finally {
      setAdvancing(false);
    }
  }, [advancing, historyIndex, historyLength, state]);

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
    // Remembered, so moving to the next video does not silently re-mute.
    preferredMutedRef.current = video.muted;
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
            // The element is created muted (autoplay), so read the remembered
            // choice rather than the element's own starting value.
            event.currentTarget.muted = preferredMutedRef.current;
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
            onClick={() => {
 void goNext();
}}
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
