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
