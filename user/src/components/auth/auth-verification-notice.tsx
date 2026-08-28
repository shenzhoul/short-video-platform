'use client';

import AuthResendVerification from '@components/auth/auth-resend-verification';
import Button from '@components/ui/button';
import { FiMail } from 'react-icons/fi';

interface AuthVerificationNoticeProps {
  heading: string;
  /** The address to show, when we know it. Shown verbatim, never guessed at. */
  email?: string;
  /** Identifier passed to the resend endpoint: an address or a username. */
  identifier: string;
  /** Extra sentence under the heading, when the situation needs one. */
  detail?: string;
  /** Label for the control that returns to the login pane. */
  backLabel?: string;
  onBack: () => void;
}

/**
 * "Check your email."
 *
 * Rendered in two places inside the dialog and deliberately identical in both:
 * after signing up, and after a correct password on an unconfirmed account.
 * Those are the same situation from the visitor's side — there is a link in
 * their inbox and nothing else to do — so they get the same screen rather than
 * two that differ in wording for no reason.
 *
 * The address is echoed when we have it, because the single most common cause of
 * "it never arrived" is a typo in it, and seeing it is what lets somebody notice.
 */
export default function AuthVerificationNotice({
  heading,
  email,
  identifier,
  detail,
  backLabel = 'Back to log in',
  onBack
}: AuthVerificationNoticeProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full bg-(--field-bg) text-[20px] text-[#ff2f5f]"
      >
        <FiMail />
      </span>

      <div>
        <h3 className="text-[17px] font-semibold text-(--text-strong)">{heading}</h3>
        {email ? (
          <p className="mt-1 text-[14px] leading-5 text-(--text-muted)">
            We sent a link to <span className="font-medium text-(--text-strong)">{email}</span>.
          </p>
        ) : null}
        <p className="mt-1 text-[14px] leading-5 text-(--text-muted)">
          {detail || 'Open it to finish setting up your account. The link is good for 24 hours.'}
        </p>
      </div>

      <div className="w-full">
        <AuthResendVerification identifier={identifier} />

        <Button
          type="button"
          variant="grey"
          size="md"
          fullWidth
          onClick={onBack}
          className="mt-2 !rounded-lg !bg-transparent"
        >
          {backLabel}
        </Button>
      </div>

      <p className="text-[12px] leading-4 text-(--text-faint)">
        Nothing in your inbox? Check the spam folder — the message comes from an address you have not
        written to before.
      </p>
    </div>
  );
}
