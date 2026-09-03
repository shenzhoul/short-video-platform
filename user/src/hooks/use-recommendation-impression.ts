'use client';

import { RefObject, useEffect, useRef } from 'react';

import { enqueueRecommendationEvent, RecommendationEventSource } from '../lib/recommendation-event-queue';
import { RECOMMENDATION_CLIENT_POLICY } from '../lib/recommendation-policy';

interface UseRecommendationImpressionOptions {
  /** The element whose visibility counts toward an impression (the card, or the active slide's container). */
  elementRef: RefObject<Element | null>;
  /** False for a creator-profile card, a search result, or anywhere that is not a recommendation surface. */
  enabled: boolean;
  postId: string | undefined;
  /** No session yet (page still loading its first page) — impression tracking stays inactive. */
  sessionId: string | null | undefined;
  source: RecommendationEventSource;
}

/**
 * Fires exactly one `impression` event per (session, post) exposure, once the
 * element has been at least `minVisibleRatio` visible for at least
 * `minVisibleMs` — never on a fast scroll-past (rules/instructions §9.2,
 * §1.1).
 *
 * One `IntersectionObserver` per call site, matching the precedent already
 * measured safe in this codebase for a 160-card feed
 * (`usePostVideoHoverPlayback`'s per-card observer — see rules/user.md's Feed
 * Rendering section: "the DOM was never the cost"). Never touches React
 * state, so it cannot defeat `memo()` on the card that uses it — the ref
 * flags below are the entire state machine.
 */
export function useRecommendationImpression({
  elementRef, enabled, postId, sessionId, source
}: UseRecommendationImpressionOptions): void {
  const firedForRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    const exposureKey = sessionId && postId ? `${sessionId}:${postId}` : null;

    if (!enabled || !element || !exposureKey || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    if (firedForRef.current === exposureKey) return undefined;

    const clearTimer = () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisibleEnough = entry.isIntersecting
          && entry.intersectionRatio >= RECOMMENDATION_CLIENT_POLICY.impression.minVisibleRatio;
        if (isVisibleEnough) {
          if (timerRef.current || firedForRef.current === exposureKey) return;
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            if (firedForRef.current === exposureKey) return;
            firedForRef.current = exposureKey;
            enqueueRecommendationEvent({
              postId: postId!, sessionId: sessionId!, eventType: 'impression', source
            });
            observer.disconnect();
          }, RECOMMENDATION_CLIENT_POLICY.impression.minVisibleMs);
          return;
        }
        // Left visibility before the dwell threshold — a fast scroll-past,
        // never counted.
        clearTimer();
      },
      { threshold: [0, RECOMMENDATION_CLIENT_POLICY.impression.minVisibleRatio] }
    );

    observer.observe(element);

    return () => {
      clearTimer();
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, postId, sessionId, source]);
}
