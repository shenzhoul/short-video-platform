'use client';

import { AccessRestrictionReason } from '@lib/api-error';
import Link from 'next/link';

interface AccessForbiddenContentProps {
  reason?: AccessRestrictionReason;
}

export function AccessForbiddenContent({ reason = 'generic' }: AccessForbiddenContentProps) {
  const description = reason === 'creator-block'
    ? 'This creator profile is not available to you.'
    : reason === 'region-block'
      ? 'Access to this creator\'s content is restricted in your region.'
      : 'You don\'t have permission to access this resource.';

  return (
    <div className="min-h-screen bg-surface-soft flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Access Restricted</h1>
          <p className="opacity-60 mb-6">{description}</p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => window.history.back()}
            className="w-full px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
          >
            Go Back
          </button>
          <Link
            href="/"
            className="block w-full px-4 py-2 bg-surface-muted rounded-lg hover:bg-gray-300 transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
