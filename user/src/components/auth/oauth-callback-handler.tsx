/**
 * OAuth Callback Handler Component
 *
 * Handles the OAuth callback from social login providers.
 * This component:
 * 1. Receives the authorization code from OAuth provider
 * 2. Exchanges it for tokens via backend
 * 3. Determines appropriate redirect based on user status
 * 4. Handles loading and error states
 *
 * Backend Response should include:
 * - token: JWT token for authentication
 * - user: User data (email, name, etc.)
 * - isNewUser: Boolean indicating if this is a new registration
 * - redirectUrl: URL to redirect after successful authentication
 * - message: Any message to display to user
 */

'use client';

import { DEFAULT_POST_LOGIN_REDIRECT_URL, normalizeInternalRedirectUrl } from '@lib/auth-redirect';
import { handleOAuthCallback, initOAuth } from '@services/auth.service';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';

interface OAuthCallbackHandlerProps {
  provider: string;
}

export default function OAuthCallbackHandler({ provider }: OAuthCallbackHandlerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isProcessing, setIsProcessing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the authorization code from URL params
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const redirectTo = normalizeInternalRedirectUrl(searchParams.get('redirectTo'));
        const requestedUserRole = redirectTo?.includes('creator') || redirectTo?.includes('model-register')
          ? 'creator'
          : 'user';

        if (!code) {
          // No code means we need to initialize OAuth flow
          setIsProcessing(true);
          const initData = await initOAuth(provider, requestedUserRole);

          // Redirect to OAuth provider immediately
          window.location.href = initData.authorizationUrl;
          return;
        }

        if (!provider) {
          throw new Error('No provider specified');
        }

        // Exchange code for tokens via backend using auth service
        const data = await handleOAuthCallback(provider, code, state);

        // Show success message
        toast.success(data.message || 'Successfully authenticated with provider!');

        // Prepare redirect URL with OAuth data for registration forms
        const oauthParams = new URLSearchParams({
          hash: data.hash || '',
          provider: provider,
          email: data.email || '',
          name: data.name || '',
          username: (data.username || '').toLowerCase(),
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          ...(data.profilePictureUrl && { profilePicture: data.profilePictureUrl })
        });

        let finalRedirect = '/';

        // If new user, redirect to appropriate registration form with OAuth data
        if (data.isNewUser) {
          finalRedirect = redirectTo
            ? `${redirectTo}?${oauthParams.toString()}`
            : `/auth/register?${oauthParams.toString()}`;
        } else {
          // Existing user - sign in with NextAuth using the token from backend
          const signInResult = await signIn('credentials', {
            token: data.token,
            redirect: false
          });

          if (signInResult?.ok) {
            if (redirectTo) {
              finalRedirect = redirectTo;
            } else {
              finalRedirect = DEFAULT_POST_LOGIN_REDIRECT_URL;
            }
          } else {
            throw new Error(signInResult?.error || 'Failed to sign in with OAuth');
          }
        }

        // Redirect after a brief delay
        setTimeout(() => {
          router.push(finalRedirect);
        }, 500);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An error occurred during OAuth callback';
        setError(errorMessage);
        toast.error(errorMessage);
        setIsProcessing(false);

        // Redirect to login after 3 seconds on error
        setTimeout(() => {
          router.push('/auth/login');
        }, 3000);
      }
    };

    handleCallback();
  }, [provider, router, searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-linear-to-br from-gray-50 to-gray-100">
      <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
        {isProcessing && !error ? (
          <div className="text-center">
            <div className="mb-4">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">
              Signing you in...
            </h2>
            <p className="opacity-60 text-sm">
              Completing your social login. Please wait.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="text-center">
            <div className="mb-4">
              <svg
                className="w-12 h-12 mx-auto text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4v2m0-12a9 9 0 110 18 9 9 0 010-18z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">
              Sign In Failed
            </h2>
            <p className="opacity-60 text-sm mb-4">
              {error}
            </p>
            <p className="text-gray-500 text-xs">
              Redirecting to login page...
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
