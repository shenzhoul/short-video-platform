import VerifyEmailPanel from '@components/auth/verify-email-panel';
import { Metadata } from 'next';
import { Suspense } from 'react';

/**
 * `noindex` deliberately. The URL only means anything with a one-time token
 * attached, so there is nothing here worth indexing and a crawler following a
 * leaked link would consume somebody's confirmation.
 */
export const metadata: Metadata = {
  title: 'Confirm your email',
  robots: { index: false, follow: false }
};

/**
 * Public. Reached from a link in an email, by somebody who by definition cannot
 * log in yet, so nothing on this route may be behind `AuthRequiredGate` — and
 * `user/src/proxy.ts` must keep it out of the retired-URL redirect list.
 */
export default function VerifyEmailPage() {
  return (
    // `useSearchParams` inside opts the route out of static rendering unless it
    // sits behind a boundary, the same arrangement `AuthModalUrlTrigger` uses.
    <Suspense fallback={null}>
      <VerifyEmailPanel />
    </Suspense>
  );
}
