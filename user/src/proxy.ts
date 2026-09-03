import {
  isValidRecommendationAnonymousId,
  RECOMMENDATION_ANONYMOUS_ID_KEY,
  RECOMMENDATION_ANONYMOUS_ID_MAX_AGE_SECONDS
} from '@constants/recommendation-anonymous-id';
import type { NextRequest } from 'next/server';
import { NextResponse, userAgent } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Issues the guest recommendation-subject id *before* anything renders.
 *
 * A feed session belongs to the subject that created it, so a server render
 * with no subject builds a session the browser cannot continue: it asks for
 * page two, the server does not recognise the owner, and silently starts a new
 * session. Measured on a first-ever visit, that produced two sessions for one
 * page load and a Home feed of 78-86 cards against a 70-item policy — the
 * server-rendered twenty plus a whole client session on top.
 *
 * Doing it here rather than in the client fixes the ordering for good: the
 * cookie is set on the request as well as the response, so the very first
 * server render reads the same id the browser will send from then on.
 *
 * The value is opaque and self-generated — a v4 UUID, no request data, nothing
 * derived from the visitor. It is a session key, not an identity.
 */
/**
 * An opaque token, from the platform CSPRNG where there is one.
 *
 * `crypto.randomUUID` exists on the edge runtime and in Node, but not in every
 * environment this module is loaded in (jsdom, for one), so the fallback keeps
 * the function total rather than making the caller handle a throw. Both forms
 * satisfy `isValidRecommendationAnonymousId`.
 */
function newOpaqueId(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  if (source && typeof source.getRandomValues === 'function') {
    const bytes = source.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function ensureAnonymousId(req: NextRequest): { id: string; issued: boolean } {
  const existing = req.cookies.get(RECOMMENDATION_ANONYMOUS_ID_KEY)?.value;
  // An invalid value is replaced rather than trusted: this ends up as a Redis
  // key segment and as a session owner.
  if (isValidRecommendationAnonymousId(existing)) return { id: existing, issued: false };

  const id = newOpaqueId();
  // Visible to this request's server render, not only to the next one.
  req.cookies.set(RECOMMENDATION_ANONYMOUS_ID_KEY, id);
  return { id, issued: true };
}

function attachAnonymousId(response: NextResponse, id: string, issued: boolean): NextResponse {
  if (!issued) return response;
  response.cookies.set({
    name: RECOMMENDATION_ANONYMOUS_ID_KEY,
    value: id,
    path: '/',
    sameSite: 'lax',
    maxAge: RECOMMENDATION_ANONYMOUS_ID_MAX_AGE_SECONDS,
    // Readable by script on purpose — the client sends it on its own API calls,
    // and it is not a credential.
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production'
  });
  return response;
}

export async function proxy(req: NextRequest) {
  const anonymous = ensureAnonymousId(req);
  const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }) as any;
  const { pathname, origin } = req.nextUrl;
  const url = req.nextUrl;
  const { device } = userAgent(req);
  const viewport = device.type === 'mobile' ? 'mobile' : 'desktop';
  url.searchParams.set('viewport', viewport);
  const isLoggedIn = !!session?.user?._id;

  /**
   * Private routes are no longer intercepted here.
   *
   * They check the session in their own server component and render
   * `AuthRequiredGate`, which opens the shared login dialog *over* the requested
   * URL. Redirecting from the edge instead would throw that URL away — the whole
   * point of the change — and would do it before the page ever got the chance to
   * decide. Nothing private is exposed by letting the request through: each page
   * still calls `getServerSession` before it fetches anything.
   */

  /**
   * `/auth/login` no longer exists as a page.
   *
   * Anyone arriving at it — an old bookmark, a stale link, a typed URL — is sent
   * to the home page, with `?authModal=login` so the dialog opens there. A
   * redirect replaces the navigation rather than stacking on it, so there is no
   * history loop and no way back into a login page that is gone.
   */
  const retiredLoginPaths = ['/auth/login', '/auth/forgot-password'];

  if (retiredLoginPaths.includes(pathname)) {
    if (isLoggedIn) return attachAnonymousId(NextResponse.redirect(`${origin}/`), anonymous.id, anonymous.issued);
    return attachAnonymousId(NextResponse.redirect(`${origin}/?authModal=login`), anonymous.id, anonymous.issued);
  }

  /**
   * `/auth/logout` no longer exists as a page either.
   *
   * It used to render a "You have been logged out" screen whose `useEffect`
   * called `signOut`. Two things were wrong with that: it put a dead-end page in
   * the history that Back could return to, and it made a **GET** perform the
   * state-changing revoke — so a prefetch, a crawler or an `<img src>` pointed at
   * this URL could sign somebody out.
   *
   * This redirect deliberately performs **no** logout. Signing out happens only
   * through the Logout control (`useLogout` → `performLogout` → NextAuth's
   * `signOut` POST) or through `endExpiredSession`. A bookmark simply lands home.
   */
  if (pathname === '/auth/logout') {
    return attachAnonymousId(NextResponse.redirect(`${origin}/`), anonymous.id, anonymous.issued);
  }

  /**
   * Routes reached from a link in an email, and therefore by somebody who by
   * definition cannot sign in yet.
   *
   * They are listed here as documentation and as a guard rather than as
   * behaviour: nothing above redirects them today, and this loop exists so that
   * a future rule which starts intercepting `/auth/*` cannot swallow them by
   * accident. Signed in or out, they pass straight through — a signed-in visitor
   * following a confirmation link for a second account must still reach the page
   * rather than being bounced to the home page.
   *
   * `/auth/forgot-password` above is a *different* URL: it never had a page, and
   * the forgot-password flow lives in the dialog. Do not confuse the two.
   */
  const publicTokenPaths = ['/auth/verify-email', '/auth/reset-password'];

  if (publicTokenPaths.includes(pathname)) {
    const passThrough = NextResponse.rewrite(url, { request: { headers: req.headers } });
    passThrough.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return attachAnonymousId(passThrough, anonymous.id, anonymous.issued);
  }

  // Set cache control headers and continue. `request.headers` is forwarded so
  // the server render sees the anonymous-id cookie issued above on *this*
  // request, not one render later.
  const response = NextResponse.rewrite(url, { request: { headers: req.headers } });
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  return attachAnonymousId(response, anonymous.id, anonymous.issued);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'
  ]
};
