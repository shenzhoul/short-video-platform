import LoginForm from '@components/auth/login-form';
import { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Login',
    description: 'Sign in to your account to access exclusive content, live streams, and premium features.',
    keywords: 'login, sign in, account access, user authentication',
    robots: {
      index: false,
      follow: false
    }
  };
}

export default async function Login() {
  return (
    <LoginForm />
  );
}
