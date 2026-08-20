'use client';

import MessageBell from '@components/message/message-bell';
import NotificationBell from '@components/notification/notification-bell';
import SearchInput from '@components/ui/search-input';
import { IUser } from '@interfaces/user';
import { useMessageWorkspace } from '@providers/message-workspace.provider';
import { useProfile } from '@providers/profile.provider';
import Link from 'next/link';
import { ClientIcon, TopUpIcon, UploadIcon, WallpaperIcon } from 'src/icons';

import UserAccountDropdown from './navigation/user-account-dropdown';

interface AppHeaderProps {
  serverUser: IUser | null;
}

/**
 * Fixed top bar.
 *
 * Spans the full width beside the left navigation and deliberately does **not**
 * shrink when the message workspace opens. The workspace begins *below* the
 * header, so there is nothing to make room for — narrowing the bar would only
 * push the search field and the header actions inward for no reason, and an
 * earlier attempt to do so moved its left edge instead (it is anchored
 * `right-0`) and let the panel cover the actions outright.
 */
export default function AppHeader({ serverUser }: AppHeaderProps) {
  const { current } = useProfile();
  const { placement } = useMessageWorkspace();
  const user = current || serverUser;
  const isLoggedIn = !!user;

  /**
   * Where the bar sits in the stack.
   *
   * Above the message workspace on an ordinary page, so the bar's own popovers —
   * search suggestions, the notification panel — are not clipped by it. They are
   * children of this element, which is a stacking context, so they cannot be
   * lifted individually; the bar has to win.
   *
   * Below it again when a fullscreen surface such as post detail is open, since
   * that surface deliberately covers the header and the panel belongs to it.
   */
  const headerLayer = placement === 'fullscreen' ? 'z-80' : 'z-130';

  return (
    <header className={`fixed right-0 top-0 flex h-(--app-header-height) items-center justify-between bg-(--header-bg) transition-colors duration-200 xl:w-[calc(100%-160px)] ${headerLayer}`}>
      <div className='mr-4 ml-0 pl-0 flex-auto w-full h-full flex items-center'>
        <div className='w-full h-full relative flex items-center flex-row flex-1 box-border justify-end pr-0!'>
          <div className='flex transition-all duration-[0.3] flex-row items-center h-full max-w-150 absolute p-0 right-100 w-[calc((100%+32px+160px)*0.327)] left-[calc(50vw-(160px+68px+calc((100%+32px+160px)*0.327))/2-20px)]'>
            <SearchInput
              variant="douyin"
              placeholder="Search for content that interests you"
              className="w-full"
              useDefaultSearch
            />
          </div>
          <div className='w-auto items-center'>
            <div className='float-right'>
              <div className='h-11 flex items-center justify-end text-[14px] leading-5.5'>
                <Link
                  href="/"
                  className="group relative flex h-12 min-w-10.5 flex-col items-center justify-center rounded-md px-1 text-[10px] font-medium text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
                >
                  <div className='flex h-5 w-5 items-center justify-center'>
                    <TopUpIcon className='text-xl' />
                  </div>
                  <span>Top-up</span>
                </Link>
                <Link
                  href="/"
                  className="group relative flex h-12 min-w-10.5 flex-col items-center justify-center rounded-md px-1 text-[10px] font-medium text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
                >
                  <div className='flex h-5 w-5 items-center justify-center'>
                    <ClientIcon className='text-2xl' />
                  </div>
                  <span>Client</span>
                </Link>
                <Link
                  href="/"
                  className="group relative flex h-12 min-w-10.5 flex-col items-center justify-center rounded-md px-1 text-[10px] font-medium text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
                >
                  <div className='flex h-5 w-5 items-center justify-center'>
                    <WallpaperIcon className='text-2xl' />
                  </div>
                  <span>Wallpaper</span>
                </Link>
                <NotificationBell isLoggedIn={isLoggedIn} />
                <MessageBell isLoggedIn={isLoggedIn} />
                <Link
                  href="/creator/publish"
                  className="group relative flex h-12 min-w-10.5 flex-col items-center justify-center rounded-md px-1 text-[10px] font-medium text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
                >
                  <span className="absolute -right-1.25 left-[calc(50%+6px)] top-px h-2 w-2 rounded-full bg-[#ff2f5f]" />
                  <div className='flex h-5 w-5 items-center justify-center'>
                    <UploadIcon className='text-2xl' />
                  </div>
                  <span>Upload</span>
                </Link>

                <UserAccountDropdown loggedIn={isLoggedIn} user={user} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
