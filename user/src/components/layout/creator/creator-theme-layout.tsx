/**
 * CreatorThemeLayout
 *
 * Page shell for Creator Management. Structurally identical to `MainThemeLayout` but with the
 * creator sidebar in place of the Home one, so publishing and managing content never shows the
 * viewer-facing menu.
 *
 * Creator Center uses the wider 200px management rail from the reference. The shared header and
 * main session receive that width explicitly, while viewer-facing layouts keep their 160px rail.
 */

import AppHeader from '@components/layout/app-header';
import MainPageSession from '@components/layout/main-page';
import { getServerAuth } from '@lib/server-auth';

import CreatorNavigation from './creator-navigation';

interface Layout {
  children: React.ReactNode;
}

export default async function CreatorThemeLayout({ children }: Layout) {
  const { user: serverUser } = await getServerAuth();

  return (
    <div className="min-h-screen bg-(--page-bg) xl:flex flex-col xl:overflow-hidden">
      <div className={`min-h-0 xl:flex max-lg:flex-col gap-0 flex-1 ${serverUser ? 'max-xl:pb-[calc(84px+env(safe-area-inset-bottom))] xl:overflow-y-auto' : ''}`}>
        <div className="relative max-lg:hidden">
          <CreatorNavigation />
        </div>
        <MainPageSession>
          <AppHeader serverUser={serverUser} />
          {children}
        </MainPageSession>
      </div>
    </div>
  );
}
