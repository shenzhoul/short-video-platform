import ResetPasswordForm from '@components/auth/reset-password-form';
import { Metadata } from 'next';
import { Suspense } from 'react';

/** See the note on the verify-email route: token-bearing URL, nothing to index. */
export const metadata: Metadata = {
  title: 'Choose a new password',
  robots: { index: false, follow: false }
};

/**
 * Public. Somebody who has forgotten their password cannot sign in to reach a
 * page that lets them change it, so this route must never be gated.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
