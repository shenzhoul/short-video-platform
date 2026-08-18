import Logout from '@components/auth/logout';
import { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Logged Out'
  };
}

export default function LogoutPage() {
  return <Logout />;
}
