/**
 * Server-side authentication utilities
 * Helper functions for getting session and token in Server Components
 */

import { authOptions } from '@lib/auth-options';
import { getServerSession } from 'next-auth';

/**
 * Get the current session in a Server Component
 * @returns The NextAuth session or null if not authenticated
 */
export async function getSession() {
  return await getServerSession(authOptions);
}

/**
 * Get the authentication token from the session in a Server Component
 * @returns The access token string or undefined if not authenticated
 */
export async function getServerToken() {
  const session = await getServerSession(authOptions);
  return session?.accessToken;
}

/**
 * Get both session and token in a Server Component
 * @returns Object containing session and token
 */
export async function getServerAuth() {
  const session = await getServerSession(authOptions);
  return {
    session,
    token: session?.accessToken,
    user: session?.user
  };
}
