'use client';

import {
  isValidRecommendationAnonymousId,
  RECOMMENDATION_ANONYMOUS_ID_KEY,
  RECOMMENDATION_ANONYMOUS_ID_MAX_AGE_SECONDS
} from '@constants/recommendation-anonymous-id';

const STORAGE_KEY = RECOMMENDATION_ANONYMOUS_ID_KEY;

function readCookie(): string | null {
  try {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(new RegExp(`(?:^|; )${STORAGE_KEY}=([^;]*)`));
    if (!match) return null;
    const value = decodeURIComponent(match[1]);
    return isValidRecommendationAnonymousId(value) ? value : null;
  } catch {
    return null;
  }
}

function writeCookie(value: string): void {
  try {
    if (typeof document === 'undefined') return;
    document.cookie = `${STORAGE_KEY}=${encodeURIComponent(value)}; path=/; max-age=${RECOMMENDATION_ANONYMOUS_ID_MAX_AGE_SECONDS}; samesite=lax`;
  } catch {
    // A blocked cookie only costs the *next* server render its continuity; this
    // client still sends the id on every request it makes itself.
  }
}

/**
 * The guest recommendation-subject id for this browser.
 *
 * ## The cookie is the source of truth, not `localStorage`
 *
 * `proxy.ts` issues this id before anything renders, precisely so the very
 * first server-rendered feed page is built for the same subject the browser
 * will then send. If the client preferred its own `localStorage` value it would
 * disagree with that render, and the session the server had just built would be
 * abandoned on the first "load more" — which is exactly the two-session,
 * 78-to-86-card first visit this arrangement exists to prevent.
 *
 * `localStorage` is kept as a fallback for the case the cookie is unavailable
 * (blocked, or cleared while the tab is open), so a guest still gets *a* stable
 * subject rather than a new one per request.
 *
 * Explicitly not a device fingerprint: one opaque random value the app creates
 * for itself, which a visitor can discard at any time without anything breaking
 * — they simply become a new, unlinked guest. It carries no other information
 * and is never sent anywhere but this app's own API.
 */
export function getRecommendationAnonymousId(): string | null {
  if (typeof window === 'undefined') return null;

  const fromCookie = readCookie();
  if (fromCookie) {
    try {
      // Keep the fallback in step with the authority.
      if (window.localStorage.getItem(STORAGE_KEY) !== fromCookie) {
        window.localStorage.setItem(STORAGE_KEY, fromCookie);
      }
    } catch { /* storage unavailable; the cookie alone is enough */ }
    return fromCookie;
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isValidRecommendationAnonymousId(stored)) {
      // The cookie went away; restore it so server renders keep working.
      writeCookie(stored);
      return stored;
    }

    const created = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(STORAGE_KEY, created);
    writeCookie(created);
    return created;
  } catch {
    // Storage unavailable (private mode, quota) — the caller degrades to an
    // unauthenticated request with no anonymous id rather than throwing.
    return null;
  }
}
