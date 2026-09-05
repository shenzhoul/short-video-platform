/**
 * The next-auth cookie names, declared once and read by everything.
 *
 * ## Why this file exists
 *
 * next-auth has two readers of the session cookie and they derive its name
 * differently:
 *
 *  - the route handler is given `authOptions`, so it uses whatever
 *    `cookies.sessionToken.name` says;
 *  - `getToken()` in `proxy.ts` is given only `{ req, secret }`, so it falls
 *    back to its own default (next-auth/jwt/index.js:65-66):
 *
 *        secureCookie = process.env.NEXTAUTH_URL?.startsWith("https://")
 *        cookieName   = secureCookie ? "__Secure-next-auth.session-token"
 *                                    : "next-auth.session-token"
 *
 * `auth-options.ts` overrides the name to the NON-prefixed form while
 * `NEXTAUTH_URL` is https, so in production those two disagreed. Measured on
 * the deployed admin app:
 *
 *     getTokenLooksFor=__Secure-next-auth.session-token
 *     cookiesPresent=[next-auth.csrf-token,next-auth.callback-url,next-auth.session-token]
 *     decoded=false hasUser=false isAdminValue=undefined
 *     -> taken=PROTECTED-NO-SESSION reason=getToken-returned-null
 *        -> /auth/logout?redirect=login
 *
 * Every login therefore bounced straight back to the login page: credentials
 * verified, session created, `/api/auth/session` answering 200 — and the
 * middleware unable to see any of it, because it was reading a cookie that
 * does not exist. `isRealAdminUser` was never even reached.
 *
 * The names now come from here, so the declaration and the lookup cannot drift
 * apart again. If the prefixed form is ever wanted, change it in ONE place —
 * and remember that a `__Secure-` name is only legal on a cookie that actually
 * sets `Secure`, which is why the two must move together.
 */

/** Read by `authOptions.cookies.sessionToken.name` and by `getToken({ cookieName })`. */
export const SESSION_TOKEN_COOKIE_NAME = 'next-auth.session-token';

/** Declared alongside for symmetry; only `authOptions` reads these. */
export const CALLBACK_URL_COOKIE_NAME = 'next-auth.callback-url';
export const CSRF_TOKEN_COOKIE_NAME = 'next-auth.csrf-token';
