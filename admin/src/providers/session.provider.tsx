'use client';

import cookie from 'js-cookie';
import { SessionProvider as Session, SessionProviderProps, useSession } from 'next-auth/react';
import { createElement, useEffect } from 'react';

import { setApiAuthToken } from '@services/api-request';

/**
 * Component that syncs the NextAuth session token to a client-side cookie
 * This allows client-side API requests to access the token via cookie.get('token')
 */
function TokenSyncHandler() {
  const { data: session, status } = useSession();

  /*
    Publish the token DURING RENDER, not from an effect.

    This component is rendered as a sibling after `props.children`, and React
    runs a child subtree's effects before a later sibling's. While this was an
    effect, the dashboard's own effects fired their first API calls with an
    empty Authorization header — and `api-request.ts` treats ANY 401/403 as a
    dead session and navigates to `/auth/logout`. One unauthenticated request
    immediately after login therefore logged the administrator straight back
    out: `callback/credentials 200 → csrf → signout → session → /auth/login`,
    with `/users/me` answering 200 whenever it happened to fire after the
    effect, which is what made it look intermittent.

    The render phase completes for the whole tree before ANY effect in that
    commit runs, so setting it here makes the token available to every consumer
    regardless of tree position, and without depending on sibling order that a
    refactor could quietly change.

    Assigning to a module store during render is a deliberate exception to
    render purity: it is idempotent, so StrictMode's double invocation is
    harmless.
  */
  if (status === 'authenticated' && session?.accessToken) {
    setApiAuthToken(session.accessToken);
  } else if (status === 'unauthenticated') {
    setApiAuthToken(null);
  }

  useEffect(() => {
    if (status === 'authenticated' && session?.accessToken) {
      // The cookie is what survives a reload and what other tabs read. It is no
      // longer what the first request after login depends on.
      cookie.set('token', session.accessToken, {
        expires: 7, // 7 days to match session maxAge
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
      });
    } else if (status === 'unauthenticated') {
      // Clear BOTH stores on logout, or the in-memory copy would keep
      // authenticating requests for the rest of the page's life.
      setApiAuthToken(null);
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
