'use client';

import { AuthPasswordField, AuthTextField } from '@components/auth/auth-fields';
import AuthVerificationNotice from '@components/auth/auth-verification-notice';
import Button from '@components/ui/button';
import { toast } from '@douyin-clone/shared-toast';
import { zodResolver } from '@hookform/resolvers/zod';
import { hashPassword } from '@lib/crypto';
import { signIn } from 'next-auth/react';
import { RefObject, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

/**
 * The only thing a failed sign-in ever says.
 *
 * The API distinguishes "no such account", "wrong password" and "account
 * inactive"; the dialog deliberately does not, because the difference tells an
 * attacker which usernames exist. It is also the reason nothing here forwards
 * the server's message: whatever went wrong, the visitor's next action is the
 * same.
 */
export const LOGIN_FAILED_MESSAGE = 'Your username/email or password is incorrect';

/**
 * The one refusal that is *not* collapsed into the message above.
 *
 * The API answers 403 with this code only after the password has been verified,
 * so reaching it already proves the caller holds the account's credentials —
 * which is what makes it safe to be specific. A wrong password on an
 * unconfirmed account still returns the generic failure.
 *
 * Reported as an actionable state rather than a toast, because "your email is
 * not confirmed" is useless without the means to do something about it.
 */
const EMAIL_VERIFICATION_REQUIRED = 'EMAIL_VERIFICATION_REQUIRED';

/**
 * A fixed id, so react-toastify collapses repeats.
 *
 * Two failed attempts in a row must not stack two identical toasts, and neither
 * must a single failure that somehow reports twice.
 */
const LOGIN_TOAST_ID = 'auth:login-failed';

const schema = z.object({
  username: z.string().trim().min(1, 'Enter your email or username'),
  password: z.string().min(1, 'Enter your password')
});

type LoginFormValues = z.infer<typeof schema>;

interface AuthLoginFormProps {
  /** Switches the dialog to the signup pane without closing it. */
  onSwitchToSignup: () => void;
  /** Switches the dialog to the forgot-password pane without closing it. */
  onSwitchToForgot: () => void;
  /** Focus target when the dialog opens. */
  firstFieldRef?: RefObject<HTMLInputElement | null>;
}

export default function AuthLoginForm({
  onSwitchToSignup, onSwitchToForgot, firstFieldRef
}: AuthLoginFormProps) {
  const [submitting, setSubmitting] = useState(false);

  /**
   * The identifier of an account that signed in correctly but has not confirmed
   * its address. Local state rather than a provider mode: it belongs to this
   * one submission, and lifting it would make the provider carry state that
   * only this form can produce or clear.
   */
  const [unverifiedIdentifier, setUnverifiedIdentifier] = useState<string | null>(null);

  /**
   * Guards against a late response writing to a form that is gone.
   *
   * The dialog unmounts this the moment the session turns authenticated, and
   * switching to signup unmounts it too — both can happen while a request is in
   * flight.
   */
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
 activeRef.current = false;
};
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '' }
  });

  const onSubmit = async (values: LoginFormValues) => {
    // Belt and braces alongside the disabled button: a keyboard Enter can
    // outrun a re-render, and a second POST would burn one of the five
    // attempts the API allows per minute.
    if (submitting) return;
    setSubmitting(true);

    try {
      // Hashed before it leaves the browser, exactly as the previous login page
      // did — the API stores a salted hash of *this* value, so changing it here
      // would invalidate every existing password.
      const password = await hashPassword(values.password);

      const result = await signIn('credentials', {
        username: values.username.trim(),
        password,
        redirect: false
      });

      // `signIn` has already refreshed the session by the time it resolves, so
      // there is nothing to do on success: the provider sees the status change,
      // closes the dialog and refreshes the route the visitor was on.
      //
      // Nothing is replayed. The like or follow that opened this dialog is not
      // re-issued — a queued write that fires later is how one click becomes two
      // comments — so the visitor simply clicks again, now signed in.
      if (result?.ok) return;

      if (!activeRef.current) return;

      // The password was right; the address is not confirmed. No session was
      // created — the API refuses before issuing one — so there is nothing to
      // clean up, and the visitor needs the link rather than a toast.
      if (result?.error === EMAIL_VERIFICATION_REQUIRED) {
        setUnverifiedIdentifier(values.username.trim());
        return;
      }

      toast.error(LOGIN_FAILED_MESSAGE, { toastId: LOGIN_TOAST_ID });
    } catch {
      if (!activeRef.current) return;
      // A transport failure, not a credential one, so it gets its own wording —
      // still one toast, still nothing from the server verbatim.
      toast.error('Could not reach the server. Please try again.', { toastId: LOGIN_TOAST_ID });
    } finally {
      if (activeRef.current) setSubmitting(false);
    }
  };

  if (unverifiedIdentifier) {
    return (
      <AuthVerificationNotice
        heading="Confirm your email address"
        identifier={unverifiedIdentifier}
        detail="Your password is correct, but this account still needs its email address confirmed before you can log in."
        onBack={() => setUnverifiedIdentifier(null)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3">
      <AuthTextField
        ref={firstFieldRef}
        label="Email or username"
        placeholder="Email or username"
        autoComplete="username"
        register={register('username')}
        error={errors.username}
        disabled={submitting}
      />

      <AuthPasswordField
        label="Password"
        placeholder="Password"
        autoComplete="current-password"
        register={register('password')}
        error={errors.password}
        disabled={submitting}
      />

      <Button
        type="submit"
        variant="primary"
        size="md"
        fullWidth
        disabled={submitting}
        className="mt-1 !rounded-lg !bg-[#ff2f5f] !bg-none hover:!bg-[#ff4772]"
      >
        {submitting ? 'Logging in…' : 'Log in'}
      </Button>

      {/* The recovery link exists only now that the flow behind it does. It was
          deliberately absent while `POST /auth/forgot` answered 404, because a
          link to a feature that does not work is worse than no link. */}
      <button
        type="button"
        onClick={onSwitchToForgot}
        className="cursor-pointer self-end text-[13px] text-(--text-muted) hover:text-(--text-strong) hover:underline"
      >
        Forgot password?
      </button>

      <p className="mt-2 text-center text-[13px] text-(--text-muted)">
        Don&apos;t have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToSignup}
          className="cursor-pointer font-medium text-[#ff2f5f] hover:underline"
        >
          Sign up
        </button>
      </p>
    </form>
  );
}
