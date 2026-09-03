/**
 * Client-side mirror of the recommendation-event thresholds the server
 * enforces authoritatively in `api/src/common/constants/recommendation.ts`.
 *
 * These values decide *when the client fires an event at all* (impression
 * dwell, quick-skip/completion classification hints) — they are never the
 * source of truth for scoring. The server re-derives quick-skip/completion
 * from the clamped `watchMs`/`durationMs` it receives, exactly as documented
 * in `RecommendationEventService`. Keep this file's numbers in sync with the
 * server constants file by hand; there is no shared package between `api/`
 * and `user/` for this (unlike `shared/upload-policy`) because these values
 * only ever gate *when* a signal is generated, never a security or billing
 * boundary — a drift here costs data quality, not correctness.
 */
export const RECOMMENDATION_CLIENT_POLICY = {
  impression: {
    minVisibleRatio: 0.5,
    minVisibleMs: 1000
  },
  video: {
    completionMinRatio: 0.9,
    /** A jump back to near the start after having reached near the end. */
    replayResetMaxRatio: 0.15,
    replayReachedMinRatio: 0.85
  },
  photo: {
    strongDwellMs: 4000
  },
  /** Batching for the event queue — see `recommendation-event-queue.ts`. */
  queue: {
    maxBatchSize: 20,
    flushIntervalMs: 4000
  }
} as const;
