import PostGraphicCreateClient from '@components/post/post-graphic-create-client';
import { authOptions } from '@lib/auth-options';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';

export const metadata: Metadata = {
  title: 'Publish Graphics',
  description: 'Create a multi-image graphic post.',
  robots: { index: false, follow: false }
};

export default async function PostGraphicCreatePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/auth/login');
  return <PostGraphicCreateClient userId={session.user._id} />;
}
