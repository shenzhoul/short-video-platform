'use client';

import { authService } from '@services/auth.service';
import { Button, Typography } from 'antd';
import { useSearchParams } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';

const { Title, Text } = Typography;

export default function Logout() {
  const [loggedOut, setLoggedOut] = useState(false);
  const searchParams = useSearchParams();
  const redirectToLogin = searchParams?.get('redirect') === 'login';

  useEffect(() => {
    const logout = async () => {
      await signOut({ redirect: false });
      authService.removeToken();
      setLoggedOut(true);
    };

    logout();
  }, []);

  useEffect(() => {
    if (loggedOut && redirectToLogin) {
      window.location.href = '/auth/login';
    }
  }, [loggedOut, redirectToLogin]);

  if (!loggedOut) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Text>Logging out...</Text>
      </div>
    );
  }

  if (redirectToLogin) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Text>Redirecting to login...</Text>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh'
      }}
    >
      <Title level={2}>You have been logged out</Title>
      <Text>Please log in again to continue.</Text>
      <br />
      <Button
        type="primary"
        style={{ marginTop: '10px' }}
        onClick={() => window.location.href = '/auth/login'}
      >
        Login Again
      </Button>
    </div>
  );
}
