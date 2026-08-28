'use client';

import { AuthPasswordField } from '@components/auth/auth-fields';
import Button from '@components/ui/button';
import { zodResolver } from '@hookform/resolvers/zod';
import { getApiErrorCode } from '@lib/api-error';
import { hashPassword } from '@lib/crypto';
import { useAuthModal } from '@providers/auth-modal.provider';
import { resetPassword } from '@services/auth.service';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import { z } from 'zod';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full max-w-90 flex-col items-center gap-4 text-center">
      {children}
    </div>
  );
}

const schema = z.object({
  password: z.string().min(8, 'Password must have at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password')
}).refine((values) => values.password === values.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

type ResetFormValues = z.infer<typeof schema>;

/**
 * What `/auth/reset-password` renders.
 *
 * ## The password is hashed before it leaves the browser
 *
 * `hashPassword()`, exactly as login, registration and the admin create form do
 * it. The API stores a salted scrypt hash of *that* digest, so sending the
 * plaintext here would store a hash of the wrong input and the new password
 * would simply not work — with no error anywhere to explain why.
 *
 * ## Success does not sign anybody in
 *
 * Resetting a password is not signing in, and there is exactly one place in this
 * application that issues a session. The success state offers the login dialog
 * as a next step instead.
 *
 * ## The token is validated by using it, not before
 *
 * There is no "is this token still good?" probe on mount. A probe would either
 * consume the token — leaving nothing for the form to submit — or answer a
 * question anybody could ask about any token they cared to guess. So the form
 * renders, and the single POST is both the check and the change.
 */
export default function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token');
  const { openAuthModal } = useAuthModal();

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<'token' | 'transport' | null>(null);

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
  } = useForm<ResetFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' }
  });

  const onSubmit = async (values: ResetFormValues) => {
    if (submitting || !token) return;
    setSubmitting(true);
    setFailure(null);

    try {
      const password = await hashPassword(values.password);
      await resetPassword(token, password);
      if (activeRef.current) setDone(true);
    } catch (error: any) {
      if (!activeRef.current) return;

      // A spent, expired or unknown link. The token cannot be reused, so the
      // form is replaced rather than left for another attempt with it.
      //
      // Read through `getApiErrorCode`: `APIRequest` throws the response body,
      // so `error.response.data.error` is `undefined` and a check written
      // against it never matches — an expired link rendered "could not reach the
      // server" and invited the visitor to retry something that could not work.
      if (getApiErrorCode(error) === 'RESET_TOKEN_INVALID') {
        setFailure('token');
        return;
      }

      // Everything else — a validation refusal, a rate limit, a dropped
      // connection — leaves the link usable, so the form stays and the visitor
      // can try again with it.
      setFailure('transport');
    } finally {
      if (activeRef.current) setSubmitting(false);
    }
  };

  if (!token || failure === 'token') {
    return (
      <Shell>
        <span aria-hidden="true" className="text-[34px] text-[#ff2f5f]"><FiAlertCircle /></span>
        <h1 className="text-[20px] font-semibold text-(--text-strong)">This link no longer works</h1>
        <p className="text-[14px] leading-5 text-(--text-muted)">
          Reset links expire after an hour and can only be used once. Your password has not been
          changed — ask for a new link and try again.
        </p>
        <Button
          type="button"
          variant="primary"
          size="md"
          fullWidth
          onClick={() => openAuthModal({ mode: 'forgot' })}
          className="!rounded-lg !bg-[#ff2f5f] !bg-none hover:!bg-[#ff4772]"
        >
          Request a new link
        </Button>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <span aria-hidden="true" className="text-[34px] text-[#22c55e]"><FiCheckCircle /></span>
        <h1 className="text-[20px] font-semibold text-(--text-strong)">Password updated</h1>
        <p className="text-[14px] leading-5 text-(--text-muted)">
          Everywhere you were signed in has been signed out. Log in with your new password.
        </p>
        <Button
          type="button"
          variant="primary"
          size="md"
          fullWidth
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
      <h1 className="text-[20px] font-semibold text-(--text-strong)">Choose a new password</h1>
      <p className="text-[14px] leading-5 text-(--text-muted)">
        Pick something you have not used here before. Everywhere you are currently signed in will be
        signed out.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex w-full flex-col gap-3 text-left">
        <AuthPasswordField
          label="New password"
          placeholder="New password"
          autoComplete="new-password"
          register={register('password')}
          error={errors.password}
          disabled={submitting}
        />
        <AuthPasswordField
          label="Confirm new password"
          placeholder="Confirm new password"
          autoComplete="new-password"
          register={register('confirmPassword')}
          error={errors.confirmPassword}
          disabled={submitting}
        />

        {failure === 'transport' ? (
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
          {submitting ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </Shell>
  );
}
