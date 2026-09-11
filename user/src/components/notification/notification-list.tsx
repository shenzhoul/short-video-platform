'use client';

import NoData from '@components/ui/no-data';
import { useNotifications } from '@providers/notification.provider';
import { useEffect, useRef } from 'react';

import NotificationItem from './notification-item';

/** Placeholder rows sized like real ones, so opening the panel does not jump. */
function NotificationSkeleton() {
  return (
    <div className="animate-pulse px-4 max-lg:px-2.5 py-3 max-lg:py-1.5">
      <div className="flex items-start gap-3 max-lg:gap-2">
        <div className="h-10 w-10 max-lg:h-7.5 max-lg:w-7.5 shrink-0 rounded-full bg-(--surface-muted)" />
        <div className="min-w-0 flex-1 space-y-2 max-lg:space-y-1 py-0.5">
          <div className="h-3 max-lg:h-2 w-1/3 rounded bg-(--surface-muted)" />
          <div className="h-3 max-lg:h-2 w-1/2 rounded bg-(--surface-muted)" />
          <div className="h-2.5 max-lg:h-1.5 w-12 max-lg:w-8 rounded bg-(--surface-muted)" />
        </div>
        <div className="h-12 w-9 max-lg:h-8.5 max-lg:w-6.5 shrink-0 rounded-sm bg-(--surface-muted)" />
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
      <div className="px-4 py-10 max-lg:px-2.5 max-lg:py-5 text-center">
        <p className="text-[14px] max-lg:text-[10px] leading-5 max-lg:leading-4 text-(--text-soft)">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 max-lg:mt-2 cursor-pointer rounded-lg max-lg:rounded-md bg-(--btn-bg) px-4 max-lg:px-2.5 py-1.5 max-lg:py-1 text-[13px] max-lg:text-[10px] leading-5 max-lg:leading-4 text-(--text-strong) transition hover:bg-(--btn-bg-hover)"
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
        className="py-10 max-lg:py-5"
      />
    );
  }

  return (
    <div>
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
