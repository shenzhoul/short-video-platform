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
    /*
      The same shell arrangement as `MainThemeLayout`, for the same reason: the
      header and the content column both subtract `--app-shell-nav-width`, so
      the rail has to be present and that wide at every viewport. Hiding it
      below `lg` — which is what this did — would leave the creator screens with
      an empty gutter where the navigation used to be.
    */
    <div className="xl:min-h-screen bg-(--page-bg) flex flex-col overflow-hidden max-xl:h-(--app-viewport-height)">
      <div className={`min-h-0 flex gap-0 flex-1 ${serverUser ? 'xl:overflow-y-auto' : ''}`}>
        <div className="relative">
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
