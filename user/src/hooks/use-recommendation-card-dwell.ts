'use client';

import { RefObject, useEffect, useRef } from 'react';

import { enqueueRecommendationEvent, RecommendationEventSource } from '../lib/recommendation-event-queue';
import { RECOMMENDATION_CLIENT_POLICY } from '../lib/recommendation-policy';

interface UseRecommendationCardDwellOptions {
  elementRef: RefObject<Element | null>;
  /** Scope this to photo/graphic cards — video cards get their own watch-quality signal instead. */
  enabled: boolean;
  postId: string | undefined;
  sessionId: string | null | undefined;
  source: RecommendationEventSource;
}

const MAX_DWELL_MS = 5 * 60 * 1000;

/**
 * Photo dwell for a **grid** card (Home) — distinct from
 * `useRecommendationPhotoDwell`, which measures mount duration and is only
 * correct where exactly one post is ever the active thing on screen (For
 * You's stage, Post Detail). A Home card stays mounted for as long as the
 * feed session lives (rules/user.md: Home never unmounts off-screen cards),
 * so a mount-duration timer here would count the entire time since the feed
 * loaded, not actual viewing time. This hook instead accumulates only the
 * spans where the card is actually visible (`>=minVisibleRatio`), across
 * possibly several scroll-away-and-back bouts, and flushes the total on
 * losing visibility or on unmount/exposure change.
 *
 * A second per-card `IntersectionObserver`, alongside the one
 * `useRecommendationImpression` already creates and the one
 * `usePostVideoHoverPlayback` creates for video cards. Per rules/user.md's
 * own measurement on this codebase, the observer itself was never the
 * measured cost on a 160-card feed — unbounded image/video work was — so
 * this stays within the same, already-benchmarked-safe pattern rather than
 * inventing a shared/singleton observer under time pressure.
 */
export function useRecommendationCardDwell({
  elementRef, enabled, postId, sessionId, source
}: UseRecommendationCardDwellOptions): void {
  const accumulatedMsRef = useRef(0);
  const visibleSinceRef = useRef<number | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    const exposureKey = enabled && sessionId && postId ? `${sessionId}:${postId}` : null;

    if (!exposureKey || !element || typeof IntersectionObserver === 'undefined') return undefined;

    accumulatedMsRef.current = 0;
    visibleSinceRef.current = null;

    const closeOpenBout = () => {
      if (visibleSinceRef.current === null) return;
      accumulatedMsRef.current += Date.now() - visibleSinceRef.current;
      visibleSinceRef.current = null;
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisibleEnough = entry.isIntersecting
          && entry.intersectionRatio >= RECOMMENDATION_CLIENT_POLICY.impression.minVisibleRatio;
        if (isVisibleEnough) {
          if (visibleSinceRef.current === null) visibleSinceRef.current = Date.now();
          return;
        }
        closeOpenBout();
      },
      { threshold: [0, RECOMMENDATION_CLIENT_POLICY.impression.minVisibleRatio] }
    );
    observer.observe(element);

    const flush = () => {
      closeOpenBout();
      const dwellMs = Math.min(MAX_DWELL_MS, accumulatedMsRef.current);
      accumulatedMsRef.current = 0;
      if (dwellMs <= 0) return;
      enqueueRecommendationEvent({
        postId: postId!, sessionId: sessionId!, eventType: 'photo_dwell', source, dwellMs
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      observer.disconnect();
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, postId, sessionId, source]);
}
