import './globals.css';
import 'react-toastify/dist/ReactToastify.css';

import NotificationToaster from '@components/notification/notification-toast';
import ServiceWorkerRegistration from '@components/service-worker-registration';
import { SharedToastProvider } from '@douyin-clone/shared-toast';
import { authOptions } from '@lib/auth-options';
import { LeftMenuProvider } from '@providers/left-menu.provider';
import { MainLayoutProvider } from '@providers/main-layout.provider';
import { NotificationProvider } from '@providers/notification.provider';
import { ProfileProvider } from '@providers/profile.provider';
import ReactQueryProvider from '@providers/react-query.provider';
import SessionProvider from '@providers/session.provider';
import ThemeProvider from '@providers/ThemeProvider';
import { getSettingsByKeys } from '@services/setting.service';
import parse from 'html-react-parser';
import { Metadata } from 'next';
import { getServerSession } from 'next-auth';
import { SocketProvider } from 'src/socket';

export async function generateMetadata(): Promise<Metadata> {
  // Only fetch site name for root layout metadata template
  const metaSettings = await getSettingsByKeys([
    'site.identity.name',
    'site.identity.faviconUrl'
  ]);

  const siteName = metaSettings['site.identity.name'] || 'Douyin-clone';
  // Path to your favicon file in the public or app directory
  const faviconUrl = metaSettings['site.identity.faviconUrl'] || '/favicon.ico';

  return {
    ...(process.env.BASE_URL && { metadataBase: new URL(process.env.BASE_URL) }),
    title: {
      default: siteName,
      template: `%s | ${siteName}`
    },
    icons: {
      icon: faviconUrl
    }
  };
}

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // Fetch all settings and menu data needed by layout and child components
  const [allSettings, session] = await Promise.all([
    getSettingsByKeys([
      'site.maintenance.enabled', // For global maintenance mode check
      // Layout specific settings (used directly in layout)
      'site.identity.name',
      'site.identity.logoUrl',
      'site.identity.whiteLogoUrl',
      'site.identity.faviconUrl'
    ]),
    getServerSession(authOptions)
  ]);

  const providerSettings: Record<string, any> = {
    siteName: allSettings['site.identity.name'] || 'Douyin-clone',
    logoUrl: allSettings['site.identity.logoUrl'] || '',
    logoWhite: allSettings['site.identity.whiteLogoUrl'] || ''
  };

  if (allSettings['site.maintenance.enabled']) {
    // If maintenance mode is enabled, render maintenance page only
    return (
      <html data-scroll-behavior="smooth" data-theme="light" lang="en" suppressHydrationWarning>
        <head>
          {allSettings['site.identity.faviconUrl'] ? <link rel="icon" type="image/x-icon" href={allSettings['site.identity.faviconUrl']} /> : null}
          {allSettings['site.customization.headerScript'] ? parse(allSettings['site.customization.headerScript']) : null}
        </head>
        <body>
          <main className="min-h-screen flex items-center justify-center p-4">
            <div className="max-w-md text-center">
              <h1 className="text-4xl font-bold mb-4">We&apos;ll be back soon!</h1>
              <p className="text-lg opacity-70">Our site is currently undergoing scheduled maintenance. Thank you for your patience.</p>
            </div>
          </main>
          {allSettings['site.customization.afterBodyScript'] ? parse(allSettings['site.customization.afterBodyScript']) : null}
        </body>
      </html>
    );
  }

  return (
    <html data-scroll-behavior="smooth" data-theme="light" lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <SessionProvider session={session}>
            <SocketProvider>
              <ReactQueryProvider>
                <ProfileProvider>
                  <NotificationProvider>
                    <LeftMenuProvider>
                      <MainLayoutProvider settings={providerSettings}>
                        <div id="main-content">
                          {children}
                        </div>
                      </MainLayoutProvider>
                    </LeftMenuProvider>
                    {/* Inside the provider so it reads the same realtime queue
                        the panel and bell badge do. */}
                    <NotificationToaster />
                  </NotificationProvider>
                </ProfileProvider>
              </ReactQueryProvider>
            </SocketProvider>
          </SessionProvider>
        </ThemeProvider>
        <SharedToastProvider theme="auto" />
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
