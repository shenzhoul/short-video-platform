import { Metadata } from 'next';
import { unstable_noStore as noStore } from 'next/cache';
import FormForgot from 'src/components/auth/forgot';

export const fetchCache = 'force-no-store';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Forgot Password',
    icons: {
      icon: '/logo.png'
    }
  };
}

export default async function Forgot() {
  // this is v14, In version 15, we recommend using connection instead of unstable_noStore.
  noStore();

  return (
    <FormForgot />
  );
}
