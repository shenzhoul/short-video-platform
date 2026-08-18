'use client';

import Button from '@components/ui/button';
import { clearToken } from '@services/auth.service';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';

export default function Logout() {
  const [loggedOut, setLoggedOut] = useState(false);

  useEffect(() => {
    const logout = async () => {
      await signOut({ redirect: false });
      clearToken();
      setLoggedOut(true);
    };

    logout();
  }, []);

  if (!loggedOut) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <p>Logging out...</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center border border-border rounded-2xl p-10 max-md:p-3 lg:w-[500px]">
        <h1 className="text-2xl font-bold mb-4">You have been logged out</h1>
        <p className="mb-4">Thank you for using our service.</p>
        <div className='flex gap-2 justify-center'>
          <Button href="/" variant='border'className='min-w-[130px]'>Go home</Button>
          <Button href="/auth/login">Login again</Button>
        </div>
      </div>
    </div>
  );
}
