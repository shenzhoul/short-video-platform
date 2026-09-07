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
    /*
      One shell at every width.
      ------------------------
      This used to be a desktop layout with the navigation simply removed below
      `lg` — the rail was `max-lg:hidden`, the row was `xl:flex`, and a phone got
      a full-bleed content column with no navigation at all plus 84px of bottom
      padding reserving room for a bottom bar that does not exist in this app.

      Now the rail is always present and always beside the content; only its
      width changes, and it changes through `--app-shell-nav-width` so the rail,
      its spacer, the header and the content column cannot disagree. Below `xl`
      the shell is pinned to the real viewport height and scrolls internally,
      which is what lets a feed, a detail panel and a message panel each own
      their own scroller instead of growing the document.
    */
    <div className="min-h-screen bg-(--page-bg) flex flex-col overflow-hidden max-xl:h-(--app-viewport-height)">
      <div className={`flex gap-0 flex-1 max-xl:min-h-0 ${serverUser ? 'xl:overflow-y-auto' : ''}`}>
        <div className="relative">
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
