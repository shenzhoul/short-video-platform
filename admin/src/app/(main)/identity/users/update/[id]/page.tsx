import { UserUpdateForm } from '@components/user';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Update User',
  description: 'Update user account information, profile settings, roles, and password.',
  keywords: 'update user, edit user, user management, admin'
};

export default async function UserUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return <UserUpdateForm userId={id} />;
}
