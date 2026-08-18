import './globals.css';
import 'react-toastify/dist/ReactToastify.css';
import './main.css';
import './responsive.css';

import { AntdRegistry } from '@ant-design/nextjs-registry';
import { SharedToastProvider } from '@douyin-clone/shared-toast';
import { authOptions } from '@lib/auth-options';
import { ReactQueryProvider } from '@providers/react-query-provider';
import SessionProvider from '@providers/session.provider';
import { ThemeProvider } from '@providers/theme-provider';
import { settingService } from '@services/setting.service';
import { App as AntdApp, ConfigProvider } from 'antd';
import type { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import React from 'react';
import ServiceWorkerRegistration from 'src/components/service-worker-registration';
import { ConfigProvider as SiteConfigProvider } from 'src/context/config.context';
import { IPublicSetting } from 'src/interfaces';

// Force dynamic rendering to avoid build-time API calls
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const {
    data: settings = {
      siteName: 'douyin-clone',
      logoUrl: '',
      favicon: '/favicon.ico'
    } as IPublicSetting
  } = await settingService.getPublicSettings();

  const favicon = settings['site.identity.faviconUrl'] || settings.favicon || '/favicon.ico';

  return {
    title: {
      default: `${settings['site.identity.name']} | Admin Dashboard`,
      template: `%s | ${settings['site.identity.name']} | Admin Dashboard`
    },
    description: '',
    keywords: '',
    icons: {
      icon: favicon,
      shortcut: favicon,
      apple: favicon
    }
  };
}

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const [settings, session] = await Promise.all([
    settingService.getPublicSettings(),
    getServerSession(authOptions)
  ]);

  const settingsData = settings.data || {
    siteName: 'Douyin-Clone',
    logoUrl: '',
    favicon: '/favicon.ico'
  } as IPublicSetting;

  const favicon = settingsData['site.identity.faviconUrl'] || settingsData.favicon || '/favicon.ico';

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {favicon ? <link rel="icon" type="image/x-icon" href={favicon} /> : null}
      </head>
      <body>
        <AntdRegistry hashPriority="high">
          <ConfigProvider
            pagination={{ showSizeChanger: false }}
            theme={{
              cssVar: {
                key: 'douyin-admin'
              },
              token: {
                colorPrimary: '#1890ff',
                colorInfo: '#1890ff',
                colorLink: '#1890ff'
              },
              hashed: false
            }}
          >
            <ReactQueryProvider>
              <SiteConfigProvider
                settings={{
                  ...settingsData
                }}
              >
                <ThemeProvider>
                  <AntdApp>
                    <SessionProvider session={session}>
                      {children}
                      <SharedToastProvider theme="auto" />
                    </SessionProvider>
                  </AntdApp>
                </ThemeProvider>
              </SiteConfigProvider>
            </ReactQueryProvider>
          </ConfigProvider>
        </AntdRegistry>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
