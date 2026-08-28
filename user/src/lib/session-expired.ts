import cookie from 'js-cookie';
import { signOut } from 'next-auth/react';

/**
 * End a session the server has already rejected.
 *
 * This is the *forced* half of signing out — a 401 on an API call, an account
 * that has been deactivated, a socket the server hung up on. It is not the
 * Logout button; that is `useLogout`, which can use the router and keeps the
 * client tree alive.
 *
 * Why a hard navigation here, when the Logout button deliberately avoids one:
 * this runs from places that have no router. `api-request.ts` is a plain module
 * shared with server rendering, and a socket handler fires outside React's
 * lifecycle. More importantly the session is already dead, so every piece of
 * client cache built from it is stale — throwing the document away is the
 * cheapest correct answer, and `replace` keeps the dead route out of history.
 *
 * The destination is `/`, never a logout page. The user app has no such page:
 * a confirmation screen after an involuntary sign-out is a dead end that tells
 * the visitor nothing they can act on.
 */

/**
 * De-duplicates concurrent calls.
 *
 * A single failed page render can produce several 401s at once — the profile
 * load, a feed request and a notification poll all rejecting together. Without
 * this each one would call `signOut` and then race to navigate.
 */
let ending: Promise<void> | null = null;

export function endExpiredSession(): Promise<void> {
  // Server rendering has no session to end and no `window` to navigate.
  if (typeof window === 'undefined') return Promise.resolve();
  if (ending) return ending;

  ending = (async () => {
    try {
      // `redirect: false` because the navigation below is ours. This also fires
      // the NextAuth `signOut` event, which is what revokes the token on the
      // API — clearing cookies alone would leave a live session behind.
      await signOut({ redirect: false });
    } catch {
      // NextAuth clears its own cookie even when the round trip fails, and the
      // caller is already handling a rejected request. Refusing to navigate here
      // would strand the visitor on a page that cannot load.
    } finally {
      cookie.remove('token');
      // `replace`, so Back does not return to the page that just 401ed.
      window.location.replace('/');
      ending = null;
    }
  })();

  return ending;
}

/** Test seam: forget any in-flight call between cases. */
export function resetExpiredSessionState() {
  ending = null;
}
