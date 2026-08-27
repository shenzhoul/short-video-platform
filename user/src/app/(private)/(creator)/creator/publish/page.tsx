import AuthRequiredGate from '@components/auth/auth-required-gate';
import PostPublishEntry from '@components/post/publish-entry/post-publish-entry';
import { authOptions } from '@lib/auth-options';
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';

export const metadata: Metadata = {
  title: 'Publish',
  description: 'Choose a video, photo, VR video, or article publishing flow.',
  robots: {
    index: false,
    follow: false
  }
};

export default async function PostPage() {
  const session = await getServerSession(authOptions);
  // Renders the login dialog over this URL rather than navigating to a login
  // page, so signing in continues here.
  if (!session) return <AuthRequiredGate />;

  return <PostPublishEntry />;
}
