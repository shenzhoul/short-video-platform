'use client';

import Button from '@components/ui/button';
import { resendVerification } from '@services/auth.service';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Matches the API's per-identifier cooldown, so the button and the server agree. */
const COOLDOWN_SECONDS = 60;

interface AuthResendVerificationProps {
  /** Email address or username — whichever the visitor gave us. */
  identifier: string;
  /**
   * Fire once as soon as this mounts.
   *
   * For the expired-link page, where the visitor has just typed their identifier
   * and pressed a button that means "send it" — making them press a second
   * button to do the thing they already asked for would be a worse screen for no
   * gain. The dialog's panes leave this off, because there the visitor has not
   * asked for anything yet.
   */
  sendOnMount?: boolean;
  /** Rendered above the button. */
  className?: string;
}

/**
 * The "send it again" control, shared by every screen that can be waiting on a
 * confirmation email.
 *
 * There are three of those — the check-your-email state after signing up, the
 * login pane when a correct password meets an unconfirmed address, and the
 * expired-link state on the public verification page — and they must not each
 * grow their own timer. One component means one cooldown rule and one piece of
 * copy to keep honest.
 *
 * ## The response never says whether it worked
 *
 * The API answers the same 200 for a registered address, an unregistered one,
 * one that is already confirmed, one inside its cooldown, and one where the
 * limiter could not report its state so the send was suppressed. Any difference
 * would let somebody use this to find out who has an account.
 *
 * So the confirmation below is conditional and instructional — "if that account
 * still needs confirming, look for a new link" — rather than claiming a message
 * was sent. Saying "sent!" would be a claim we cannot make, which is also why
 * the response field is `accepted` rather than `sent`.
 *
 * ## The timer is a courtesy, not the limit
 *
 * The server enforces the real cooldown and refuses silently. This countdown
 * exists so the visitor is not left pressing a button that appears to do
 * nothing.
 */
export default function AuthResendVerification({
  identifier, sendOnMount = false, className
}: AuthResendVerificationProps) {
  const [remaining, setRemaining] = useState(0);
  const [sending, setSending] = useState(false);
  const [asked, setAsked] = useState(false);

  /** No state writes after unmount: the dialog closes while a request is in flight. */
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
 activeRef.current = false;
};
  }, []);

  useEffect(() => {
    if (remaining <= 0) return undefined;
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  const onResend = useCallback(async () => {
    if (sending || remaining > 0 || !identifier) return;
    setSending(true);

    try {
      await resendVerification(identifier);
    } catch {
      // Deliberately swallowed. The only failures reachable here are a network
      // error and a 429, and neither changes what the visitor should do next —
      // wait, then try again. Reporting a 429 differently would also leak the
      // per-address cooldown, which is itself an enumeration signal.
    } finally {
      if (activeRef.current) {
        setSending(false);
        setAsked(true);
        setRemaining(COOLDOWN_SECONDS);
      }
    }
  }, [identifier, remaining, sending]);

  /**
   * The one automatic send, guarded by a ref rather than by effect dependencies.
   *
   * React 18's development StrictMode runs effects twice; without the guard the
   * second run would burn the visitor's 60-second cooldown immediately, so the
   * button they were meant to be able to press would already be counting down.
   */
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (!sendOnMount || autoSentRef.current || !identifier) return;
    autoSentRef.current = true;
    onResend();
  }, [sendOnMount, identifier, onResend]);

  return (
    <div className={className}>
      <Button
        type="button"
        variant="grey"
        size="md"
        fullWidth
        disabled={sending || remaining > 0}
        onClick={onResend}
        className="!rounded-lg"
      >
        {remaining > 0 ? `Send again in ${remaining}s` : 'Send the link again'}
      </Button>

      {asked ? (
        <p role="status" className="mt-2 text-center text-[13px] leading-5 text-(--text-muted)">
          If that account still needs confirming, look for a new link in your inbox.
        </p>
      ) : null}
    </div>
  );
}
