'use client';

import AuthModal from '@components/auth/auth-modal';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  createContext,
  ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

/**
 * Which pane the dialog is showing.
 *
 * `forgot` is a genuine third pane with its own form and its own endpoint, so it
 * belongs here. The narrower states — "check your email" after signing up, and
 * "confirm your address" after a correct password on an unconfirmed account —
 * deliberately do **not**: they are local to a single submission of a single
 * form, and lifting them would make the provider carry state only that form can
 * produce or clear.
 */
export type AuthModalMode = 'login' | 'signup' | 'forgot';

/**
 * Why the modal was opened, which is the only thing that decides what closing it
 * means.
 *
 * - `action` — a like, a follow, a message. The page behind is public and stays
 *   exactly as it was, so closing is simply closing.
 * - `route` — the visitor asked for a protected page. There is nothing behind
 *   the modal to go back to, so closing it without signing in has to take them
 *   somewhere real.
 */
export type AuthModalReason = 'action' | 'route';

export interface OpenAuthModalOptions {
  /** Which pane opens first. Defaults to `login`. */
  mode?: AuthModalMode;
  /** Defaults to `action`. See {@link AuthModalReason}. */
  reason?: AuthModalReason;
}

interface AuthModalContextValue {
  open: boolean;
  mode: AuthModalMode;
  openAuthModal: (options?: OpenAuthModalOptions) => void;
  closeAuthModal: () => void;
  setMode: (mode: AuthModalMode) => void;
}

const AuthModalContext = createContext<AuthModalContextValue>({
  open: false,
  mode: 'login',
  openAuthModal: () => { },
  closeAuthModal: () => { },
  setMode: () => { }
});

/** Query parameter that opens the modal on load, used by the `/auth/login` redirect. */
export const AUTH_MODAL_PARAM = 'authModal';

/** Where a visitor is sent when they close the modal on a page they may not see. */
export const PUBLIC_FALLBACK_ROUTE = '/';

/**
 * Opens the modal from `?authModal=login`, then removes the parameter.
 *
 * `/auth/login` no longer renders anything — the middleware turns it into a
 * redirect to the home page carrying this parameter — so this is what makes a
 * bookmarked or typed login URL still show a login form.
 *
 * Isolated in its own component behind `Suspense` for the same reason
 * `MainLayoutProvider` isolates its own: `useSearchParams` opts the whole route
 * out of static rendering otherwise.
 */
function AuthModalUrlTrigger({ onRequest }: { onRequest: (mode: AuthModalMode) => void }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const requested = params.get(AUTH_MODAL_PARAM);

  useEffect(() => {
    // `forgot` is intentionally not accepted from the URL. The pane is reached
    // from the login form, and a link that opens it directly would be a link
    // worth sending to somebody in a phishing email.
    if (requested !== 'login' && requested !== 'signup') return;

    onRequest(requested);

    // Strip the parameter so a refresh, a share, or a back-navigation does not
    // reopen the modal over a page the visitor has since signed into.
    const next = new URLSearchParams(params.toString());
    next.delete(AUTH_MODAL_PARAM);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    // `params` and `router` are stable enough here; re-running on the requested
    // value alone is what keeps this to one open per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  return null;
}

/**
 * The application's single authentication modal.
 *
 * Mounted once beside the page — the same arrangement as the message workspace
 * and the follower list — so every "you need an account for this" in the product
 * opens the *same* dialog rather than each surface rendering its own. That is
 * what makes "only one auth modal at a time" a property of the structure
 * instead of something each caller has to remember.
 *
 * Nothing here navigates to a login page. A guarded action opens this; a guarded
 * route renders `AuthRequiredGate`, which opens this. The URL the visitor asked
 * for is preserved throughout, so signing in continues where they were rather
 * than dropping them on a home page.
 */
export function AuthModalProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setModeState] = useState<AuthModalMode>('login');
  const reasonRef = useRef<AuthModalReason>('action');

  const openAuthModal = useCallback((options: OpenAuthModalOptions = {}) => {
    // Already signed in: every caller is a guard, and a guard that fires for an
    // authenticated visitor is a bug in the caller, not a reason to show a login
    // form over content they are entitled to.
    if (status === 'authenticated') return;

    reasonRef.current = options.reason || 'action';
    setModeState(options.mode || 'login');
    // Idempotent by construction. Ten rapid clicks on a gated button set the
    // same state ten times and produce one dialog.
    setOpen(true);
  }, [status]);

  const closeAuthModal = useCallback(() => {
    setOpen(false);

    // Closing on a protected route leaves nothing behind the modal: the page
    // rendered a gate, not content. `replace` rather than `push` so the back
    // button does not walk straight back into the same empty route and reopen
    // the modal forever.
    if (reasonRef.current === 'route' && status !== 'authenticated') {
      router.replace(PUBLIC_FALLBACK_ROUTE);
    }
    reasonRef.current = 'action';
  }, [router, status]);

  const setMode = useCallback((next: AuthModalMode) => setModeState(next), []);

  /**
   * Signing in anywhere closes this and refreshes the server-rendered tree.
   *
   * The refresh is what lets a protected route finish rendering without a full
   * page reload: the server component re-runs with the new session cookie and
   * swaps the gate for the real page, while client state — scroll position,
   * open panels, a half-typed comment — survives.
   */
  useEffect(() => {
    if (status !== 'authenticated') return;
    reasonRef.current = 'action';
    setOpen((wasOpen) => {
      if (wasOpen) router.refresh();
      return false;
    });
  }, [status, router]);

  const value = useMemo(() => ({
    open, mode, openAuthModal, closeAuthModal, setMode
  }), [open, mode, openAuthModal, closeAuthModal, setMode]);

  return (
    <AuthModalContext.Provider value={value}>
      <Suspense fallback={null}>
        <AuthModalUrlTrigger
          onRequest={(requestedMode) => openAuthModal({ mode: requestedMode })}
        />
      </Suspense>
      {children}
      {open ? <AuthModal /> : null}
    </AuthModalContext.Provider>
  );
}

/**
 * Open the shared login/signup dialog.
 *
 * ```ts
 * const { openAuthModal } = useAuthModal();
 * if (!loggedIn) { openAuthModal(); return; }
 * ```
 *
 * Use `{ reason: 'route' }` only from a route guard — it changes what closing
 * the dialog does.
 */
export function useAuthModal(): AuthModalContextValue {
  return useContext(AuthModalContext);
}
