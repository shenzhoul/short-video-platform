'use client';

import { getBaseApiEndpoint, TOKEN } from '@services/api-request';
import { recordRecommendationEvents } from '@services/post.service';
import cookie from 'js-cookie';

import { getRecommendationAnonymousId } from './recommendation-anonymous-id';
import { RECOMMENDATION_CLIENT_POLICY } from './recommendation-policy';

export type RecommendationEventType =
  | 'impression'
  | 'view'
  | 'watch_progress'
  | 'final_watch'
  | 'completion'
  | 'replay'
  | 'quick_skip'
  | 'photo_dwell'
  | 'detail_open'
  | 'like'
  | 'comment'
  | 'share'
  | 'follow_after_view';

export type RecommendationEventSource = 'home' | 'for-you' | 'post-detail';

export interface RecommendationEventInput {
  postId: string;
  sessionId: string;
  eventType: RecommendationEventType;
  source: RecommendationEventSource;
  watchMs?: number;
  durationMs?: number;
  dwellMs?: number;
  /**
   * Names one *occurrence* of a repeatable event (currently only `replay`).
   * A queue-level retry of this exact enqueued event must reuse the same id
   * — the server tells "retry of the same replay" apart from "a new replay"
   * by whether this id repeats (rules/instructions §1.3). Generate it once
   * per detected replay crossing at the call site, not here.
   */
  clientExposureId?: string;
  /**
   * The real id of the comment a `comment` event is claiming — required for
   * that event type. The server verifies it against the stored comment
   * (author, post, root-vs-reply) and dedupes on it, so a queue retry of the
   * same submission cannot double-count (rules/instructions §2).
   */
  commentId?: string;
}

const MAX_BATCH_SIZE = RECOMMENDATION_CLIENT_POLICY.queue.maxBatchSize;
const FLUSH_INTERVAL_MS = RECOMMENDATION_CLIENT_POLICY.queue.flushIntervalMs;
/** Retried events older than this are dropped rather than retried forever. */
const MAX_RETRY_AGE_MS = 60_000;

interface QueuedEvent extends RecommendationEventInput {
  queuedAt: number;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function debugLog(...args: unknown[]) {
  // Never logs a full payload in production — see rules/instructions §19
  // ("Không log secret, raw personal data hoặc toàn bộ behavioral history").
  if (process.env.NODE_ENV === 'production') return;
  // eslint-disable-next-line no-console
  console.debug('[recommendation-events]', ...args);
}

function clearScheduledFlush() {
  if (!flushTimer) return;
  clearTimeout(flushTimer);
  flushTimer = null;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    // `flush` and `scheduleFlush` are genuinely mutually recursive (flush's
    // own retry path calls scheduleFlush) — one direction must be a textual
    // forward reference no matter which is declared first; both are hoisted
    // function declarations, so this is safe at runtime.
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    void flush();
  }, FLUSH_INTERVAL_MS);
}

function currentActorAndPayload(events: QueuedEvent[]) {
  const now = Date.now();
  const fresh = events.filter((event) => now - event.queuedAt <= MAX_RETRY_AGE_MS);
  const anonymousId = getRecommendationAnonymousId();
  return {
    events: fresh.map(({
      postId, sessionId, eventType, source, watchMs, durationMs, dwellMs, clientExposureId, commentId
    }) => ({
      postId, sessionId, eventType, source, watchMs, durationMs, dwellMs, clientExposureId, commentId
    })),
    anonymousId: anonymousId || undefined
  };
}

/**
 * Flush the current batch through the normal (axios-based) request path.
 *
 * A failed flush puts its events back at the front of the queue for the next
 * attempt (age-bounded by `MAX_RETRY_AGE_MS`, so a long outage drops stale
 * telemetry instead of growing the queue forever) — the server's own
 * dedupe key makes a resend safe (rules/instructions §9.4: "Retry idempotent").
 */
export async function flush(): Promise<void> {
  if (flushing || !queue.length) return;
  flushing = true;
  clearScheduledFlush();

  const batch = queue.splice(0, MAX_BATCH_SIZE);
  const { events, anonymousId } = currentActorAndPayload(batch);

  try {
    if (events.length) {
      await recordRecommendationEvents(events, anonymousId);
      debugLog('flushed', events.length, 'events');
    }
  } catch (error) {
    debugLog('flush failed, requeueing', error);
    queue = [...batch, ...queue];
    if (queue.length) scheduleFlush();
  } finally {
    flushing = false;
    if (queue.length && !flushTimer) scheduleFlush();
  }
}

/**
 * Add one event to the pending batch.
 *
 * Never awaited by UI code and never throws — a dropped or delayed
 * recommendation signal must not affect playback or interaction feedback
 * (rules/instructions §9.4, §1.4: "Event thất bại không làm UI playback bị lỗi").
 */
export function enqueueRecommendationEvent(event: RecommendationEventInput): void {
  if (!event.postId || !event.sessionId) return;
  queue.push({ ...event, queuedAt: Date.now() });
  debugLog('enqueue', event.eventType, event.postId);

  if (queue.length >= MAX_BATCH_SIZE) {
    clearScheduledFlush();
    void flush();
    return;
  }
  scheduleFlush();
}

/**
 * Synchronous best-effort flush for page unload / tab hide.
 *
 * Deliberately `fetch(..., { keepalive: true })`, not `navigator.sendBeacon`:
 * this app authenticates every request with a bearer token read from a
 * client-readable cookie and sent as an explicit `Authorization` header
 * (`APIRequest.request` in `api-request.ts`) — `sendBeacon` supports no
 * custom headers at all, so it could only ever send these as anonymous
 * requests, silently losing attribution for every authenticated user's final
 * watch/dwell signal on every navigation. `fetch` with `keepalive: true` is
 * the browser-supported replacement built for exactly this case and does
 * support headers; Chrome/Firefox/Safari all honor it past page unload.
 */
export function flushOnUnload(): void {
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  const { events, anonymousId } = currentActorAndPayload(batch);
  if (!events.length) return;

  try {
    const token = cookie.get(TOKEN) || '';
    const url = `${getBaseApiEndpoint()}/posts/recommendation-events`;
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: token },
      body: JSON.stringify({ events, ...(anonymousId ? { anonymousId } : {}) }),
      keepalive: true
    }).catch(() => {
      // Best-effort — nothing left to fall back to once the page is gone.
    });
    debugLog('keepalive flush', events.length, 'events');
  } catch {
    // Swallowed: an unload-time failure must never surface to the user.
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushOnUnload);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnUnload();
  });
}

/** Test-only: reset module state between spec files. */
export function __resetRecommendationEventQueueForTests(): void {
  queue = [];
  clearScheduledFlush();
  flushing = false;
}
