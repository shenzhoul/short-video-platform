'use client';

import Link from 'next/link';
import { FiArrowLeft } from 'react-icons/fi';

/**
 * AccountUnavailablePage
 *
 * Shown when a user attempts to access a creator profile that has been deleted.
 * Replaces the full profile page and hides all related content (posts, products, etc.).
 */
export default function AccountUnavailablePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-surface-muted dark:bg-gray-700 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-gray-400 dark:opacity-70"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold  dark:text-gray-100">
            This account is no longer available.
          </h1>
          <p className="opacity-70 dark:text-gray-400 text-sm">
            The creator profile you&apos;re looking for has been removed from the platform.
          </p>
        </div>

        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-primary-500 hover:text-primary-600 font-medium transition-colors"
        >
          <FiArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>
    </div>
  );
}
