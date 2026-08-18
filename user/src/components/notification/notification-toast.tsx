'use client';

import type { NotificationToast as ToastEntry } from '@providers/notification.provider';
import { useNotifications } from '@providers/notification.provider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FiX } from 'react-icons/fi';

import {
  resolveActorName,
  resolveNotificationPresentation,
  resolveNotificationTarget
} from './notification-presentation';

/** How long a toast stays before dismissing itself. */
const AUTO_DISMISS_MS = 6000;

function ToastCard({ toast, onDismiss }: { toast: ToastEntry; onDismiss: () => void }) {
  const router = useRouter();
  const { notification } = toast;
  const presentation = resolveNotificationPresentation(notification);
  const actorName = resolveActorName(notification);
  const target = resolveNotificationTarget(notification);

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-xl border border-(--border-faint) bg-(--surface-raised) px-3 py-2.5 shadow-(--shadow-popover)"
    >
      <button
        type="button"
        // The whole card navigates, using the same policy as the panel row, so a
        // comment notification opens the Comments tab from here too.
        onClick={() => {
          if (!target) return;
          onDismiss();
          router.push(target);
        }}
        disabled={!target}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-default"
      >
        <img
          src={notification.actor?.avatar || '/no_avatar.jpeg'}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-5 font-medium text-(--text-strong)">
            {actorName}
          </span>
          {presentation.deletedNotice ? (
            <span className="block truncate text-[12px] leading-4 text-(--text-muted) italic">
              {presentation.deletedNotice}
            </span>
          ) : null}
          {presentation.commentPreview ? (
            <span className="block truncate text-[12px] leading-4 text-(--text-strong)">
              {presentation.commentPreview}
            </span>
          ) : null}
          <span className="block truncate text-[12px] leading-4 text-(--text-soft)">
            {presentation.message}
          </span>
        </span>
        {presentation.showThumbnail && notification.postThumbnail ? (
          <img
            src={notification.postThumbnail}
            alt=""
            className="h-10 w-7.5 shrink-0 rounded-sm object-cover"
          />
        ) : null}
      </button>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="shrink-0 cursor-pointer text-(--text-muted) transition hover:text-(--text-strong)"
      >
        <FiX size={16} />
      </button>
    </div>
  );
}

/**
 * Corner toasts for notifications that arrive while the app is open.
 *
 * Purely a view over the provider's realtime queue — it holds no notification
 * state of its own, so there is one source of truth and a toast can never
 * disagree with the panel. Showing a toast is not a read: the row stays unread
 * and the bell keeps its badge until the panel is opened.
 */
export default function NotificationToaster() {
  const { toasts, dismissToast } = useNotifications();

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[9999] flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard
          key={toast.key}
          toast={toast}
          onDismiss={() => dismissToast(toast.key)}
        />
      ))}
    </div>
  );
}
