import CreatorPostsClient from '@components/creator/manage/creator-posts-client';
import { authOptions } from '@lib/auth-options';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
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
  if (!session) {
    redirect('/auth/login');
  }

  return <CreatorPostsClient />;
}
