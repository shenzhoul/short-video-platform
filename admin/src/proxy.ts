import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { fingerprint } from '@lib/auth-fingerprint';

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

  const isRealAdminUser = async (accessToken: string) => {
    /*
      TEMPORARY — the sixth fingerprint in the auth handoff trace.

      Logged UNCONDITIONALLY rather than behind ADMIN_AUTH_DIAGNOSTICS: this
      runs in the edge runtime, where whether runtime environment variables are
      visible at all is itself one of the open questions. Gating on one could
      suppress exactly the evidence we need — and `diagEnvVisible` below answers
      that question as a side effect.

      A fingerprint only; never the token. Remove with the rest of the tracing.
    */
    // eslint-disable-next-line no-console
    console.info('[auth-diag] 6.middleware: '
      + `authorizationFp=${await fingerprint(accessToken)} `
      + `diagEnvVisible=${Boolean(process.env.ADMIN_AUTH_DIAGNOSTICS)} `
      + `apiBaseSet=${Boolean(baseApiUrl)}`);

    try {
      const user = await fetch(`${baseApiUrl}/users/me`, {
        method: 'GET',
        headers: {
          'Authorization': accessToken
        }
      })
        .then(res => res.json());
      // eslint-disable-next-line no-console
      console.info('[auth-diag] 6.middleware result: '
        + `isAdmin=${user?.data?.isAdmin === true} `
        + `message=${user?.message || '(none)'}`);
      return user?.data?.isAdmin === true;
    } catch {
      return false;
    }
  };

  // Check for NextAuth session token
  const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }) as any;

  /*
    TEMPORARY — what the middleware actually decoded from the cookie.

    This is the boundary the six-point trace exists to find: everything before
    it happens in the Node runtime, everything after it in the edge runtime, and
    `secretVisible=false` here would explain a null session on its own.
  */
  // eslint-disable-next-line no-console
  console.info('[auth-diag] 5b.middleware-decode: '
    + `path=${pathname} `
    + `secretVisible=${Boolean(process.env.NEXTAUTH_SECRET)} `
    + `session=${Boolean(session)} `
    + `userId=${Boolean(session?.user?._id)} `
    + `isAdminFlag=${session?.user?.isAdmin === true} `
    + `accessTokenFp=${await fingerprint(session?.accessToken)}`);

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
    // here is to verify server once again because token may expired, we need to double check and avoid redirect loop
    const isAdmin = await isRealAdminUser(session.accessToken);
    if (!isAdmin) {
      return NextResponse.redirect(`${origin}/auth/logout?redirect=login`);
    }
    return NextResponse.redirect(`${origin}/dashboard`);
  }

  // If not auth page, require authentication
  if (!isAuthPage) {
    if (!session?.user?._id || !session.user.isAdmin) {
      // No valid session — clean up and redirect to login
      return NextResponse.redirect(`${origin}/auth/logout?redirect=login`);
    }
    // check real user and token validity
    const isAdmin = await isRealAdminUser(session.accessToken);
    if (!isAdmin) {
      return NextResponse.redirect(`${origin}/auth/logout?redirect=login`);
    }
  }

  const response = NextResponse.next();
  return response;
}
