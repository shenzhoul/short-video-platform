'use client';

import cookie from 'js-cookie';
import { SessionProvider as Session, SessionProviderProps, useSession } from 'next-auth/react';
import { createElement, useEffect } from 'react';

/**
 * Component that syncs the NextAuth session token to a client-side cookie
 * This allows client-side API requests to access the token via cookie.get('token')
 */
function TokenSyncHandler() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === 'authenticated' && session?.accessToken) {
      // Set the token cookie for client-side API requests
      cookie.set('token', session.accessToken, {
        expires: 7, // 7 days to match session maxAge
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });
    } else if (status === 'unauthenticated') {
      // Clear the token cookie when logged out
      cookie.remove('token');
    }
  }, [status, session?.accessToken]);

  return null;
}

/**
 * Enhanced SessionProvider that wraps NextAuth's SessionProvider
 * and automatically syncs the session token to a client-side cookie
 */
const SessionProvider = (props: SessionProviderProps) => {
  return createElement(
    Session,
    {
      ...props,
      refetchInterval: 0, // Disable automatic refetch intervals
      refetchOnWindowFocus: true, // Keep enabled for HMR to refetch properly
      refetchWhenOffline: false
    },
    props.children,
    createElement(TokenSyncHandler)
  );
};

export default SessionProvider;
