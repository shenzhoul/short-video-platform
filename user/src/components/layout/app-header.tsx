'use client';

import MessageBell from '@components/message/message-bell';
import NotificationBell from '@components/notification/notification-bell';
import Dropdown from '@components/ui/dropdown-menu';
import SearchInput from '@components/ui/search-input';
import { IUser } from '@interfaces/user';
import { useMessageWorkspace } from '@providers/message-workspace.provider';
import { useProfile } from '@providers/profile.provider';
import Link from 'next/link';
import { ReactNode, useState } from 'react';
import {
  ClientIcon, MoreIcon, TopUpIcon, UploadIcon, WallpaperIcon
} from 'src/icons';

import UserAccountDropdown from './navigation/user-account-dropdown';

interface AppHeaderProps {
  serverUser: IUser | null;
}

/** Shared shape for the small icon-over-caption header actions. */
const ACTION_CLASSES = 'group relative flex h-12 max-lg:h-7 min-w-10.5 max-lg:min-w-0 max-lg:px-1 flex-col items-center justify-center rounded-md px-1 text-[10px] font-medium text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong)';

/**
 * The caption under a header icon.
 *
 * Drawn at every width, at 7px in the compact bar — which is what the reference
 * shows. It was hidden while the search field was `flex-1` and "Notification"
 * was wider than the fixed-width button it labelled; with the search bounded to
 * 168px and the buttons sized to their content, the whole group needs ~170px of
 * the 224px left over, so the captions fit.
 */
const ACTION_CAPTION_CLASSES = 'max-lg:text-[7px] max-lg:leading-[9px] max-lg:tracking-tight';

/**
 * The three promotional destinations.
 *
 * Declared once and rendered twice — as their own buttons from `lg` up, and as
 * rows inside the compact "More" menu below it. Two copies of the *markup* would
 * be two places to add the next entry to; one list rendered two ways is not.
 */
const PROMO_ACTIONS: Array<{ key: string; label: string; icon: ReactNode }> = [
  { key: 'top-up', label: 'Top-up', icon: <TopUpIcon className='text-xl max-lg:text-base' /> },
  { key: 'client', label: 'Client', icon: <ClientIcon className='text-2xl max-lg:text-base' /> },
  { key: 'wallpaper', label: 'Wallpaper', icon: <WallpaperIcon className='text-2xl max-lg:text-base' /> }
];

/**
 * Fixed top bar.
 *
 * Spans the width beside the left navigation and deliberately does **not**
 * shrink when the message workspace opens. The workspace begins *below* the
 * header, so there is nothing to make room for — narrowing the bar would only
 * push the search field and the header actions inward for no reason, and an
 * earlier attempt to do so moved its left edge instead (it is anchored
 * `right-0`) and let the panel cover the actions outright.
 *
 * ## Two arrangements, one bar
 *
 * From `lg` up the search field is absolutely positioned so it lands on the
 * viewport's centre line rather than the header's — that is the desktop
 * reference, and the arithmetic in those classes assumes the header starts at
 * the 160px navigation. Below `lg` that assumption is false (the rail is 56px)
 * and there is no room for a centred field anyway, so the bar becomes an
 * ordinary flex row: the search takes the space left over, and the three
 * promotional links fold into a "More" menu instead of being dropped. Every
 * action stays reachable; only its depth changes.
 */
