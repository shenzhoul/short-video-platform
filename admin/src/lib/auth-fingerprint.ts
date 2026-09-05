/**
 * TEMPORARY — safe fingerprints for tracing one token through the auth handoff.
 *
 * The production API is exonerated: a direct `POST /auth/login` writes a
 * 43-character token to Redis with a 7-day TTL, `validateToken` matches it, and
 * `GET /users/me` with that token answers 200 for an active `isAdmin` user. The
 * browser path nevertheless sends a non-empty Authorization header that the same
 * endpoint refuses, so the value diverges somewhere between `authorize()` and
 * the middleware's fetch.
 *
 * `len=<n> sha256=<first 8 hex>` is enough to tell "the same token" from "a
 * different token", "undefined stringified", or "an object stringified", and
 * discloses nothing usable: 8 hex characters of a SHA-256 cannot be reversed,
 * and the length alone distinguishes the shapes we care about.
 *
 * Web Crypto rather than `node:crypto` because this runs in BOTH runtimes —
 * `auth-options.ts` on Node and `proxy.ts` on the edge, where `createHash` does
 * not exist.
 *
 * Delete once the divergence is fixed.
 */

/** `len=<n> sha256=<8 hex>`, or a shape marker for anything that is not a string. */
export async function fingerprint(value: unknown): Promise<string> {
  if (value === undefined) return 'MISSING(undefined)';
  if (value === null) return 'MISSING(null)';
  if (typeof value !== 'string') return `NOT-A-STRING(${typeof value})`;
  if (value === '') return 'EMPTY';

  // The two failure shapes worth naming outright, because both are non-empty
  // strings that an Authorization header would happily carry.
  if (value === 'undefined' || value === 'null') return `STRINGIFIED(${value})`;
  if (value === '[object Object]') return 'STRINGIFIED(object)';

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `len=${value.length} sha256=${hex.slice(0, 8)}`;
}
