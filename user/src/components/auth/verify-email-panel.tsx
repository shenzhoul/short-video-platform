'use client';

import AuthResendVerification from '@components/auth/auth-resend-verification';
import Button from '@components/ui/button';
import { useAuthModal } from '@providers/auth-modal.provider';
import { verifyEmail } from '@services/auth.service';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { FiAlertCircle, FiCheckCircle } from 'react-icons/fi';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-90 flex-col items-center gap-4 text-center">
      {children}
    </div>
  );
}

/**
 * Ask for the identifier before offering Resend.
 *
 * The expired token carried one, but the API will not tell us which account it
 * belonged to — deliberately, because this page is public and anyone with a
 * guessed token could otherwise read an address off it.
 */
function ResendByIdentifier() {
  const [identifier, setIdentifier] = useState('');
  const [confirmed, setConfirmed] = useState('');

  return (
    <div className="w-full">
      <label htmlFor="resend-identifier" className="sr-only">Email or username</label>
      <input
        id="resend-identifier"
        type="text"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        placeholder="Email or username"
        autoComplete="username"
        className="mb-2 h-11 w-full rounded-lg border border-transparent bg-(--field-bg) px-3 text-[14px] text-(--text-strong) outline-none placeholder:text-(--text-faint) focus:border-(--divider-strong)"
      />
      {confirmed ? <AuthResendVerification identifier={confirmed} sendOnMount /> : (
        <Button
          type="button"
          variant="grey"
          size="md"
          fullWidth
          disabled={!identifier.trim()}
          onClick={() => setConfirmed(identifier.trim())}
          className="!rounded-lg"
        >
          Send a new link
        </Button>
      )}
    </div>
  );
}

type PanelState = 'working' | 'confirmed' | 'invalid';

/**
 * What `/auth/verify-email` renders.
 *
 * ## The page does the mutating, not the link
 *
 * The link in the email is an ordinary GET to this page; this component then
 * POSTs the token to the API. Gmail and most security appliances fetch the URLs
 * in a message to scan them, so a GET that consumed the token would be spent by
 * the scanner before the recipient ever clicked — they would open the mail and
 * find a link that had already been used.
 *
 * ## It does not open the login dialog first
 *
 * Confirming an address is something a visitor is entitled to do without an
 * account, and putting a login form over the result would be asking them to sign
 * in to read an answer about the account they cannot sign in to yet. The dialog
 * is offered *after* the outcome is known, as a next step.
 *
 * ## Exactly once per mount
 *
 * A ref guard, not an effect dependency: React 18's development StrictMode runs
 * effects twice, and the second run would consume a token the first one had
 * already spent — turning every confirmation in development into an
 * "already used" error.
 */
export default function VerifyEmailPanel() {
  const params = useSearchParams();
  const token = params.get('token');
  const { openAuthModal } = useAuthModal();

  const [state, setState] = useState<PanelState>('working');
  const attemptedRef = useRef(false);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
 activeRef.current = false;
};
  }, []);

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    if (!token) {
      setState('invalid');
      return;
    }

    verifyEmail(token)
      .then(() => {
        if (!activeRef.current) return;
        // `alreadyVerified` is not surfaced. From the visitor's side "your
        // address is confirmed" is the same good news either way, and drawing
        // the distinction only invites them to wonder what went wrong.
        setState('confirmed');
      })
      .catch(() => {
        // Unknown, expired, superseded and already-used all arrive here as one
        // error, because they lead to the same next step and telling them apart
        // would help somebody probing token values.
        if (activeRef.current) setState('invalid');
      });
  }, [token]);

  if (state === 'working') {
    return (
      <Shell>
        <p role="status" className="text-[15px] text-(--text-muted)">Confirming your email address…</p>
      </Shell>
    );
  }

  if (state === 'confirmed') {
    return (
      <Shell>
        <span aria-hidden="true" className="text-[34px] text-[#22c55e]"><FiCheckCircle /></span>
        <h1 className="text-[20px] font-semibold text-(--text-strong)">Email confirmed</h1>
        <p className="text-[14px] leading-5 text-(--text-muted)">
          Your address is confirmed and your account is ready. You can log in now.
        </p>
        <Button
          type="button"
          variant="primary"
          size="md"
          fullWidth
          // Opens the shared dialog over this page rather than navigating to a
          // login route — there is no login page, and there has not been one
          // since the auth modal replaced it.
          onClick={() => openAuthModal({ mode: 'login' })}
          className="!rounded-lg !bg-[#ff2f5f] !bg-none hover:!bg-[#ff4772]"
        >
          Log in
        </Button>
      </Shell>
    );
  }

  return (
    <Shell>
      <span aria-hidden="true" className="text-[34px] text-[#ff2f5f]"><FiAlertCircle /></span>
      <h1 className="text-[20px] font-semibold text-(--text-strong)">This link no longer works</h1>
      <p className="text-[14px] leading-5 text-(--text-muted)">
        Confirmation links expire after 24 hours and can only be used once. Enter your email address
        or username and we will send a fresh one.
      </p>
      <ResendByIdentifier />
      <button
        type="button"
        onClick={() => openAuthModal({ mode: 'login' })}
        className="cursor-pointer text-[13px] text-(--text-muted) hover:text-(--text-strong) hover:underline"
      >
        Back to log in
      </button>
    </Shell>
  );
}
