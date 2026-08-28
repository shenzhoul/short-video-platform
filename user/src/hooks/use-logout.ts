'use client';

import { performLogout, showErrorMessage } from '@lib/utils';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Signing out, as the user asked for it.
 *
 * There is no logout page any more. This used to be
 * `window.location.href = '/auth/logout'`, which navigated to a route whose only
 * job was to call `signOut` and then show a "You have been logged out" screen —
 * a full reload, an extra history entry the Back button could return to, and a
 * dead end offering a "Login again" button for a dialog that opens anywhere.
 *
 * The replacement does the same real work and none of the theatre:
 *
 *  1. `performLogout` signs out of NextAuth, which fires the `signOut` event in
 *     `auth-options.ts` and revokes the token on the API, then clears the local
 *     token cookie. This is a genuine server-side revoke, not a cookie wipe.
 *  2. Only once that resolves, `router.replace('/')` moves to a public route —
 *     `replace`, so Back cannot return to the protected page just left, and `/`
 *     specifically so a route guard does not immediately reopen the dialog.
 *  3. `router.refresh()` re-runs the server components with no session, so the
 *     header and every server-rendered surface come back signed-out and the RSC
 *     cache stops holding data the visitor may no longer see.
 *
 * No full reload: client state that is not tied to the session survives, which
 * is the whole reason this is a router transition rather than an assignment to
 * `location.href`.
 *
 * @see endExpiredSession for the involuntary case, which *does* reload.
 */
export function useLogout() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  /**
   * The in-flight sign-out, so a double click cannot start a second one.
   *
   * A ref rather than the `loggingOut` state because a second click can arrive
   * in the same tick as the first, before React has re-rendered with the
   * disabled state.
   */
  const inFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => {
 mounted.current = false;
}, []);

  const logout = useCallback(async () => {
    if (inFlight.current) return inFlight.current;

    setLoggingOut(true);
    const run = (async () => {
      try {
        await performLogout();

        router.replace('/');
        // After `replace`, so the refreshed tree is the one for `/`.
        router.refresh();
      } catch (error) {
        // Deliberately no navigation. Moving to `/` here would show a
        // signed-out-looking page while the session is still live on the server
        // — telling the visitor they are logged out when they are not is the one
        // outcome worse than an error message.
        showErrorMessage(error, 'Could not sign you out. Please try again.');
      } finally {
        inFlight.current = null;
        if (mounted.current) setLoggingOut(false);
      }
    })();

    inFlight.current = run;
    return run;
  }, [router]);

  return { logout, loggingOut };
}
