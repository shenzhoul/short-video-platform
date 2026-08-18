import { AdminManagement } from '@components/user';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin Management',
  description: 'Manage admin permissions and accounts. Only accessible to superadmin users.',
  keywords: 'admin, permissions, superadmin, user management'
};

export default function AdminManagementPage() {
  return <AdminManagement />;
}
