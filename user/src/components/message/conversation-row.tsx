'use client';

import type { IConversation } from '@interfaces/message';
import { MESSAGE_TYPE } from '@interfaces/message';
import { formatActivityTimestamp } from '@lib/date';

interface ConversationRowProps {
  conversation: IConversation;
  selected?: boolean;
  onSelect: (conversationId: string) => void;
  /**
   * Compact rows suit the 360px sidebar; the full page has room for a taller
   * row with a larger avatar, matching the reference's two densities.
   */
  density?: 'compact' | 'comfortable';
}

/**
 * Preview line for a conversation row.
 *
 * A media message with no caption still has to say something — a blank line
 * reads as a broken row rather than as a photo. The label is derived from the
 * message type here rather than stored, so it stays translatable and the stored
 * preview holds only what the sender actually typed.
 */
function resolvePreview(conversation: IConversation): string {
  if (conversation.lastMessage) return conversation.lastMessage;
  if (conversation.lastMessageType === MESSAGE_TYPE.IMAGE) return '[Photo]';
  if (conversation.lastMessageType === MESSAGE_TYPE.VIDEO) return '[Video]';
  return 'Say hello';
}

export default function ConversationRow({
  conversation,
  selected = false,
  onSelect,
  density = 'compact'
}: ConversationRowProps) {
  const participant = conversation.participant;
  const name = participant?.name || participant?.username || 'Unknown';
  const isUnread = conversation.unreadCount > 0;
  const comfortable = density === 'comfortable';

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect(conversation._id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(conversation._id)}
      onKeyDown={handleKeyDown}
      className={`group flex w-full cursor-pointer items-center gap-3 text-left transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#fe2c55] ${comfortable ? 'px-4 py-3' : 'px-4 py-2.5'
        } ${selected ? 'bg-(--surface-soft)' : 'hover:bg-(--hover-bg)'}`}
    >
      <div className="relative shrink-0">
        <img
          src={participant?.avatar || '/no_avatar.jpeg'}
          alt=""
          className={`rounded-full object-cover ${comfortable ? 'h-12 w-12' : 'h-11 w-11'}`}
        />
        {isUnread ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[#ff2f5f] ring-2 ring-(--surface)"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 border-b border-solid border-(--border-faint) py-2 pr-2.5">
        <div className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-[14px] ${isUnread ? 'font-semibold text-(--text-strong)' : 'font-medium text-(--text)'
            }`}
          >
            {name}
          </span>
          <span className="shrink-0 text-[12px] text-(--text-faint)">
            {conversation.lastMessageCreatedAt
              ? formatActivityTimestamp(conversation.lastMessageCreatedAt)
              : ''}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[13px] ${isUnread ? 'text-(--text-soft)' : 'text-(--text-faint)'
            }`}
          >
            {resolvePreview(conversation)}
          </span>
          {conversation.unreadCount > 1 ? (
            <span className="shrink-0 rounded-full bg-[#ff2f5f] px-1.5 text-[11px] font-semibold leading-4 text-white">
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
