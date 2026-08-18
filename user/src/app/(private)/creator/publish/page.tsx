import PostPublishEntry from '@components/post/publish-entry/post-publish-entry';
import { authOptions } from '@lib/auth-options';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
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
  if (!session) {
    redirect('/auth/login');
  }

  return <PostPublishEntry />;
}
