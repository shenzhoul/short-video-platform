'use client';

import { useMessages } from '@providers/message.provider';
import { useEffect, useRef, useState } from 'react';
import { FiSearch } from 'react-icons/fi';

import ConversationRow from './conversation-row';

interface ConversationListProps {
  selectedConversationId?: string | null;
  onSelect: (conversationId: string) => void;
  density?: 'compact' | 'comfortable';
}

/** How long typing settles before a search runs. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Searchable conversation list, shared by the sidebar and the full page.
 *
 * The two surfaces differ only in row density, so they share this component
 * rather than each maintaining their own list — which is also what guarantees
 * they show the same rows in the same order from the same state.
 */
export default function ConversationList({
  selectedConversationId,
  onSelect,
  density = 'compact'
}: ConversationListProps) {
  const {
    conversations, loading, loadingMore, error, hasMore,
    ensureLoaded, loadMore, retry, setKeyword
  } = useMessages();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  // Debounced so typing a name does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setKeyword(draft.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `setKeyword` is stable; depending on it would re-run the search on every
    // list change and fight the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node || loadingMore || !hasMore) return;
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 120) loadMore();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pb-2 pt-1">
        <div className="flex h-9 items-center gap-2 rounded-lg bg-(--field-bg) px-3">
          <FiSearch aria-hidden="true" className="shrink-0 text-[15px] text-(--text-faint)" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search"
            aria-label="Search conversations"
            className="h-full w-full bg-transparent text-[13px] text-(--text-strong) outline-none placeholder:text-(--text-faint)"
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain message-scrollbar"
      >
        {loading && conversations.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-(--border) border-t-(--text-muted)" />
          </div>
        ) : null}

        {error && conversations.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[13px] text-(--text-muted)">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 cursor-pointer text-[13px] font-semibold text-(--text-strong) hover:underline"
            >
              Try again
            </button>
          </div>
        ) : null}

        {!loading && !error && conversations.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-[13px] font-medium text-(--text-soft)">No conversations yet</p>
            <p className="mt-1 text-[12px] text-(--text-faint)">
              Message a creator from their profile to start one.
            </p>
          </div>
        ) : null}

        {conversations.map((conversation) => (
          <ConversationRow
            key={conversation._id}
            conversation={conversation}
            density={density}
            selected={conversation._id === selectedConversationId}
            onSelect={onSelect}
          />
        ))}

        {loadingMore ? (
          <div className="flex h-12 items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-(--border) border-t-(--text-muted)" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
