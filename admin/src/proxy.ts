import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'
  ]
};

export async function proxy(request: NextRequest) {
  const { pathname, origin } = request.nextUrl;

  const baseApiUrl = process.env.API_ENDPOINT || process.env.API_SERVER_ENDPOINT || process.env.NEXT_PUBLIC_API_ENDPOINT || origin;

  /*
    TEMPORARY — which endpoint the middleware actually resolved, and what it got.

    `console.warn`, never `console.info`: next.config.js strips info/log in
    production builds (`removeConsole`, excluding error and warn), which
    silently deleted three earlier rounds of diagnostics in this investigation.

    Booleans for the candidates and the resolved URL only — no token, no secret.
    The two-path probe already showed that this same token succeeds against the
    API on loopback, through nginx, and with an Origin header, but that the
    ADMIN origin answers `200 text/html` with no `data.isAdmin` — so if the
    fallback to `origin` is being taken, that is the whole failure.
  */
  // eslint-disable-next-line no-console
  console.warn('[auth-diag] middleware.env: '
    + `API_ENDPOINT=${Boolean(process.env.API_ENDPOINT)} `
    + `API_SERVER_ENDPOINT=${Boolean(process.env.API_SERVER_ENDPOINT)} `
    + `NEXT_PUBLIC_API_ENDPOINT=${Boolean(process.env.NEXT_PUBLIC_API_ENDPOINT)} `
    + `resolvedBaseApiUrl=${baseApiUrl} `
    + `fellBackToOrigin=${baseApiUrl === origin}`);

  const isRealAdminUser = async (accessToken: string) => {
    try {
      const res = await fetch(`${baseApiUrl}/users/me`, {
        method: 'GET',
        headers: {
          'Authorization': accessToken
        }
      });
      const contentType = res.headers.get('content-type') || '(none)';
      const user = await res.json().catch(() => null);

      // eslint-disable-next-line no-console
      console.warn('[auth-diag] middleware.users-me: '
        + `status=${res.status} `
        + `contentType=${contentType.split(';')[0]} `
        + `isAdmin=${user?.data?.isAdmin === true}`);

      return user?.data?.isAdmin === true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[auth-diag] middleware.users-me: THREW ${(error as Error)?.name}`);
      return false;
    }
  };

  // Check for NextAuth session token
  const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }) as any;

  /*
    TEMPORARY — every input to the branch decisions below.

    `middleware.env` was appearing without `middleware.users-me`, which proves
    `isRealAdminUser` is never entered and the redirect comes from an earlier
    branch. The cookie names are logged (NAMES ONLY, never values) because
    next-auth's `getToken` picks which cookie to read from `NEXTAUTH_URL`:

      secureCookie = NEXTAUTH_URL.startsWith("https://")
      cookieName   = secureCookie ? "__Secure-next-auth.session-token"
                                  : "next-auth.session-token"

    while auth-options.ts overrides the name to the NON-prefixed form. If those
    disagree, getToken reads a cookie that does not exist and returns null.
  */
  const cookieNames = request.cookies.getAll().map((c) => c.name);
  // eslint-disable-next-line no-console
  console.warn('[auth-diag] middleware.session: '
    + `path=${pathname} `
    + `nextauthUrlHttps=${Boolean(process.env.NEXTAUTH_URL?.startsWith('https://'))} `
    + `getTokenLooksFor=${process.env.NEXTAUTH_URL?.startsWith('https://') ? '__Secure-next-auth.session-token' : 'next-auth.session-token'} `
    + `cookiesPresent=[${cookieNames.join(',')}] `
    + `decoded=${Boolean(session)} `
    + `hasUser=${Boolean(session?.user)} `
    + `hasUserId=${Boolean(session?.user?._id)} `
    + `isAdminValue=${String(session?.user?.isAdmin)} `
    + `isAdminType=${typeof session?.user?.isAdmin} `
    + `hasAccessToken=${Boolean(session?.accessToken)} `
    + `topLevelKeys=[${session ? Object.keys(session).join(',') : ''}]`);

  /**
   * `/auth/forgot` is retired.
   *
   * The page it served posted to `POST /auth/forgot`, a route the API has never
   * implemented, and rendered the resulting 404 as "Account not found, please
   * recheck the email" — a missing feature dressed up as a rejected address.
   * Page, component and service call are gone; this keeps old bookmarks and
   * links working by sending them to the login page instead of a 404. A redirect
   * replaces the navigation rather than stacking on it, so there is no loop.
   *
   * This is *not* a placeholder for recovery. There is still no way to reset a
   * password from the browser; an administrator recovers through another admin
   * (`PUT /admin/auth/user/password`) or `api/scripts/reset-admin-pw.js`.
   */
  if (pathname === '/auth/forgot' || pathname.startsWith('/auth/forgot/')) {
    return NextResponse.redirect(`${origin}/auth/login`);
  }

  // Define auth pages
  const isAuthPage = pathname.startsWith('/auth/');
  const isLogoutPage = pathname === '/auth/logout';

  // because we use token in the client side
  // so we need to check if that session is expired or not. we use next auth and it has different way to store session

  // If accessing auth pages and already authenticated, redirect to dashboard
  if (isAuthPage && !isLogoutPage && session?.user?._id) {
    // eslint-disable-next-line no-console
    console.warn('[auth-diag] middleware.branch: taken=AUTHPAGE-HAS-SESSION entering=isRealAdminUser');
    // here is to verify server once again because token may expired, we need to double check and avoid redirect loop
    const isAdmin = await isRealAdminUser(session.accessToken);
    if (!isAdmin) {
      // eslint-disable-next-line no-console
      console.warn('[auth-diag] middleware.branch: taken=AUTHPAGE-NOT-ADMIN -> /auth/logout?redirect=login');
      return NextResponse.redirect(`${origin}/auth/logout?redirect=login`);
    }
    // eslint-disable-next-line no-console
    console.warn('[auth-diag] middleware.branch: taken=AUTHPAGE-OK -> /dashboard');
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  // If not auth page, require authentication
  if (!isAuthPage) {
    if (!session?.user?._id || !session.user.isAdmin) {
      const reason = !session ? 'getToken-returned-null'
        : (!session.user ? 'no-user-in-payload'
          : (!session.user._id ? 'no-user-id' : 'isAdmin-falsy'));
      // eslint-disable-next-line no-console
      console.warn(`[auth-diag] middleware.branch: taken=PROTECTED-NO-SESSION reason=${reason} -> /auth/logout?redirect=login`);
      // No valid session — clean up and redirect to login
      return NextResponse.redirect(`${origin}/auth/logout?redirect=login`);
    }
    // eslint-disable-next-line no-console
    console.warn('[auth-diag] middleware.branch: taken=PROTECTED-HAS-SESSION entering=isRealAdminUser');
    // check real user and token validity
    const isAdmin = await isRealAdminUser(session.accessToken);
    if (!isAdmin) {
      // eslint-disable-next-line no-console
      console.warn('[auth-diag] middleware.branch: taken=PROTECTED-NOT-ADMIN -> /auth/logout?redirect=login');
      return NextResponse.redirect(`${origin}/auth/logout?redirect=login`);
    }
  }

  // eslint-disable-next-line no-console
  console.warn('[auth-diag] middleware.branch: taken=ALLOW -> next()');
  const response = NextResponse.next();
  return response;
}
