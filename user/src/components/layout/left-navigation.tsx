/**
 * LeftNavigation Component
 *
 * A comprehensive sidebar navigation component that displays different menu items
 * based on user authentication status and user type (Creator vs Fan vs Guest).
 *
 * @example
 * // Server-side usage in layout
 * const session = await getServerSession(authOptions);
 * <LeftNavigation serverUser={session?.user || null} />
 *
 * Features:
 * - Server-side session detection for proper SSR
 * - Client-side state sync with server-side initial state
 * - User profile display with avatar and name
 * - Dynamic menu based on user type (Creator/Fan/Guest)
 * - Balance display and management
 * - Navigation with active state handling
 * - Proper logout with API call and error handling
 * - Responsive design with overflow handling
 * - Dynamic imports for better code splitting
 * - Optimized rendering with memo and lazy loading
 */

'use client';

import SidebarBottom from '@components/layout/sidebar-bottom';
import { useLogout } from '@hooks/use-logout';
import { IUser } from '@interfaces/user';
import { useProfile } from '@providers/profile.provider';
import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { DouyinFavicon } from 'src/icons';

import Logo from './logo';
import DashboardMenu from './navigation/user-menu';

interface LeftNavigationProps {
  serverUser: IUser | null;
}

export function LeftNavigation({ serverUser }: LeftNavigationProps) {
  const { current: clientUser, fetching } = useProfile();

  // While fetching, prefer serverUser. After load, prefer clientUser if it exists
  const user = fetching ? (serverUser || clientUser) : (clientUser || serverUser);
  // Signs out through the shared hook: a real revoke, then `replace('/')` and
  // `refresh()`. It used to navigate to `/auth/logout`, a page that existed only
  // to show a confirmation screen and that Back could return to.
  const { logout } = useLogout();
  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  const menuProps = useMemo(
    () => ({
      user,
      onLogout: handleLogout
    }),
    [user, handleLogout]
  );

  return (
    <>
      {/*
        The spacer that reserves the rail's column in the flex row.

        Present at every width now. It used to be `max-xl:hidden`, while the
        fixed rail below it appeared from `lg` — so between 1024px and 1280px
        the rail was drawn over the page with nothing holding a column open for
        it. Both read `--app-shell-nav-width`, so they cannot drift again.
      */}
      <div className='w-(--app-shell-nav-width) h-full shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none' />
      <div data-app-nav-rail className='fixed left-0 top-0 flex h-(--app-viewport-height) w-(--app-shell-nav-width) flex-col bg-(--page-bg) text-(--text-strong) transition-[width] duration-200 ease-out motion-reduce:transition-none z-99'>
        {/*
          The full wordmark needs room the compact rail does not have, so below
          `lg` it is replaced by the app icon rather than dropped — the rail must
          still lead back to the home feed.
        */}
        <div className='max-lg:hidden flex justify-center'><Logo /></div>
        <div className='max-lg:hidden flex justify-center'><img src="/get_app_hover.png" alt="Get App" width={128} /></div>
        <Link
          href="/"
          aria-label="Get the app"
          title="Get APP"
          className='lg:hidden mx-auto mt-1.5 flex h-8 w-9 shrink-0 flex-col items-center justify-center gap-px rounded-lg bg-[#fe2c55] text-[7px] font-semibold leading-none text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55]'
        >
          <DouyinFavicon className='text-[13px]' />
          <span>Get APP</span>
        </Link>
        <div className='p-2 overflow-hidden overflow-y-auto scrollbar-custom
          max-lg:p-0 h-full min-h-0 flex flex-col justify-between'
        >
          {/* Navigation Menu */}
          <div className="flex-1 flex flex-col gap-2.5 pt-1 lg:pl-2.5 lg:pr-2.5 max-lg:gap-0.5 max-lg:px-0.5 max-lg:pt-0">
            <DashboardMenu onLogout={menuProps.onLogout} serverUser={menuProps.user} />
          </div>
          <SidebarBottom />
        </div>
      </div>
    </>
  );
}

export default LeftNavigation;
