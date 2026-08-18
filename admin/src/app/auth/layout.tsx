import { Layout } from '@lib/antd';
import React from 'react';
import { ProfileContextProvider } from 'src/context/profile.context';
import Footer from 'src/layout/footer';

export default async function AuthLayout({
  children // will be a page or nested layout
}: {
  children: React.ReactNode
}) {
  return (
    <ProfileContextProvider>
      <Layout className="layout-default login-form" style={{ height: '100vh', marginLeft: '0' }}>
        <div className="signin">
          {children}
          <Footer />
        </div>
      </Layout>
    </ProfileContextProvider>
  );
}
