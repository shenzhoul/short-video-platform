'use client';

import { useCallback, useEffect, useRef } from 'react';

import { enqueueRecommendationEvent, RecommendationEventSource } from '../lib/recommendation-event-queue';
import { RECOMMENDATION_CLIENT_POLICY } from '../lib/recommendation-policy';

interface UseRecommendationWatchTrackingOptions {
  enabled: boolean;
  postId: string | undefined;
  sessionId: string | null | undefined;
  source: RecommendationEventSource;
}

/**
 * Video watch signal for the recommendation engine: `final_watch` (sent on
 * pause/end/leave/unmount, and again on a later pause/end/leave/unmount in
 * the same exposure if watch progress advanced since the last flush — see
 * `flushFinalWatch`), `completion` (server dedupes), and `replay`
 * (intentionally repeatable — see `RecommendationEventService`).
 *
 * Deliberately does **not** send a standalone `quick_skip` event. The
 * server's own `FINAL_WATCH` handling already classifies a low-ratio,
 * short-duration watch as a quick skip from `watchMs`/`durationMs` alone
 * (rules/instructions §6.4's three-way split — "never started" vs "left
 * quickly" vs "short video, mostly watched" — is exactly what ratio +
 * absolute-ms thresholds already distinguish). Sending a second, client-
 * classified `quick_skip` event for the same exposure would just be a
 * redundant, unauthoritative echo of what the server already derives more
 * reliably from the clamped numbers. "Never started" (`hasStartedRef` still
 * false) sends nothing at all — the video genuinely produced no watch
 * signal, which is a real, distinct case, not a punishable skip.
 *
 * Composed at the call site into the existing `onTimeUpdate`/`onPause`/
 * `onEnded` handlers already wired for playback (`usePostVideoHoverPlayback`,
 * `PostVideoStage`) — this hook never touches the `<video>` element or those
 * handlers directly, so it cannot regress the playback/perf work those own.
 */
export function useRecommendationWatchTracking({
  enabled, postId, sessionId, source
}: UseRecommendationWatchTrackingOptions) {
  const maxWatchedSecondsRef = useRef(0);
  const durationSecondsRef = useRef(0);
  const hasStartedRef = useRef(false);
  const hasReachedNearEndRef = useRef(false);
  const previousTimeRef = useRef(0);
  // Watermark of what was already reported for this exposure, *not* a
  // one-shot "have I ever flushed" latch — a viewer who pauses at 2s, then
  // resumes and watches to 8s before finally leaving, must produce a second,
  // larger `final_watch` so the server's monotonic delta-merge (rules/
  // instructions §1.1/§1.4's "pause rồi quay lại xem tiếp") has something to
  // correct. A one-shot latch here would make that server logic unreachable.
  const lastFlushedWatchedSecondsRef = useRef(0);
  const completionSentRef = useRef(false);

  const exposureKey = enabled && sessionId && postId ? `${sessionId}:${postId}` : null;

  // A new exposure (different post, or a new session for the same post
  // slot) resets every accumulator — otherwise a stale `maxWatchedSeconds`
  // from the previous post would leak into this one's final_watch.
  useEffect(() => {
    maxWatchedSecondsRef.current = 0;
    durationSecondsRef.current = 0;
    hasStartedRef.current = false;
    hasReachedNearEndRef.current = false;
    previousTimeRef.current = 0;
    lastFlushedWatchedSecondsRef.current = 0;
    completionSentRef.current = false;
  }, [exposureKey]);

  const handleTimeUpdate = useCallback((currentTime: number, duration: number) => {
    if (!exposureKey || !Number.isFinite(currentTime) || currentTime < 0) return;
    durationSecondsRef.current = Number.isFinite(duration) ? duration : durationSecondsRef.current;

    const { video } = RECOMMENDATION_CLIENT_POLICY;
    const ratio = durationSecondsRef.current > 0 ? currentTime / durationSecondsRef.current : 0;

    // Replay: having reached near the end, currentTime jumps back near the
    // start while still playing. Fired immediately (not deduped server-side
    // — replays are legitimately repeatable within one exposure).
    if (
      hasReachedNearEndRef.current
      && ratio <= video.replayResetMaxRatio
      && previousTimeRef.current > currentTime
    ) {
      // A fresh id per detected crossing — reused automatically if the
      // event queue retries this exact event, which is what lets the server
      // dedupe "same replay, resent" while still counting the next genuine
      // crossing as new (rules/instructions §1.3).
      const clientExposureId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      enqueueRecommendationEvent({
        postId: postId!, sessionId: sessionId!, eventType: 'replay', source, clientExposureId
      });
      hasReachedNearEndRef.current = false;
    }
    if (ratio >= video.replayReachedMinRatio) hasReachedNearEndRef.current = true;

    if (currentTime > maxWatchedSecondsRef.current) {
      maxWatchedSecondsRef.current = currentTime;
      hasStartedRef.current = true;
    }
    previousTimeRef.current = currentTime;

    if (!completionSentRef.current && ratio >= video.completionMinRatio) {
      enqueueRecommendationEvent({
        postId: postId!,
        sessionId: sessionId!,
        eventType: 'completion',
        source,
        watchMs: Math.round(maxWatchedSecondsRef.current * 1000),
        durationMs: Math.round(durationSecondsRef.current * 1000)
      });
      completionSentRef.current = true;
    }
  }, [exposureKey, postId, sessionId, source]);

  /**
   * Sends `final_watch` for the current exposure. Safe to call more than
   * once — it is a no-op unless watch progress has advanced since the last
   * flush, so pause -> resume -> pause again correctly sends a second,
   * larger `final_watch` while pause -> unmount with no further progress
   * does not send a redundant duplicate of the same number.
   */
  const flushFinalWatch = useCallback(() => {
    if (!exposureKey || !hasStartedRef.current) return;
    if (maxWatchedSecondsRef.current <= lastFlushedWatchedSecondsRef.current) return;
    enqueueRecommendationEvent({
      postId: postId!,
      sessionId: sessionId!,
      eventType: 'final_watch',
      source,
      watchMs: Math.round(maxWatchedSecondsRef.current * 1000),
      durationMs: Math.round(durationSecondsRef.current * 1000)
    });
    lastFlushedWatchedSecondsRef.current = maxWatchedSecondsRef.current;
  }, [exposureKey, postId, sessionId, source]);

  const handlePause = useCallback(() => flushFinalWatch(), [flushFinalWatch]);
  const handleEnded = useCallback(() => flushFinalWatch(), [flushFinalWatch]);

  // Flush on unmount (post navigated away, component torn down) and whenever
  // the exposure itself changes (the caller switched to a different post).
  useEffect(() => () => flushFinalWatch(), [flushFinalWatch]);

  return {
    handleTimeUpdate, handlePause, handleEnded, flushFinalWatch
  };
}
