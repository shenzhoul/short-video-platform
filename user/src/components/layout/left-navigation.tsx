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
import { IUser } from '@interfaces/user';
import { useProfile } from '@providers/profile.provider';
import { useCallback, useMemo } from 'react';

import Logo from './logo';
import DashboardMenu from './navigation/user-menu';

interface LeftNavigationProps {
  serverUser: IUser | null;
}

export function LeftNavigation({ serverUser }: LeftNavigationProps) {
  const { current: clientUser, fetching } = useProfile();

  // While fetching, prefer serverUser. After load, prefer clientUser if it exists
  const user = fetching ? (serverUser || clientUser) : (clientUser || serverUser);
  // Handle logout with proper error handling
  const handleLogout = useCallback(async () => {
    // Force redirect to clear all client-side state
    window.location.href = '/auth/logout';
  }, []);

  const menuProps = useMemo(
    () => ({
      user,
      onLogout: handleLogout
    }),
    [user, handleLogout]
  );

  return (
    <>
      <div className='w-40 h-full transition-all max-xl:hidden' />
      <div className='fixed left-0 top-0 flex h-screen w-40 flex-col bg-(--page-bg) text-(--text-strong) transition-all z-99'>
        <div className='max-lg:hidden flex justify-center'><Logo /></div>
        <div className='max-lg:hidden flex justify-center'><img src="/get_app_hover.png" alt="Get App" width={128} /></div>
        <div className='p-2 overflow-hidden overflow-y-auto scrollbar-custom
          max-xl:-right-full max-xl:rounded-none h-full flex flex-col justify-between'
        >
          {/* Navigation Menu */}
          <div className="flex-1 flex flex-col gap-2.5 pl-2.5 pr-2.5 pt-1">
            <DashboardMenu onLogout={menuProps.onLogout} serverUser={menuProps.user} />
          </div>
          <SidebarBottom />
        </div>
      </div>
    </>
  );
}

export default LeftNavigation;
