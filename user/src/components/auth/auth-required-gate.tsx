'use client';

import { useAuthModal } from '@providers/auth-modal.provider';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useRef } from 'react';

/**
 * What a protected route renders instead of its content when there is no
 * session.
 *
 * The server page still decides — `getServerSession` runs before anything
 * private is fetched, so an unauthenticated visitor is never sent protected data
 * and never sees a flash of it. What changed is what happens next: the page used
 * to `redirect('/auth/login')`, throwing away the URL the visitor asked for.
 * Now it renders this, the shared dialog opens over the route, and the address
 * bar keeps pointing at where they were going. Signing in refreshes the route in
 * place and the real page appears.
 *
 * The three auth states are kept distinct on purpose:
 *
 *  - **loading** — the client session has not resolved. Nothing happens. Opening
 *    a dialog here would flash a login form at somebody who is already signed
 *    in, on every hard refresh of every protected page.
 *  - **authenticated** — the client has a session the server render did not see
 *    (it resolved a moment later, or the visitor signed in elsewhere). The page
 *    is refreshed once so the server can render the real content.
 *  - **unauthenticated** — the dialog opens, flagged as a route guard, so
 *    closing it returns the visitor to a public page rather than leaving them on
 *    an empty protected one.
 */
export default function AuthRequiredGate() {
  const { status } = useSession();
  const { openAuthModal } = useAuthModal();
  const router = useRouter();

  /**
   * At most one refresh per mount.
   *
   * `router.refresh()` re-renders this same tree, so without the guard a server
   * that still reports no session — a cookie the API rejected, say — would spin
   * refresh forever.
   */
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'authenticated') {
      if (refreshedRef.current) return;
      refreshedRef.current = true;
      router.refresh();
      return;
    }

    openAuthModal({ reason: 'route' });
  }, [status, openAuthModal, router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 text-center">
      <div>
        <h1 className="text-[18px] font-semibold text-(--text-strong)">
          Log in to continue
        </h1>
        <p className="mt-2 max-w-80 text-[14px] leading-5 text-(--text-muted)">
          {status === 'loading'
            ? 'Checking your session…'
            : 'This page is only available to members. Log in and you will land right back here.'}
        </p>
      </div>
    </div>
  );
}