export default function AppHeader({ serverUser }: AppHeaderProps) {
  const [moreOpen, setMoreOpen] = useState(false);
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
    <header className={`fixed right-0 top-0 flex h-(--app-header-height) items-center justify-between bg-(--header-bg) transition-colors duration-200 w-[calc(100%-var(--app-shell-nav-width))] ${headerLayer}`}>
      <div className='mr-4 max-lg:mr-0.5 ml-0 pl-0 flex-auto w-full h-full flex items-center min-w-0'>
        <div className='w-full h-full relative flex items-center flex-row flex-1 box-border justify-end max-lg:justify-between pr-0! min-w-0 max-lg:gap-1 max-lg:pl-1'>
          {/*
            Desktop: absolutely centred on the viewport.
            Compact: an ordinary flex child that keeps whatever the actions leave.
          */}
          {/*
            Desktop: absolutely centred on the viewport.

            Compact: a fixed 168px block anchored to the left of the content
            header — 38% of the 440px application width, which is the
            proportion the reference gives it. It was `flex-1`, so it ate every
            pixel the action group did not, and the bar read as one enormous
            field with the icons crushed against the right edge.
          */}
          <div className='flex transition-all duration-[0.3] flex-row items-center h-full max-lg:w-42 max-lg:shrink-0 lg:max-w-150 lg:absolute p-0 lg:right-100 lg:w-[calc((100%+32px+160px)*0.327)] lg:left-[calc(50vw-(160px+68px+calc((100%+32px+160px)*0.327))/2-20px)]'>
            <SearchInput
              variant="douyin"
              placeholder="Search for content that interests you"
              className="w-full"
              useDefaultSearch
            />
          </div>
          <div className='w-auto shrink-0 items-center'>
            <div className='float-right'>
              <div className='h-11 max-lg:h-7 flex items-center justify-end text-[14px] leading-5.5'>
                {PROMO_ACTIONS.map((action) => (
                  <Link key={action.key} href="/" aria-label={action.label} title={action.label} className={`max-lg:hidden ${ACTION_CLASSES}`}>
                    <div className='flex h-5 w-5 max-lg:h-4 max-lg:w-4 items-center justify-center'>{action.icon}</div>
                    <span className={ACTION_CAPTION_CLASSES}>{action.label}</span>
                  </Link>
                ))}

                {/*
                  The same three destinations, one level deeper, for the compact
                  bar. `max-w-[calc(100vw-24px)]` keeps the panel inside a 390px
                  viewport rather than pushing the document sideways.
                */}
                <div className='lg:hidden'>
                  <Dropdown
                    triggerMode="click"
                    position="right"
                    width={180}
                    group="app-header"
                    open={moreOpen}
                    onOpenChange={setMoreOpen}
                    menuClassName="!z-90 !rounded-xl !border-(--border-faint) !bg-(--surface-raised) !p-1.5 !shadow-(--shadow-popover) max-w-[calc(100vw-24px)]"
                    trigger={(
                      /*
                        A real button, not a span: the dropdown's own wrapper
                        only listens for a click, so a span trigger could not be
                        tabbed to and Enter/Space did nothing. `aria-expanded`
                        is why the open state is lifted here.
                      */
                      <button type="button" className={ACTION_CLASSES} aria-label="More" title="More" aria-haspopup="menu" aria-expanded={moreOpen}>
                        <div className='flex h-5 w-5 max-lg:h-4 max-lg:w-4 items-center justify-center'>
                          <MoreIcon className='text-2xl max-lg:text-base' />
                        </div>
                        <span className={ACTION_CAPTION_CLASSES}>More</span>
                      </button>
                    )}
                  >
                    <div className='flex flex-col' role="menu">
                      {PROMO_ACTIONS.map((action) => (
                        <Link
                          key={action.key}
                          href="/"
                          role="menuitem"
                          onClick={() => setMoreOpen(false)}
                          className='flex h-10 max-lg:h-8 items-center gap-2 rounded-lg px-3 max-lg:px-2 text-sm max-lg:text-[11px] font-medium text-(--text-soft) transition hover:bg-(--surface-soft) hover:text-(--text-strong) focus-visible:bg-(--surface-soft) focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--text-muted)'
                        >
                          <span className='flex h-5 w-5 max-lg:h-4 max-lg:w-4 items-center justify-center'>{action.icon}</span>
                          <span className='truncate'>{action.label}</span>
                        </Link>
                      ))}
                    </div>
                  </Dropdown>
                </div>

                <NotificationBell isLoggedIn={isLoggedIn} />
                <MessageBell isLoggedIn={isLoggedIn} />
                <Link
                  href="/creator/publish"
                  aria-label="Upload"
                  title="Upload"
                  className={ACTION_CLASSES}
                >
                  <span className="absolute -right-1.25 left-[calc(50%+6px)] top-px h-2 w-2 max-lg:h-1.5 max-lg:w-1.5 rounded-full bg-[#ff2f5f]" />
                  <div className='flex h-5 w-5 max-lg:h-4 max-lg:w-4 items-center justify-center'>
                    <UploadIcon className='text-2xl max-lg:text-base' />
                  </div>
                  <span className={ACTION_CAPTION_CLASSES}>Upload</span>
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
