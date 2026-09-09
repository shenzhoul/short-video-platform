'use client';

import { useEffect, useRef } from 'react';

import { enqueueRecommendationEvent, RecommendationEventSource } from '../lib/recommendation-event-queue';

interface UseRecommendationPhotoDwellOptions {
  enabled: boolean;
  postId: string | undefined;
  sessionId: string | null | undefined;
  source: RecommendationEventSource;
}

/** Clamp so a tab left open all night does not report an absurd dwell time. */
const MAX_DWELL_MS = 5 * 60 * 1000;

/**
 * Photo dwell tracking for the surfaces where a photo post is the single
 * "active" thing on screen — the For You stage and the Post Detail
 * full-screen photo viewer. This is a **mount-duration** timer, not the
 * `IntersectionObserver` used for Home grid impressions: only one photo is
 * ever the active slide/open post at a time on these surfaces, so "how long
 * was this the thing being looked at" is simply "how long was this hook
 * mounted with a given (session, post)".
 *
 * Flushes on unmount, on switching to a different post/session, on the tab
 * going hidden, and on unload (via the shared event queue's own
 * `pagehide`/`visibilitychange` listeners — this hook only needs to enqueue
 * the accumulated dwell before those fire, which the unmount/change flush
 * below already guarantees for a same-tab switch; the queue's own unload
 * listeners cover the browser-closing case for whatever is enqueued).
 */
export function useRecommendationPhotoDwell({
  enabled, postId, sessionId, source
}: UseRecommendationPhotoDwellOptions): void {
  const startedAtRef = useRef<number | null>(null);
  /** Dwell banked across hide/return cycles within one exposure. */
  const accumulatedRef = useRef(0);
  /** One exposure emits one `photo_dwell`, however many times flush is called. */
  const sentRef = useRef(false);
  const exposureKey = enabled && sessionId && postId ? `${sessionId}:${postId}` : null;

  useEffect(() => {
    if (!exposureKey) return undefined;
    // A new exposure starts a new accumulation and may emit again.
    accumulatedRef.current = 0;
    sentRef.current = false;
    startedAtRef.current = Date.now();

    /*
     * Dwell is *cumulative for one exposure*, and it is emitted once.
     *
     * It used to be sent from both the visibility handler and the unmount
     * cleanup, each carrying its own slice. Hiding the tab and then closing the
     * post produced two `photo_dwell` events for one exposure — same identity,
     * same batch — which is what the unique index was rejecting on the review
     * API. Accumulating instead means a hide/return cycle adds to the total
     * rather than sending a second record of it, and the number that reaches
     * the server is the whole dwell rather than the last fragment of it.
     */
    const flush = () => {
      const startedAt = startedAtRef.current;
      if (startedAt !== null) {
        accumulatedRef.current += Math.max(0, Date.now() - startedAt);
        startedAtRef.current = null;
      }
      if (sentRef.current) return;
      const dwellMs = Math.min(MAX_DWELL_MS, Math.max(0, accumulatedRef.current));
      if (dwellMs <= 0) return;
      sentRef.current = true;
      enqueueRecommendationEvent({
        postId: postId!, sessionId: sessionId!, eventType: 'photo_dwell', source, dwellMs
      });
    };

    /** Banks the time spent so far without ending the exposure. */
    const pause = () => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      accumulatedRef.current += Math.max(0, Date.now() - startedAt);
      startedAtRef.current = null;
    };

    const handleVisibilityChange = () => {
      // Hiding the tab banks the elapsed time; it does not end the exposure and
      // must not emit. Returning resumes the same accumulation, so a person who
      // switches away and back is one dwell, not two.
      if (document.visibilityState === 'hidden') pause();
      else if (startedAtRef.current === null && !sentRef.current) startedAtRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exposureKey]);
}
