import AuthRequiredGate from '@components/auth/auth-required-gate';
import CreatorPostsClient from '@components/creator/manage/creator-posts-client';
import { authOptions } from '@lib/auth-options';
import { Metadata } from 'next';
import { getServerSession } from 'next-auth';

export const metadata: Metadata = {
  title: 'Posts',
  description: 'Manage the posts you have published.',
  robots: {
    index: false,
    follow: false
  }
};

export default async function CreatorPostsPage() {
  const session = await getServerSession(authOptions);
  if (!session) return <AuthRequiredGate />;

  return <CreatorPostsClient />;
}
