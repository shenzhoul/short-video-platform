import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-soft">
      <div className="text-center p-8 bg-surface rounded-lg shadow-md max-w-md w-full">
        <h1 className="text-4xl font-bold bg-surface mb-4">404</h1>
        <h2 className="text-xl font-semibold opacity-70 mb-4">Page Not Found</h2>
        <p className="opacity-60 mb-6">
          Sorry, we couldn&apos;t find the page you&apos;re looking for.
        </p>
        <Link
          href={`/auth/login?redirectUrl=${encodeURIComponent('/')}`}
          className="inline-block px-6 py-3 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors"
        >
          Go to Login
        </Link>
      </div>
    </div>
  );
}
