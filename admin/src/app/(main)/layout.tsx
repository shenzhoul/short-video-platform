import Main from '@layout/main';
import React, { Suspense } from 'react';
import { MainLayoutContextProvider } from 'src/context/main-layout.context';
import { ProfileContextProvider } from 'src/context/profile.context';

export const dynamic = 'force-dynamic';

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <MainLayoutContextProvider>
      <Suspense>
        <ProfileContextProvider>
          <Main>{children}</Main>
        </ProfileContextProvider>
      </Suspense>
    </MainLayoutContextProvider>
  );
}
