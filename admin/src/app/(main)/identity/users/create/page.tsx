import { UserCreateForm } from '@components/user';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Create New User',
  description: 'Create a new user account with profile information, roles, and account settings.',
  keywords: 'create user, new user, user management, admin'
};

export default async function UserCreatePage() {
  return <UserCreateForm />;
}
