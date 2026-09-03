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
  const exposureKey = enabled && sessionId && postId ? `${sessionId}:${postId}` : null;

  useEffect(() => {
    if (!exposureKey) return undefined;
    startedAtRef.current = Date.now();

    const flush = () => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      const dwellMs = Math.min(MAX_DWELL_MS, Math.max(0, Date.now() - startedAt));
      startedAtRef.current = null;
      enqueueRecommendationEvent({
        postId: postId!, sessionId: sessionId!, eventType: 'photo_dwell', source, dwellMs
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') return;
      flush();
      // A visible tab still counts as continuing to dwell if the person
      // returns to it without switching posts.
      startedAtRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exposureKey]);
}
