'use client';

import { AuthPasswordField, AuthSelectField, AuthTextField } from '@components/auth/auth-fields';
import AuthVerificationNotice from '@components/auth/auth-verification-notice';
import Button from '@components/ui/button';
import { normalizeErrorMessage, toast } from '@douyin-clone/shared-toast';
import { zodResolver } from '@hookform/resolvers/zod';
import { hashPassword } from '@lib/crypto';
import { register as registerAccount } from '@services/auth.service';
import { RefObject, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

/**
 * The same character rule the admin create-user form applies to given names.
 * Copied deliberately rather than loosened: an account made here and an account
 * made by an administrator must be the same kind of record.
 */
const NAME_PATTERN = /^[a-zA-ZàáâäãåąčćęèéêëėįìíîïłńòóôöõøùúûüųūÿýżźñçčšžÀÁÂÄÃÅĄĆČĖĘÈÉÊËÌÍÎÏĮŁŃÒÓÔÖÕØÙÚÛÜŲŪŸÝŻŹÑßÇŒÆČŠŽ∂ð ,.'-]+$/;

/**
 * Signup validation, mirroring `admin/src/components/user/account-form.tsx`.
 *
 * The server is still the authority — `RegisterPayload` re-validates all of it,
 * including the reserved-username list this cannot see — but the rules are kept
 * in step so a visitor is not told a username is fine and then refused.
 */
const schema = z.object({
  firstName: z.string().trim().min(1, 'First name is required')
    .regex(NAME_PATTERN, 'First name cannot contain numbers or special characters'),
  lastName: z.string().trim().min(1, 'Last name is required')
    .regex(NAME_PATTERN, 'Last name cannot contain numbers or special characters'),
  username: z.string().trim().min(3, 'Username must have at least 3 characters')
    .regex(/^[a-zA-Z0-9]+$/, 'Username must contain only alphanumeric characters'),
  name: z.string().trim().min(3, 'Display name must have at least 3 characters')
    .max(16, 'Display name must be at most 16 characters'),
  email: z.string().trim().min(1, 'Email is required').email('Not a valid email'),
  gender: z.enum(['male', 'female']),
  password: z.string().min(8, 'Password must have at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password')
}).refine((values) => values.password === values.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

type SignupFormValues = z.infer<typeof schema>;

const SIGNUP_TOAST_ID = 'auth:signup';

interface AuthSignupFormProps {
  /** Switches the dialog back to the login pane without closing it. */
  onSwitchToLogin: () => void;
  /** Focus target when the dialog opens. */
  firstFieldRef?: RefObject<HTMLInputElement | null>;
}

export default function AuthSignupForm({ onSwitchToLogin, firstFieldRef }: AuthSignupFormProps) {
  const [submitting, setSubmitting] = useState(false);

  /**
   * Set once the account exists. Switching the pane rather than closing the
   * dialog, because the visitor is not finished — there is a link in their inbox
   * and a Resend control here if it never arrives.
   */
  const [createdAccount, setCreatedAccount] = useState<
    { email: string; emailQueued: boolean } | null
  >(null);

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
    setError,
    formState: { errors }
  } = useForm<SignupFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      firstName: '', lastName: '', username: '', name: '', email: '', gender: 'female', password: '', confirmPassword: ''
    }
  });

  const onSubmit = async (values: SignupFormValues) => {
    if (submitting) return;
    setSubmitting(true);

    try {
      const password = await hashPassword(values.password);

      const response = await registerAccount({
        email: values.email.trim(),
        username: values.username.trim(),
        name: values.name.trim(),
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        gender: values.gender,
        password
      });

      if (!activeRef.current) return;

      // **No sign-in here.** The account is created with an unconfirmed address
      // and `POST /auth/login` refuses it until the link is followed, so calling
      // `signIn` would produce a guaranteed failure and a misleading error. The
      // visitor's next step is their inbox, not this form.
      setCreatedAccount({
        email: values.email.trim(),
        // `false` means the account exists but the email did not reach the
        // queue. Not a failure — the account is fine — but it is the difference
        // between "check your inbox" and "press Resend".
        emailQueued: response?.data?.verificationEmailQueued !== false
      });
    } catch (error) {
      if (!activeRef.current) return;

      const message = normalizeErrorMessage(error, 'Could not create your account. Please try again.');

      // The two refusals a visitor can actually fix are attached to the field
      // that caused them, so there is one message in one place — no toast on top
      // of an inline error for the same problem.
      if (/email/i.test(message)) {
        setError('email', { type: 'server', message });
        return;
      }
      if (/username/i.test(message)) {
        setError('username', { type: 'server', message });
        return;
      }

      toast.error(message, { toastId: SIGNUP_TOAST_ID });
    } finally {
      if (activeRef.current) setSubmitting(false);
    }
  };

  if (createdAccount) {
    return (
      <AuthVerificationNotice
        heading={createdAccount.emailQueued ? 'Check your email' : 'Your account is ready'}
        email={createdAccount.email}
        identifier={createdAccount.email}
        detail={createdAccount.emailQueued
          ? undefined
          : 'We could not send the confirmation email just now. Press the button below to try again.'}
        onBack={onSwitchToLogin}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <AuthTextField
          ref={firstFieldRef}
          label="First name"
          placeholder="First name"
          autoComplete="given-name"
          register={register('firstName')}
          error={errors.firstName}
          disabled={submitting}
        />
        <AuthTextField
          label="Last name"
          placeholder="Last name"
          autoComplete="family-name"
          register={register('lastName')}
          error={errors.lastName}
          disabled={submitting}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <AuthTextField
          label="Username"
          placeholder="Username"
          autoComplete="username"
          register={register('username')}
          error={errors.username}
          disabled={submitting}
        />
        <AuthTextField
          label="Display name"
          placeholder="Display name"
          autoComplete="nickname"
          register={register('name')}
          error={errors.name}
          disabled={submitting}
        />
      </div>

      <AuthTextField
        label="Email"
        type="email"
        placeholder="Email"
        autoComplete="email"
        register={register('email')}
        error={errors.email}
        disabled={submitting}
      />

      <AuthSelectField
        label="Gender"
        register={register('gender')}
        error={errors.gender}
        disabled={submitting}
        options={[
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' }
        ]}
      />

      <div className="grid grid-cols-2 gap-3">
        <AuthPasswordField
          label="Password"
          placeholder="Password"
          autoComplete="new-password"
          register={register('password')}
          error={errors.password}
          disabled={submitting}
        />
        <AuthPasswordField
          label="Confirm password"
          placeholder="Confirm password"
          autoComplete="new-password"
          register={register('confirmPassword')}
          error={errors.confirmPassword}
          disabled={submitting}
        />
      </div>

      <Button
        type="submit"
        variant="primary"
        size="md"
        fullWidth
        disabled={submitting}
        className="mt-1 !rounded-lg !bg-[#ff2f5f] !bg-none hover:!bg-[#ff4772]"
      >
        {submitting ? 'Creating account…' : 'Sign up'}
      </Button>

      <p className="mt-2 text-center text-[13px] text-(--text-muted)">
        Already have an account?{' '}
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
