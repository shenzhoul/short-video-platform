'use client';

import NoData from '@components/ui/no-data';
import { useNotifications } from '@providers/notification.provider';
import { useEffect, useRef } from 'react';

import NotificationItem from './notification-item';

/** Placeholder rows sized like real ones, so opening the panel does not jump. */
function NotificationSkeleton() {
  return (
    <div className="animate-pulse px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-(--surface-muted)" />
        <div className="min-w-0 flex-1 space-y-2 py-0.5">
          <div className="h-3 w-1/3 rounded bg-(--surface-muted)" />
          <div className="h-3 w-1/2 rounded bg-(--surface-muted)" />
          <div className="h-2.5 w-12 rounded bg-(--surface-muted)" />
        </div>
        <div className="h-12 w-9 shrink-0 rounded-sm bg-(--surface-muted)" />
      </div>
    </div>
  );
}

export default function NotificationList({ onNavigate }: { onNavigate: () => void }) {
  const {
    notifications, loading, loadingMore, error, hasMore, loadMore, retry
  } = useNotifications();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Matches the infinite-scroll approach used elsewhere: observe a sentinel at
  // the end of the list rather than tracking scroll offsets.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '120px 0px' });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, notifications.length]);

  if (loading && !notifications.length) {
    return (
      <div className="divide-y divide-(--divider)">
        {[0, 1, 2, 3, 4].map((key) => <NotificationSkeleton key={key} />)}
      </div>
    );
  }

  if (error && !notifications.length) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-[14px] leading-5 text-(--text-soft)">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 cursor-pointer rounded-lg bg-(--btn-bg) px-4 py-1.5 text-[13px] leading-5 text-(--text-strong) transition hover:bg-(--btn-bg-hover)"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!notifications.length) {
    return (
      <NoData
        title="No notifications yet"
        description="Likes, comments, mentions and new followers will show up here."
        className="py-10"
      />
    );
  }

  return (
    <div className="divide-y divide-(--divider)">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification._id}
          notification={notification}
          onNavigate={onNavigate}
        />
      ))}

      {hasMore ? <div ref={sentinelRef} className="h-px" /> : null}
      {loadingMore ? <NotificationSkeleton /> : null}
    </div>
  );
}
