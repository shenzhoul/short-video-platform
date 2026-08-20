'use client';

import { useMessages } from '@providers/message.provider';
import { useMessageWorkspace } from '@providers/message-workspace.provider';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect } from 'react';

import ConversationList from './conversation-list';
import MessageThreadPanel from './message-thread-panel';

/**
 * Two-column messages page: conversations on the left, the open thread on the
 * right.
 *
 * Shares the conversation list, thread, bubbles and composer with the sidebar —
 * only the arrangement differs. That is what keeps the two surfaces honest with
 * each other: reading a conversation here clears the same unread state the
 * sidebar shows, because there is only one of it.
 */
function MessagesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getConversation } = useMessages();
  const { closeWorkspace } = useMessageWorkspace();

  // The selected conversation lives in the URL rather than in component state,
  // so the sidebar's "open full page" link can carry the thread across, and so
  // a reload or a shared link lands on the same conversation.
  const selectedId = searchParams.get('conversation');

  // Arriving on the dedicated page makes the floating panel redundant, and
  // leaving it open would show the same conversation twice.
  useEffect(() => {
    closeWorkspace();
  }, [closeWorkspace]);

  const handleSelect = useCallback((conversationId: string) => {
    router.replace(`/messages?conversation=${conversationId}`, { scroll: false });
  }, [router]);

  const conversation = selectedId ? getConversation(selectedId) : undefined;
  const participant = conversation?.participant;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside
        aria-label="Conversations"
        className="flex w-75 shrink-0 flex-col border-r border-(--border-faint) bg-(--surface)"
      >
        <div className="flex h-14 shrink-0 items-center px-4">
          <h1 className="text-[16px] font-medium text-(--text-strong)">Messages</h1>
        </div>
        <div className="min-h-0 flex-1">
          <ConversationList
            density="comfortable"
            selectedConversationId={selectedId}
            onSelect={handleSelect}
          />
        </div>
      </aside>

      <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col bg-(--surface)">
        {selectedId ? (
          <MessageThreadPanel
            key={selectedId}
            conversationId={selectedId}
            header={(
              <div className="flex h-14 shrink-0 items-center gap-3 border-b border-(--border-faint) px-5">
                <img
                  src={participant?.avatar || '/no_avatar.jpeg'}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
                <span className="min-w-0 truncate text-[15px] font-medium text-(--text-strong)">
                  {participant?.name || participant?.username || 'Conversation'}
                </span>
              </div>
            )}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-[14px] font-medium text-(--text-soft)">Select a conversation</p>
            <p className="text-[13px] text-(--text-faint)">
              Choose someone on the left to read and reply.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

export default function MessagesPageClient() {
  // `useSearchParams` needs a Suspense boundary to avoid opting the whole route
  // into client-side rendering at build time.
  return (
    <Suspense fallback={<div className="min-h-0 flex-1" />}>
      <MessagesPageContent />
    </Suspense>
  );
}
