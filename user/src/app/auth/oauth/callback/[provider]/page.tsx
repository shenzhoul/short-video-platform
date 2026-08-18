/**
 * OAuth Callback Return Page
 *
 * This page handles the OAuth callback from social login providers.
 * It receives the authorization code from the OAuth provider and exchanges it
 * for tokens and user profile information via the backend.
 *
 * Flow:
 * 1. User clicks social login button
 * 2. Redirected to OAuth provider
 * 3. User authorizes and provider redirects back to THIS page with code
 * 4. This page renders OAuthCallbackHandler component to process
 * 5. On success: stores JWT token and redirects appropriately
 * 6. On error: shows error message and redirects back to login
 */

import OAuthCallbackHandler from '@components/auth/oauth-callback-handler';

export default async function OAuthCallbackPage({ params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  return <OAuthCallbackHandler provider={providerParam} />;
}
