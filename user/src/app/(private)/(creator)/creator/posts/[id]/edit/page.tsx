import PostEditClient from '@components/creator/manage/post-edit-client';
import { authOptions } from '@lib/auth-options';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';

export const metadata: Metadata = {
  title: 'Edit Post',
  description: 'Edit a post you have published.',
  robots: {
    index: false,
    follow: false
  }
};

interface PostEditPageProps {
  params: Promise<{ id: string }>;
}

export default async function PostEditPage({ params }: PostEditPageProps) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect('/auth/login');
  }

  const { id } = await params;
  return <PostEditClient postId={id} />;
}
