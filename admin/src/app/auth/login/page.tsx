import { Metadata } from 'next';
import { unstable_noStore as noStore } from 'next/cache';
import FormLogin from 'src/components/auth/login-form';

export const fetchCache = 'force-no-store';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Login',
    icons: {
      icon: '/logo.png'
    }
  };
}

export default async function SignIn() {
  noStore();

  return (
    <FormLogin />
  );
}
