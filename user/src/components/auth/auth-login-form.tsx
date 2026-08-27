'use client';

import { AuthPasswordField, AuthTextField } from '@components/auth/auth-fields';
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
  /** Focus target when the dialog opens. */
  firstFieldRef?: RefObject<HTMLInputElement | null>;
}

export default function AuthLoginForm({ onSwitchToSignup, firstFieldRef }: AuthLoginFormProps) {
  const [submitting, setSubmitting] = useState(false);

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
