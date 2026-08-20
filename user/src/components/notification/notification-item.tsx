'use client';

import Dropdown from '@components/ui/dropdown-menu';
import { useFollowCreator } from '@hooks/use-follow-creator';
import { INotification, NOTIFICATION_TYPE } from '@interfaces/notification';
import { formatActivityTimestamp } from '@lib/date';
import { useNotifications } from '@providers/notification.provider';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FiMoreHorizontal, FiTrash2 } from 'react-icons/fi';
import {
  resolveActorName,
  resolveNotificationPresentation,
  resolveNotificationTarget
} from './notification-presentation';
import { CommentIcon, LikePostIcon, TagIcon } from 'src/icons';

interface NotificationItemProps {
  notification: INotification;
  onNavigate: () => void;
}

export default function NotificationItem({ notification, onNavigate }: NotificationItemProps) {
  const router = useRouter();
  const { removeNotification } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);
  const presentation = resolveNotificationPresentation(notification);
  const actorName = resolveActorName(notification);
  const target = resolveNotificationTarget(notification);

  const followState = useFollowCreator(
    notification.actor?._id,
    Boolean(notification.isActorFollowed)
  );

  const handleActivate = () => {
    if (!target) return;
    onNavigate();
    router.push(target);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleActivate();
  };

  const renderIcon = () => {
    switch (notification.type) {
      case NOTIFICATION_TYPE.POST_LIKE || NOTIFICATION_TYPE.COMMENT_LIKE:
        return <LikePostIcon className='text-xl' />
      case NOTIFICATION_TYPE.POST_COMMENT || NOTIFICATION_TYPE.COMMENT_REPLY:
        return <CommentIcon className='text-xl' />
      case NOTIFICATION_TYPE.COMMENT_MENTION || NOTIFICATION_TYPE.POST_MENTION:
        return <TagIcon className='text-xl' />
      default:
        return null;
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      className={`group flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition hover:bg-(--hover-bg) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#fe2c55] ${notification.read ? '' : 'bg-(--surface-soft)'
        }`}
    >
      <div className='relative'>
        <img
          src={notification.actor?.avatar || '/no_avatar.jpeg'}
          alt=""
          className="h-10 w-10 shrink-0 self-start rounded-full object-cover"
        />
        {notification.read ? null : (
          <span className="absolute top-0 right-0 h-2 w-2 shrink-0 rounded-full bg-[#fe2c55]" aria-label="Unread" />
        )}
        <div className='w-5.5 h-5.5 rounded-full absolute -bottom-0.75 -right-0.75 bg-[rgba(37,38,50,1)]'>
          {renderIcon()}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] leading-5 font-medium text-(--text-strong)">
          {actorName}
        </p>
        {presentation.deletedNotice ? (
          // The interaction still happened, so the row keeps its history and
          // says what became of the content instead of disappearing.
          <p className="truncate text-[13px] leading-5 text-(--text-muted) italic">
            {presentation.deletedNotice}
          </p>
        ) : null}
        {presentation.commentPreview ? (
          // Quoting the comment is what makes the row specific: "mentioned you
          // in a comment" alone gives the reader nothing to recognise.
          <p className="line-clamp-2 text-[13px] leading-5 text-(--text-strong)">
            {presentation.commentPreview}
          </p>
        ) : null}
        <p className="truncate text-[13px] leading-5 text-(--text-soft)">
          {presentation.message}
        </p>
        <p className="mt-0.5 text-[12px] leading-4 text-(--text-muted)">
          {formatActivityTimestamp(notification.lastActivityAt)}
        </p>
      </div>

      <div className='flex flex-col'>
        {presentation.showFollowAction && notification.actor?._id && !followState.isOwner ? (
          <button
            type="button"
            onClick={(event) => {
              // The row navigates to the profile; following is a separate action.
              event.stopPropagation();
              void followState.toggleFollow();
            }}
            disabled={followState.following}
            className={`h-8 shrink-0 cursor-pointer rounded-lg px-3 text-[13px] leading-5 outline-none transition disabled:cursor-wait disabled:opacity-60 ${followState.isFollowed
              ? 'bg-(--btn-bg) text-(--text-muted) hover:bg-(--btn-bg-hover)'
              : 'bg-[#fe2c55] text-white hover:bg-[#e4264e]'
              }`}
          >
            {followState.isFollowed ? 'Following' : 'Follow back'}
          </button>
        ) : null}

        {presentation.showThumbnail && notification.postThumbnail ? (
          <img
            src={notification.postThumbnail}
            alt=""
            className="h-11.5 w-8.5 shrink-0 rounded-sm object-cover"
          />
        ) : null}

        {/*
        Row actions. Subtle until the row is hovered or the menu is open, and
        pointer/key events are stopped here so opening the menu never navigates
        the row underneath it.
      */}
        <div
          className={`shrink-0 self-end transition ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="presentation"
        >
          <Dropdown
            open={menuOpen}
            onOpenChange={setMenuOpen}
            triggerMode="click"
            position="right"
            width={190}
            menuClassName="!mt-0 !overflow-hidden !rounded-lg !border-none !bg-(--surface-raised) !py-1 !shadow-(--shadow-popover)"
            trigger={(
              <button
                type="button"
                aria-label="Notification actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="cursor-pointer rounded p-1 text-(--text-muted) transition hover:text-(--text-strong)"
              >
                <FiMoreHorizontal size={16} />
              </button>
            )}
          >
            <div role="menu" aria-label="Notification actions">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void removeNotification(notification._id);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px] leading-5 text-(--text-strong) transition hover:bg-(--hover-bg)"
              >
                <FiTrash2 size={14} />
                Delete notification
              </button>
            </div>
          </Dropdown>
        </div>
      </div>
    </div>

  );
}
