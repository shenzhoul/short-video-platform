import type { NextRequest } from 'next/server';
import { NextResponse, userAgent } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function proxy(req: NextRequest) {
  const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }) as any;
  const { pathname, origin } = req.nextUrl;
  const requestedPathWithSearch = `${pathname}${req.nextUrl.search}`;
  const url = req.nextUrl;
  const { device } = userAgent(req);
  const viewport = device.type === 'mobile' ? 'mobile' : 'desktop';
  url.searchParams.set('viewport', viewport);

  // Define private routes that require authentication
  const privateRoutes = [
    '/creator'
  ];

  // Check if current path is a private route
  const isPrivateRoute = privateRoutes.some(route => pathname.startsWith(route));

  // Redirect unauthenticated users from private routes to login
  if (isPrivateRoute && !session?.user?._id) {
    return NextResponse.redirect(`${origin}/auth/login?redirectUrl=${encodeURIComponent(requestedPathWithSearch)}`);
  }

  // Redirect authenticated users away from auth pages
  const authPages = [
    '/auth/login',
    '/auth/forgot-password'
  ];

  if (authPages.includes(pathname) && !!session?.user?._id) {
    // Redirect to appropriate page based on user role
    const redirectUrl = '/';
    return NextResponse.redirect(`${origin}${redirectUrl}`);
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
