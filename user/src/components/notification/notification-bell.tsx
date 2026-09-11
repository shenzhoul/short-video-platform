'use client';

import Dropdown from '@components/ui/dropdown-menu';
import LoggedInWarning from '@components/ui/logged-in-warning';
import { useNotifications } from '@providers/notification.provider';
import { useState } from 'react';
import { NotificationIcon } from 'src/icons';

import NotificationPanel from './notification-panel';

interface IProps {
  isLoggedIn: boolean;
}

/**
 * Header notification control.
 *
 * Keeps the surrounding header item's existing look — same icon, label and
 * classes as the other header actions — and only replaces the inert link with a
 * panel trigger plus an unread badge.
 */
export default function NotificationBell({ isLoggedIn }: IProps) {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      triggerMode="hover"
      position="center"
      group="app-header"
      width={isLoggedIn ? 328 : 300}
      /*
        Compact: centred under the bell, a 328px panel started left of the bell
        and ran ~50px past the right edge of a 440px viewport. Below `lg` it is
        anchored to the viewport's right edge just under the header instead —
        the reference's placement — at the reference's width, capped against the
        rail so it can never start underneath it. `fixed` is safe: nothing
        between the header and this panel is transformed.
      */
      menuClassName="!z-90 !rounded-xl !border-(--border-faint) !bg-(--surface-raised) !p-0 !shadow-(--shadow-popover) max-w-[calc(100vw-24px)] max-lg:!fixed max-lg:!left-auto max-lg:!right-2 max-lg:!top-[calc(var(--app-header-height)+0.25rem)] max-lg:!mt-0 max-lg:!translate-x-0 max-lg:!w-[min(15rem,calc(100vw-var(--app-shell-nav-width)-1rem))] max-lg:!origin-top-right max-lg:!rounded-lg"
      trigger={(
        <span className="group relative flex h-12 max-lg:h-7 min-w-10.5 max-lg:min-w-0 max-lg:px-1 flex-col items-center justify-center rounded-md px-1 text-[10px] font-medium text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong)" aria-label="Notification" title="Notification">
          {unreadCount > 0 && <span className="absolute -right-1.25 left-[calc(50%+6px)] top-px h-2 w-2 max-lg:h-1.5 max-lg:w-1.5 rounded-full bg-[#ff2f5f]" />}
          <div className="flex h-5 w-5 max-lg:h-4 max-lg:w-4 items-center justify-center">
            <NotificationIcon className="text-2xl max-lg:text-base" />
          </div>
          <span className="max-lg:text-[7px] max-lg:leading-[9px] max-lg:tracking-tight">Notification</span>
        </span>
      )}
    >
      {isLoggedIn ? <NotificationPanel onNavigate={() => setOpen(false)} /> : <LoggedInWarning type="notification messages" />}
    </Dropdown>
  );
}
