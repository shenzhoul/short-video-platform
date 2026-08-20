'use client';

import type { IConversation, IMessage, IPendingMessage } from '@interfaces/message';
import { MESSAGE_TYPE } from '@interfaces/message';
import { formatDateNoTime } from '@lib/date';
import { useMessages } from '@providers/message.provider';
import {
  useEffect, useLayoutEffect, useMemo, useRef
} from 'react';

import type { UseMessageThreadResult } from '../../hooks/use-message-thread';
import MessageBubble from './message-bubble';

interface MessageThreadViewProps {
  conversation?: IConversation;
  thread: UseMessageThreadResult;
}

type ThreadRow =
  | { kind: 'separator'; key: string; label: string }
  | { kind: 'message'; key: string; message: IMessage; }
  | { kind: 'pending'; key: string; message: IPendingMessage };

/**
 * Day label between two messages.
 *
 * A separator only appears when the day actually changes, so a burst of
 * messages in one sitting reads as one block rather than being chopped up.
 */
function dayKey(value: string): string {
  return new Date(value).toDateString();
}

function dayLabel(value: string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return formatDateNoTime(date, 'MMM D, YYYY');
}

function buildRows(messages: IMessage[], pending: IPendingMessage[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let lastDay = '';

  messages.forEach((message) => {
    const key = dayKey(message.createdAt);
    if (key !== lastDay) {
      rows.push({ kind: 'separator', key: `sep-${key}`, label: dayLabel(message.createdAt) });
      lastDay = key;
    }
    rows.push({ kind: 'message', key: message._id, message });
  });

  pending.forEach((message) => {
    const key = dayKey(message.createdAt);
    if (key !== lastDay) {
      rows.push({ kind: 'separator', key: `sep-${key}`, label: dayLabel(message.createdAt) });
      lastDay = key;
    }
    rows.push({ kind: 'pending', key: message.localId, message });
  });

  return rows;
}

/**
 * Scrollable message history.
 *
 * Two scroll behaviours, and they are different on purpose:
 *
 * - new activity at the bottom pins the view to the newest message, which is
 *   what a chat should do;
 * - loading older messages at the top preserves the reader's position by
 *   restoring the scroll offset from the height delta. Without that, prepending
 *   a page would yank them back to the top of the thread they were reading.
 */
export default function MessageThreadView({ conversation, thread }: MessageThreadViewProps) {
  const { currentUserId } = useMessages();
  const {
    messages, pending, loading, loadingMore, error, hasMore, loadOlder, retry,
    dismissPending, retryPending
  } = thread;

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Height before an older page is prepended, used to restore the offset after.
  const restoreRef = useRef<number | null>(null);
  const lastCountRef = useRef(0);

  const rows = useMemo(() => buildRows(messages, pending), [messages, pending]);
  const avatar = conversation?.participant?.avatar;

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    if (restoreRef.current !== null) {
      // Older messages were prepended: keep the reader where they were.
      node.scrollTop = node.scrollHeight - restoreRef.current;
      restoreRef.current = null;
      return;
    }

    const grew = rows.length > lastCountRef.current;
    lastCountRef.current = rows.length;
    if (!grew) return;

    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [rows.length]);

  // A different conversation always starts at its newest message.
  useEffect(() => {
    lastCountRef.current = 0;
    restoreRef.current = null;
  }, [conversation?._id]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node || loadingMore || !hasMore || loading) return;
    if (node.scrollTop > 80) return;

    restoreRef.current = node.scrollHeight;
    loadOlder();
  };

  if (loading && messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-(--border) border-t-(--text-muted)" />
      </div>
    );
  }

  if (error && messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[13px] text-(--text-muted)">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="cursor-pointer text-[13px] font-semibold text-(--text-strong) hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain message-scrollbar px-3 py-3 @min-[36rem]:px-8 @min-[36rem]:py-5"
    >
      {loadingMore ? (
        <div className="flex h-8 items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-(--border) border-t-(--text-muted)" />
        </div>
      ) : null}

      {!hasMore && messages.length === 0 && pending.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="text-[13px] font-medium text-(--text-soft)">No messages yet</p>
          <p className="text-[12px] text-(--text-faint)">Say something to get started.</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {rows.map((row) => {
          if (row.kind === 'separator') {
            return (
              <div key={row.key} className="py-1 text-center text-[12px] text-(--text-faint)">
                {row.label}
              </div>
            );
          }

          if (row.kind === 'pending') {
            // Retry is only offered for text. The browser `File` is gone once
            // the composer cleared it, so a media retry could only re-send the
            // caption without its attachment — an action that appears to work
            // and does not is worse than not offering it. The person re-picks
            // the file instead.
            const canRetry = row.message.type === MESSAGE_TYPE.TEXT;

            return (
              <MessageBubble
                key={row.key}
                message={row.message}
                outgoing
                pending={row.message}
                onRetry={canRetry ? () => void retryPending(row.message.localId) : undefined}
                onDismiss={() => dismissPending(row.message.localId)}
              />
            );
          }

          return (
            <MessageBubble
              key={row.key}
              message={row.message}
              outgoing={row.message.senderId === currentUserId}
              avatar={avatar}
            />
          );
        })}
      </div>

      <div ref={bottomRef} />
    </div>
  );
}
