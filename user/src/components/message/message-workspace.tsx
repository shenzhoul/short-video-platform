'use client';

import { useMessages } from '@providers/message.provider';
import {
  MESSAGE_WORKSPACE_WIDTH,
  useMessageWorkspace
} from '@providers/message-workspace.provider';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { FiChevronLeft, FiExternalLink, FiX } from 'react-icons/fi';

import ConversationList from './conversation-list';
import MessageThreadPanel from './message-thread-panel';

/**
 * Right-side message workspace.
 *
 * A layout column, not a dropdown and not a modal. It is mounted once at the
 * application shell and every entry point — the header icon, the post-detail
 * button — opens this same instance, so there is never a second copy holding
 * divergent state.
 *
 * Two placements, chosen by available width rather than by which page is open:
 * on a wide viewport it takes its own column and the page content reflows
 * around it; on a narrow one there is nothing left to give it, so it floats
 * above the content with a scrim instead of squeezing the page into something
 * unusable.
 */
export default function MessageWorkspace() {
  const { status } = useSession();
  const {
    open, view, activeConversationId, inline, placement,
    closeWorkspace, openConversation, backToList
  } = useMessageWorkspace();
  const { getConversation } = useMessages();

  // Nothing to show a signed-out visitor: every conversation is private.
  if (status !== 'authenticated' || !open) return null;

  // Beside an ordinary page the header stays visible above the panel; beside a
  // surface that already covers the header, the panel runs to the very top so
  // the header cannot show through in the strip next to it.
  const topClass = placement === 'fullscreen' ? 'top-0' : 'top-(--app-header-height)';

  const conversation = activeConversationId ? getConversation(activeConversationId) : undefined;
  const participant = conversation?.participant;
  const inThread = view === 'thread' && Boolean(activeConversationId);

  const closeButton = (
    <button
      type="button"
      onClick={closeWorkspace}
      aria-label="Close messages"
      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[17px] text-(--text-muted) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
    >
      <FiX aria-hidden="true" className='text-[18px]' />
    </button>
  );

  const openPageLink = (
    <Link
      href={activeConversationId ? `/messages?conversation=${activeConversationId}` : '/messages'}
      onClick={closeWorkspace}
      aria-label="Open messages page"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[15px] text-(--text-muted) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
    >
      <FiExternalLink aria-hidden="true" className='text-[16px]' />
    </Link>
  );

  return (
    <>
      {/* Only an overlay needs a scrim; an inline column is part of the page. */}
      {!inline ? (
        <button
          type="button"
          aria-label="Close messages"
          onClick={closeWorkspace}
          className={`fixed inset-x-0 bottom-0 z-125 cursor-default bg-black/40 ${topClass}`}
        />
      ) : null}

      {/*
        Starts below the header, not at the top of the viewport.

        The header spans the full width and stays completely visible while
        messages are open — search, the header actions and the avatar all remain
        reachable. Anchoring to the header's height rather than to `top-0` is
        what keeps the panel beside the page content instead of on top of the
        chrome above it.
      */}
      <aside
        aria-label="Messages"
        style={{ width: inline ? MESSAGE_WORKSPACE_WIDTH : undefined }}
        className={`fixed bottom-0 right-0 z-126 flex flex-col ${topClass} ${inline ? '' : 'w-full max-w-100 shadow-(--shadow-popover)'
          }`}
      >
        <div className={`${topClass} z-3 w-89 ${placement === 'fullscreen' ? 'h-full' : 'h-[calc(100vh-56px)]'} transition-transform duration-200 fixed right-0 translate-x-0`}>
          <div className={`bg-(--surface-raised) ${placement === 'fullscreen' ? 'ml-0 w-full h-full' : 'ml-2 rounded-2xl w-[calc(100%-20px)] h-[calc(100%-12px)] static'}`}>
            <div className='w-full h-full'>
              {inThread ? (
                <MessageThreadPanel
                  conversationId={activeConversationId as string}
                  header={(
                    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-(--border-faint) px-3">
                      <button
                        type="button"
                        onClick={backToList}
                        aria-label="Back to conversations"
                        className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[18px] text-(--text-muted) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
                      >
                        <FiChevronLeft aria-hidden="true" />
                      </button>
                      <img
                        src={participant?.avatar || '/no_avatar.jpeg'}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-full object-cover"
                      />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-(--text-strong)">
                        {participant?.name || participant?.username || 'Conversation'}
                      </span>
                      {openPageLink}
                      {closeButton}
                    </div>
                  )}
                />
              ) : (
                <>
                  <div className="flex h-14 shrink-0 items-center gap-2 px-4 border-b border-(--border-faint)">
                    <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-(--text-strong)">
                      Messages
                    </span>
                    {openPageLink}
                    {closeButton}
                  </div>
                  <div className="min-h-0 flex-1 mt-2.5">
                    <ConversationList
                      selectedConversationId={activeConversationId}
                      onSelect={openConversation}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

      </aside>
    </>
  );
}
