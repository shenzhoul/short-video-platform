'use client';

import { setApiAuthToken } from '@services/api-request';
import cookie from 'js-cookie';
import { SessionProvider as Session, SessionProviderProps, useSession } from 'next-auth/react';
import { createElement, useEffect } from 'react';

/**
 * Bridges the next-auth session to the token the API client authenticates with.
 *
 * Two stores, because they serve different lifetimes: an in-memory copy that is
 * correct from the first render of a new session, and a cookie that survives a
 * reload and is visible to other tabs. `getApiAuthToken()` prefers the former
 * and falls back to the latter.
 */
function TokenSyncHandler() {
  const { data: session, status } = useSession();

  /*
    Publish the token DURING RENDER, not from an effect.

    React runs a child subtree's effects before a later sibling's, and this
    component is rendered after `props.children`. So while this was an effect,
    every consumer's effect ran first — with the token still unset. Measured in
    production: straight after login, `GET /notifications/unread-count` went out
    with an empty Authorization header and came back 403, silently, because the
    badge refresher swallows its own errors.

    The render phase completes for the whole tree before ANY effect in that
    commit runs, so setting it here makes the token available to every consumer
    no matter where it sits in the tree — and without depending on sibling
    order, which a later refactor could quietly change.

    Assigning to a module store during render is a deliberate exception to
    render purity: it is idempotent, so StrictMode's double invocation is
    harmless, and the alternative is the ordering bug above.
  */
  if (status === 'authenticated' && session?.accessToken) {
    setApiAuthToken(session.accessToken);
  } else if (status === 'unauthenticated') {
    setApiAuthToken(null);
  }

  useEffect(() => {
    if (status === 'authenticated' && session?.accessToken) {
      // The cookie is what survives a reload and what other tabs read. It is no
      // longer what the first request of a session depends on.
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
    props,
    props.children,
    createElement(TokenSyncHandler)
  );
};

export default SessionProvider;
