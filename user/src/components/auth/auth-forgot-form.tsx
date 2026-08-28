'use client';

import { AuthTextField } from '@components/auth/auth-fields';
import Button from '@components/ui/button';
import { zodResolver } from '@hookform/resolvers/zod';
import { isTransportFailure } from '@lib/api-error';
import { forgotPassword } from '@services/auth.service';
import { RefObject, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FiMail } from 'react-icons/fi';
import { z } from 'zod';

const schema = z.object({
  email: z.string().trim().min(1, 'Enter your email address').email('Not a valid email')
});

type ForgotFormValues = z.infer<typeof schema>;

interface AuthForgotFormProps {
  onSwitchToLogin: () => void;
  firstFieldRef?: RefObject<HTMLInputElement | null>;
}

/**
 * "Forgot password?"
 *
 * ## The confirmation is deliberately non-committal
 *
 * The API answers the same 200 for a registered address, an unregistered one,
 * an unconfirmed one, one inside its per-address cooldown, and one where Redis
 * could not report the rate-limit state so the send was suppressed. Any
 * difference between those would turn this form into a way to find out who has
 * an account here.
 *
 * So the copy *instructs* rather than *asserts*: "look for a link", never "we
 * sent it". The response field is called `accepted`, not `sent`, for the same
 * reason — in several of those five cases no message was produced at all, and
 * the browser has no way to know which case it is in.
 *
 * That also means a network error is the **only** thing worth reporting
 * differently. A 429 is folded into the same success state for the same reason:
 * "you are being rate limited on this address" is itself a signal that the
 * address exists.
 */
export default function AuthForgotForm({ onSwitchToLogin, firstFieldRef }: AuthForgotFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [transportFailed, setTransportFailed] = useState(false);

  /** See the note in `auth-login-form.tsx`: no late writes after unmount. */
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
  } = useForm<ForgotFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' }
  });

  const onSubmit = async (values: ForgotFormValues) => {
    if (submitting) return;
    setSubmitting(true);
    setTransportFailed(false);

    const email = values.email.trim();

    try {
      await forgotPassword(email);
      if (activeRef.current) setSentTo(email);
    } catch (error: any) {
      if (!activeRef.current) return;

      // Anything the *server* answered lands in the same success state — a 429
      // most of all. The rate limit is per address, so a visibly different
      // outcome for a limited address is itself a signal that the address is
      // registered, which is exactly what the generic response exists to hide.
      //
      // `isTransportFailure` rather than `error.response.status`: `APIRequest`
      // throws the response *body*, so the axios shape is never present and a
      // check written against it is dead code — every 429 fell through to the
      // transport message below.
      if (!isTransportFailure(error)) {
        setSentTo(email);
        return;
      }

      // Nothing reached the API at all, so there is no account information to
      // leak by saying so.
      setTransportFailed(true);
    } finally {
      if (activeRef.current) setSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-(--field-bg) text-[20px] text-[#ff2f5f]"
        >
          <FiMail />
        </span>

        <div>
          <h3 className="text-[17px] font-semibold text-(--text-strong)">Check your email</h3>
          <p className="mt-1 text-[14px] leading-5 text-(--text-muted)">
            If <span className="font-medium text-(--text-strong)">{sentTo}</span> has an account,
            look for a link to choose a new password. It is good for one hour.
          </p>
        </div>

        <Button
          type="button"
          variant="grey"
          size="md"
          fullWidth
          onClick={onSwitchToLogin}
          className="!rounded-lg"
        >
          Back to log in
        </Button>

        <p className="text-[12px] leading-4 text-(--text-faint)">
          Nothing in your inbox? Check the spam folder, and make sure the address is the one you
          signed up with.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3">
      <p className="text-[14px] leading-5 text-(--text-muted)">
        Enter the address you signed up with and we will send you a link to choose a new password.
      </p>

      <AuthTextField
        ref={firstFieldRef}
        label="Email"
        type="email"
        placeholder="Email"
        autoComplete="email"
        register={register('email')}
        error={errors.email}
        disabled={submitting}
      />

      {transportFailed ? (
        <p role="alert" className="text-[13px] leading-5 text-[#ff2f5f]">
          Could not reach the server. Please try again.
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="md"
        fullWidth
        disabled={submitting}
        className="mt-1 !rounded-lg !bg-[#ff2f5f] !bg-none hover:!bg-[#ff4772]"
      >
        {submitting ? 'Sending…' : 'Send reset link'}
      </Button>

      <p className="mt-2 text-center text-[13px] text-(--text-muted)">
        Remembered it?{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="cursor-pointer font-medium text-[#ff2f5f] hover:underline"
        >
          Log in
        </button>
      </p>
    </form>
  );
}
