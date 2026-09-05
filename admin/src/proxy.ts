import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

import { SESSION_TOKEN_COOKIE_NAME } from '@lib/auth-cookies';

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
    try {
      const user = await fetch(`${baseApiUrl}/users/me`, {
        method: 'GET',
        headers: {
          'Authorization': accessToken
        }
      })
        .then(res => res.json());
      return user?.data?.isAdmin === true;
    } catch {
      return false;
    }
  };

  /*
    Check for the NextAuth session token.

    `cookieName` is explicit and is the SAME constant `authOptions` declares.
    Without it, `getToken` derives the name from `NEXTAUTH_URL` — https means
    `__Secure-next-auth.session-token` — while auth-options.ts names the cookie
    without that prefix. The middleware then read a cookie that does not exist,
    got `null`, and sent every freshly authenticated administrator to
    `/auth/logout?redirect=login`. See lib/auth-cookies.ts.
  */
  const session = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: SESSION_TOKEN_COOKIE_NAME
  }) as any;

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
