import type { NextRequest } from 'next/server';
import { NextResponse, userAgent } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function proxy(req: NextRequest) {
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
    if (isLoggedIn) return NextResponse.redirect(`${origin}/`);
    return NextResponse.redirect(`${origin}/?authModal=login`);
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
    return NextResponse.redirect(`${origin}/`);
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
    const passThrough = NextResponse.rewrite(url);
    passThrough.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return passThrough;
  }

  // Set cache control headers and continue
  const response = NextResponse.rewrite(url);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  return response;
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
