import { UserList } from '@components/user';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'User Management',
  description: 'Manage user accounts, view user profiles, roles, and account status. Monitor user activity and manage permissions.',
  keywords: 'users, user management, accounts, roles, permissions, admin'
};

export default function Users() {
  return <UserList />;
}
