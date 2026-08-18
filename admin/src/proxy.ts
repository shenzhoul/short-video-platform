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

  // Check for NextAuth session token
  const session = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }) as any;

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
