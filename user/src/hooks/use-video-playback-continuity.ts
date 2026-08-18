'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useVideoPlaybackContinuity(activeVideoId?: string) {
  const playbackTimesRef = useRef(new Map<string, number>());
  const [resumeTime, setResumeTime] = useState(0);

  const getPlaybackTime = useCallback((videoId?: string) => {
    if (!videoId) return 0;
    return playbackTimesRef.current.get(videoId) || 0;
  }, []);

  const rememberPlaybackTime = useCallback((videoId: string | undefined, currentTime: number) => {
    if (!videoId || !Number.isFinite(currentTime)) return;
    playbackTimesRef.current.set(videoId, Math.max(0, currentTime));
  }, []);

  const resumePlayback = useCallback((videoId?: string, currentTime?: number) => {
    if (!videoId) return 0;
    if (Number.isFinite(currentTime)) {
      rememberPlaybackTime(videoId, currentTime as number);
    }
    const nextTime = getPlaybackTime(videoId);
    if (videoId === activeVideoId) setResumeTime(nextTime);
    return nextTime;
  }, [activeVideoId, getPlaybackTime, rememberPlaybackTime]);

  useEffect(() => {
    setResumeTime(getPlaybackTime(activeVideoId));
  }, [activeVideoId, getPlaybackTime]);

  return {
    resumeTime,
    getPlaybackTime,
    rememberPlaybackTime,
    resumePlayback
  };
}
