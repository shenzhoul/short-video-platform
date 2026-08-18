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
      width={isLoggedIn ? 328 : 300}
      menuClassName="!z-90 !rounded-xl !border-(--border-faint) !bg-(--surface-raised) !p-0 !shadow-(--shadow-popover) max-w-[calc(100vw-24px)]"
      trigger={(
        <span className="group relative flex h-12 min-w-10.5 flex-col items-center justify-center rounded-md px-1 text-[10px] font-medium text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong)">
          {unreadCount > 0 && <span className="absolute -right-1.25 left-[calc(50%+6px)] top-px h-2 w-2 rounded-full bg-[#ff2f5f]" />}
          <div className="flex h-5 w-5 items-center justify-center">
            <NotificationIcon className="text-2xl" />
          </div>
          <span>Notification</span>
        </span>
      )}
    >
      {isLoggedIn ? <NotificationPanel onNavigate={() => setOpen(false)} /> : <LoggedInWarning />}
    </Dropdown>
  );
}
