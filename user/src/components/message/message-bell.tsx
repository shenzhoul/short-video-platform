'use client';

import Dropdown from '@components/ui/dropdown-menu';
import LoggedInWarning from '@components/ui/logged-in-warning';
import { useMessages } from '@providers/message.provider';
import { isMessagesRoute, useMessageWorkspace } from '@providers/message-workspace.provider';
import { usePathname } from 'next/navigation';
import { MessageIcon } from 'src/icons';

interface MessageBellProps {
  isLoggedIn: boolean;
}

/**
 * Header message control.
 *
 * Keeps the surrounding header item's exact look — same icon, label and classes
 * as the other header actions — and only replaces the inert link with a trigger
 * for the shared workspace plus an unread indicator.
 *
 * The indicator reuses the notification badge's markup verbatim rather than
 * inventing its own: two unrelated red dots in the same header would read as two
 * different kinds of alert, when they mean the same thing.
 *
 * Clicking never marks anything read. Only opening a specific conversation does
 * that — seeing that you have mail is not the same as having read it.
 *
 * On the dedicated messages page the click does nothing: that page already *is*
 * the full messages surface, so opening the panel beside it would show the same
 * conversations twice and needlessly narrow the page. The unread indicator still
 * renders there, because it reflects global state rather than the panel.
 */
export default function MessageBell({ isLoggedIn }: MessageBellProps) {
  const { hasUnread } = useMessages();
  const { open, toggleWorkspace } = useMessageWorkspace();
  const onMessagesPage = isMessagesRoute(usePathname());

  return (
    isLoggedIn ? (
      <button
        type="button"
        onClick={onMessagesPage ? undefined : toggleWorkspace}
        aria-expanded={onMessagesPage ? undefined : open}
        aria-current={onMessagesPage ? 'page' : undefined}
        aria-label="Messages"
        className={`group relative flex h-12 min-w-10.5 flex-col items-center justify-center rounded-md px-1 text-[10px] font-medium transition ${onMessagesPage
          ? 'cursor-default text-(--text-strong)'
          : 'cursor-pointer text-(--text-soft) hover:bg-(--hover-bg) hover:text-(--text-strong)'
          }`}
      >
        {hasUnread ? (
          <span
            aria-hidden="true"
            className="absolute -right-1.25 left-[calc(50%+6px)] top-px h-2 w-2 rounded-full bg-[#ff2f5f]"
          />
        ) : null}
        <div className="flex h-5 w-5 items-center justify-center">
          <MessageIcon className="text-2xl" />
        </div>
        <span>Message</span>
      </button>
    ) : (
      <Dropdown
        triggerMode="hover"
        position="center"
        width={300}
        menuClassName="!z-90 !rounded-xl !border-(--border-faint) !bg-(--surface-raised) !p-0 !shadow-(--shadow-popover) max-w-[calc(100vw-24px)]"
        trigger={(
          <span className="group relative flex h-12 min-w-10.5 flex-col items-center justify-center rounded-md px-1 text-[10px] font-medium text-(--text-soft) transition hover:bg-(--hover-bg) hover:text-(--text-strong)">
            <div className="flex h-5 w-5 items-center justify-center">
              <MessageIcon className="text-2xl" />
            </div>
            <span>Message</span>
          </span>
        )}
      >
        <LoggedInWarning type="message" />
      </Dropdown>
    )
  );
}
