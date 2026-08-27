import AuthRequiredGate from '@components/auth/auth-required-gate';
import PostCreateClient from '@components/post/post-create-client';
import { authOptions } from '@lib/auth-options';
import { Metadata } from 'next';
import { getServerSession } from 'next-auth';

export const metadata: Metadata = {
  title: 'Create Post',
  description: 'Create a new post post',
  keywords: ['post', 'create', 'post']
};

export default async function PostCreatePage() {
  const session = await getServerSession(authOptions);
  if (!session) return <AuthRequiredGate />;

  return <PostCreateClient userId={session.user._id} />;
}
