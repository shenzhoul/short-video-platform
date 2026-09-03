/**
 * The one spelling of the guest recommendation-subject key, shared by the
 * proxy that issues it, the server render that reads it, and the client that
 * sends it.
 *
 * Deliberately in its own module with no `'use client'` directive. Importing it
 * from the client module instead looked fine and failed silently: Next replaces
 * a `'use client'` module with a client *reference* when a server component
 * imports it, so the constant was not a usable string on the server. The cookie
 * read then asked for `undefined`, found nothing, and every server-rendered feed
 * page quietly built a throwaway session the browser could not continue.
 */
export const RECOMMENDATION_ANONYMOUS_ID_KEY = 'douyin-clone-reco-anonymous-id';

/** A year: long enough to be useful, short enough not to be permanent. */
export const RECOMMENDATION_ANONYMOUS_ID_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Bounds on the value.
 *
 * It is an opaque token the app generates for itself, so it has a shape and
 * anything outside that shape is not ours — a truncated cookie, a hand-edited
 * one, or a probe. It is used as a Redis key segment and as a session owner, so
 * an unbounded or punctuated value would be both a key-injection surface and a
 * way to make session ownership ambiguous.
 */
const MIN_LENGTH = 8;
export const RECOMMENDATION_ANONYMOUS_ID_MAX_LENGTH = 64;
const SHAPE = /^[A-Za-z0-9_-]+$/;

export function isValidRecommendationAnonymousId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length < MIN_LENGTH || value.length > RECOMMENDATION_ANONYMOUS_ID_MAX_LENGTH) return false;
  return SHAPE.test(value);
}
