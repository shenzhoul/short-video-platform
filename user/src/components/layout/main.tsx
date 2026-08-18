/**
 * MainThemeLayout Component
 *
 * The main layout wrapper that provides the overall page structure with header,
 * content area, and footer. Handles proper spacing and background styling.
 *
 * @example
 * // Basic usage wrapping page content
 * <MainThemeLayout>
 *   <YourPageContent />
 * </MainThemeLayout>
 *
 * Features:
 * - Server-side session detection for proper user state
 * - Fixed header with proper top padding compensation
 * - Full-height content area with minimum height
 * - Responsive layout structure
 */

import { getServerAuth } from '@lib/server-auth';

import AppHeader from './app-header';
import LeftNavigation from './left-navigation';
import MainPageSession from './main-page';

interface Layout {
  children: React.ReactNode;
}

export default async function MainThemeLayout({ children }: Layout) {
  const { user: serverUser } = await getServerAuth();

  return (
    <div className="min-h-screen bg-(--page-bg) xl:flex flex-col xl:overflow-hidden">
      <div className={`xl:flex max-lg:flex-col gap-0 flex-1 ${serverUser ? 'max-xl:pb-[calc(84px+env(safe-area-inset-bottom))] xl:overflow-y-auto' : ''}`}>
        <div className="relative max-lg:hidden">
          <LeftNavigation serverUser={serverUser} />
        </div>
        <MainPageSession>
          <AppHeader serverUser={serverUser} />
          {children}
        </MainPageSession>
      </div>
    </div>
  );
}
