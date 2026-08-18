/**
 * LoginForm Component
 *
 * A comprehensive login form component that handles user authentication.
 * Features form validation, redirect handling, remember me functionality,
 * and integration with NextAuth.js for authentication.
 *
 * @example
 * // Basic usage in a login page
 * <LoginForm />
 *
 * Features:
 * - Form validation with Zod schema
 * - Remember me functionality
 * - Redirect URL handling after login
 * - Loading states and error handling
 * - Links to registration and password recovery
 * - Email verification resend option
 */

'use client';

import Button from '@components/ui/button';
import { FormFieldPassword, FormFieldText } from '@components/ui/form-field';
import { zodResolver } from '@hookform/resolvers/zod';
import { hashPassword } from '@lib/crypto';
import { getRedirectUrl, removeRedirectUrl, setRedirectUrl } from '@lib/local-storage';
import { useMainThemeLayout } from '@providers/main-layout.provider';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { z } from 'zod';

const DEFAULT_REDIRECT_URL = '/';

const normalizeRedirectUrl = (url: string | null) => {
  if (!url) return null;

  const normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('/') || normalizedUrl.startsWith('//')) return null;

  // Auth and error routes should land on home after successful login.
  if (normalizedUrl.startsWith('/auth') || normalizedUrl.startsWith('/error')) {
    return DEFAULT_REDIRECT_URL;
  }

  return normalizedUrl;
};

export default function LoginForm() {
  const [isLoading, setIsLoading] = useState(false);
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirectUrl');
  const { publicSettings } = useMainThemeLayout();
  const siteName = publicSettings?.siteName || '';

  // validation
  const schema = z.object({
    username: z.string().min(3, 'Username must be at least 3 characters'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    remember: z.boolean().optional()
  });

  type LoginFormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch
  } = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      remember: true
    }
  });

  useEffect(() => {
    if (redirectUrl) {
      setRedirectUrl(decodeURIComponent(redirectUrl));
    }
  }, [redirectUrl]);

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);

    try {
      // Hash password on client-side before sending
      const hashedPassword = await hashPassword(data.password);

      const res = await signIn('credentials', {
        ...data,
        password: hashedPassword, // Send hashed password
        redirect: false
      });

      if (res?.ok) {
        // Force a small delay to ensure session/cookie is set
        await new Promise(resolve => setTimeout(resolve, 100));

        const localRedirectUrl = getRedirectUrl();

        const redirectUrl = localRedirectUrl ? normalizeRedirectUrl(localRedirectUrl) : DEFAULT_REDIRECT_URL;

        // Clear before navigating to avoid stale redirects on future logins.
        removeRedirectUrl();
        // Force a full page reload to ensure all providers refresh.
        window.location.href = redirectUrl;
        return;
      }
      if (res?.error) {
        toast.error(res.error || 'Error occurred, please try again later!');
      }
    } catch {
      toast.error('Login failed. Please try again.');
    }

    setIsLoading(false);
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="bg-surface w-[400px] max-w-full p-3 rounded-lg space-y-3"
      method="POST"
    >
      <h3 className='text-center font-bold mb-7 text-[30px]'>Welcome to {siteName}</h3>
      <FormFieldText
        name="username"
        register={register('username')}
        placeholder="Email/Username"
        error={errors.username}
        size='lg'
      />

      <FormFieldPassword
        name="password"
        type="password"
        register={register('password')}
        placeholder="Password"
        error={errors.password}
        size='lg'
      />

      <div className="flex items-center justify-between">
        <label className="flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            {...register('remember')}
            checked={watch('remember')}
            onChange={(e) => setValue('remember', e.target.checked)}
            className="w-4 h-4  border-border rounded"
          />
          <span className="text-sm opacity-70">Remember me</span>
        </label>
        <Link href="/auth/forgot-password" className="text-sm text-link hover:underline">
          Forgot password?
        </Link>
      </div>

      {/* Submit */}
      <div className="text-center">
        <Button
          type="submit"
          disabled={isLoading}
          variant="primary"
          fullWidth
          size='lg'
        >
          {isLoading ? 'Logging in...' : 'LOGIN'}
        </Button>

        <p className="text-sm mt-4">
          Don&apos;t have an account yet?{' '}
          <Link href="/auth/register" className="text-link hover:underline">
            Sign up here.
          </Link>
        </p>
      </div>
    </form>

  );
}
