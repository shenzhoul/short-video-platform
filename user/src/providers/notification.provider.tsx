'use client';

import {
  INotification,
  NOTIFICATION_FILTER_TYPES,
  NotificationFilter } from '@interfaces/notification';
import type { CursorInfo } from '@interfaces/pagination';
import {
  deleteNotification,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  searchNotifications
} from '@services/notification.service';
import { useSession } from 'next-auth/react';
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from 'react';
import { useSocket } from 'src/socket/socket-context';
import { useSocketListener } from 'src/socket/use-socket-listener';

const PAGE_LIMIT = 15;

/**
 * How many recent activities are remembered for replay detection. Comfortably
 * larger than a page, and bounded so the set cannot grow without limit during a
 * long session.
 */
const SEEN_ACTIVITY_LIMIT = 300;

/**
 * Identity of one *activity*, which is not the same as identity of a row.
 *
 * The backend de-duplicates by design, so a repeated interaction reuses the same
 * notification document. `_id` alone therefore cannot distinguish a duplicate
 * socket delivery from a genuine new interaction on an existing row — pairing it
 * with `lastActivityAt` can: a replay repeats the timestamp, a real repeat
 * advances it.
 */
function activityKey(notification: INotification): string {
  const timestamp = new Date(notification.lastActivityAt).getTime();
  return `${notification._id}:${Number.isNaN(timestamp) ? notification.lastActivityAt : timestamp}`;
}

/** A realtime arrival queued for the corner toast, keyed by its activity. */
export interface NotificationToast {
  key: string;
  notification: INotification;
}

/** How many toasts may stack before the oldest is dropped. */
const MAX_TOASTS = 3;

interface NotificationContextValue {
  notifications: INotification[];
  unreadCount: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  categoryFilter: NotificationFilter | null;
  /** Realtime arrivals awaiting display; never a second source of truth. */
  toasts: NotificationToast[];
  dismissToast: (key: string) => void;
  /** Loads the first page if it has not been loaded yet. */
  ensureLoaded: () => void;
  loadMore: () => void;
  retry: () => void;
  setCategoryFilter: (category: NotificationFilter | null) => void;
  markAllRead: () => Promise<void>;
  /** Removes one notification from this user's own inbox. */
  removeNotification: (id: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

/**
 * Owns notification state for the signed-in user.
 *
 * Deliberately mounted above the panel rather than inside it, for two reasons:
 *
 * - the unread badge must stay live even if the panel is never opened, so the
 *   socket subscription cannot be tied to the panel's lifetime;
 * - it is the single subscriber to `notification:created`, so repeated opening
 *   and closing of the panel, a reconnect, or a StrictMode double-invoke cannot
 *   register a second handler and double-count.
 *
 * The list itself is still lazy: nothing is fetched until `ensureLoaded` runs,
 * which the panel calls when it first opens.
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const { isConnected } = useSocket();
  const isAuthenticated = status === 'authenticated';

  const [notifications, setNotifications] = useState<INotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(null);
  const [categoryFilter, setCategoryFilterState] = useState<NotificationFilter | null>(null);
  const [toasts, setToasts] = useState<NotificationToast[]>([]);

  const loadingRef = useRef(false);
  const hasLoadedRef = useRef(false);
  // Discards responses from a superseded filter so a slow first request cannot
  // overwrite the results of a newer one.
  const requestIdRef = useRef(0);
  // React StrictMode can replay the panel's mount effect. Reuse the active
  // request so one visual open results in one read-all mutation.
  const readAllPromiseRef = useRef<Promise<void> | null>(null);
  // Activities already applied, from the socket or from a loaded page. Insertion
  // ordered, so the oldest entry is the one evicted when the cap is reached.
  const seenActivitiesRef = useRef<Set<string>>(new Set());
  // Rows this user deleted, so an in-flight update cannot resurrect them.
  const deletedIdsRef = useRef<Set<string>>(new Set());
  // Mirror of the list, so a delete can read the row's read state without
  // depending on a stale closure.
  const notificationsRef = useRef<INotification[]>([]);
  notificationsRef.current = notifications;

  const rememberActivity = useCallback((notification: INotification) => {
    const seen = seenActivitiesRef.current;
    seen.add(activityKey(notification));
    while (seen.size > SEEN_ACTIVITY_LIMIT) {
      const oldest = seen.values().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }, []);

  const applyNotifications = useCallback((
    update: (current: INotification[]) => INotification[]
  ) => {
    setNotifications(update);
  }, []);

  const loadPage = useCallback(async (
    cursor: CursorInfo | null,
    filter: NotificationFilter | null
  ) => {
    // A filter change must be allowed to replace an in-flight first-page
    // request. Cursor requests remain serialized to avoid duplicate pages.
    if (cursor && loadingRef.current) return;
    loadingRef.current = true;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    const pendingReadAll = readAllPromiseRef.current;

    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await searchNotifications({
        limit: PAGE_LIMIT,
        ...(filter ? { category: filter } : {}),
        ...(cursor ? { cursor: cursor.id, lastCreatedAt: cursor.createdAt.toString() } : {})
      });
      if (requestId !== requestIdRef.current) return;

      const page = response?.data || {};
      let incoming: INotification[] = page.data || [];

      // The request and read-all mutation intentionally run in parallel. If
      // this query began before that mutation settled, normalize its snapshot
      // after the mutation so stale unread rows cannot flash in the panel.
      if (pendingReadAll) {
        await pendingReadAll;
        if (requestId !== requestIdRef.current) return;
        incoming = incoming.map((item) => (item.read ? item : { ...item, read: true }));
      }

      // The server state is now the newest thing we know about each of these
      // activities, so a late socket replay of any of them must not re-apply.
      incoming.forEach(rememberActivity);

      applyNotifications((current) => {
        if (!cursor) return incoming;
        // De-duplicate by id: a realtime insert can race a page load and would
        // otherwise appear twice.
        const merged = new Map(current.map((item) => [item._id, item]));
        incoming.forEach((item) => merged.set(item._id, item));
        return [...merged.values()];
      });
      setHasMore(Boolean(page.hasMore));
      setNextCursor(page.nextCursor || null);
      hasLoadedRef.current = true;
    } catch {
      if (requestId === requestIdRef.current) setError('Notifications could not be loaded.');
    } finally {
      if (requestId === requestIdRef.current) {
        loadingRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [applyNotifications, rememberActivity]);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const response = await getUnreadNotificationCount();
      setUnreadCount(response?.data?.total || 0);
    } catch {
      // A failed badge count must never surface as an error in the header.
    }
  }, []);

  // The badge is authoritative from login onward, independent of the panel.
  useEffect(() => {
    if (!isAuthenticated) {
      applyNotifications(() => []);
      setUnreadCount(0);
      setHasMore(false);
      setNextCursor(null);
      hasLoadedRef.current = false;
      setToasts([]);
      // Nothing from the previous session may suppress the next one's events.
      seenActivitiesRef.current.clear();
      return;
    }
    void refreshUnreadCount();
  }, [applyNotifications, isAuthenticated, refreshUnreadCount]);

  // A dropped connection can miss deliveries entirely, so the badge is
  // re-derived from the server whenever the socket comes back rather than left
  // showing whatever the count was when the connection died.
  useEffect(() => {
    if (!isAuthenticated || !isConnected) return;
    void refreshUnreadCount();
  }, [isAuthenticated, isConnected, refreshUnreadCount]);

  const markAllRead = useCallback(() => {
    if (readAllPromiseRef.current) return readAllPromiseRef.current;

    applyNotifications((current) => current.map((item) => (item.read ? item : { ...item, read: true })));
    setUnreadCount(0);

    const request = markAllNotificationsRead()
      .then(() => {
        // Also cover a page response that raced the read-all request.
        applyNotifications((current) => current.map((item) => (
          item.read ? item : { ...item, read: true }
        )));
      })
      .catch(() => refreshUnreadCount())
      .then(() => undefined)
      .finally(() => {
        if (readAllPromiseRef.current === request) readAllPromiseRef.current = null;
      });

    readAllPromiseRef.current = request;
    return request;
  }, [applyNotifications, refreshUnreadCount]);

  const dismissToast = useCallback((key: string) => {
    setToasts((current) => current.filter((toast) => toast.key !== key));
  }, []);

  useSocketListener<INotification>('notification:created', (notification) => {
    if (!notification?._id || !notification.lastActivityAt) return;

    // Ignore an activity already applied, whether it arrived twice over the
    // socket or was already present in a loaded page. Without this, a replay
    // would overwrite the local row with the payload captured at creation time
    // (`read: false`) and flip a notification the user has already read back to
    // unread, leaving the row and the badge disagreeing.
    if (seenActivitiesRef.current.has(activityKey(notification))) return;
    rememberActivity(notification);

    applyNotifications((current) => {
      // Keep a filtered result set pure when another type arrives in realtime.
      if (
        categoryFilter
        && !NOTIFICATION_FILTER_TYPES[categoryFilter].includes(notification.type)
      ) return current;

      const existingIndex = current.findIndex((item) => item._id === notification._id);
      if (existingIndex === -1) {
        // Only insert into a list the user has actually loaded, otherwise the
        // panel would open showing a single item instead of a real first page.
        return hasLoadedRef.current ? [notification, ...current] : current;
      }
      // A genuine repeat interaction reuses the row: move it back to the top
      // with its refreshed, unread state.
      const next = [...current];
      next.splice(existingIndex, 1);
      return [notification, ...next];
    });

    // Only a genuine new activity reaches this point — an exact replay returned
    // above — so the toast inherits the replay guard rather than repeating it.
    // Aggregate updates do arrive here, and show the refreshed wording ("X and 2
    // others liked your post") because the payload carries the new actorCount.
    setToasts((current) => [
      ...current.slice(-(MAX_TOASTS - 1)),
      { key: activityKey(notification), notification }
    ]);

    // Deliberately no special case for an open panel. A notification arriving
    // while the user is looking at the list must stay visibly new — it belongs
    // to the *next* seen-batch, which is settled when the panel closes.
    //
    // Recount rather than increment: a de-duplicated repeat may resurface a row
    // that was already read, so the delta is not always +1.
    void refreshUnreadCount();
  }, { enabled: isAuthenticated });

  /**
   * Patch an existing row whose rendered content changed server-side.
   *
   * Today that means the comment it quotes was deleted. This is an update, not
   * arriving activity, so it deliberately does none of what a new notification
   * does: no insert, no reorder, no unread recount, no change to `read`. Only
   * the row's content is replaced, and only if it is already on screen.
   */
  useSocketListener<INotification>('notification:updated', (updated) => {
    if (!updated?._id) return;

    if (deletedIdsRef.current.has(updated._id)) return;

    applyNotifications((current) => {
      const index = current.findIndex((item) => item._id === updated._id);
      if (index === -1) return current;

      const next = [...current];
      // Read state is the viewer's, not the server's to reset here, so it is
      // preserved across the patch.
      next[index] = { ...updated, read: current[index].read, readAt: current[index].readAt };
      return next;
    });

    // Deliberately no refreshUnreadCount(): a deleted comment does not change
    // how many notifications are unread.
  }, { enabled: isAuthenticated });

  /**
   * Delete one notification from this user's inbox.
   *
   * Only the row goes — the like, comment or follow it describes is untouched,
   * and an aggregate row is removed as the single document it is.
   *
   * The local list is patched rather than refetched: the server has already
   * confirmed the delete, so a round trip would only cost a page load and risk
   * reordering rows the reader is looking at.
   */
  const removeNotification = useCallback(async (id: string) => {
    if (!id) return;

    const removed = notificationsRef.current.find((item) => item._id === id);
    try {
      await deleteNotification(id);
    } catch {
      // The server is authoritative. A refused delete — someone else's row, or
      // one already gone — leaves the list exactly as it was rather than
      // removing something the server still has.
      return;
    }

    // Remembered so a `notification:updated` frame already in flight for this
    // row cannot patch it back into the list after the delete succeeded.
    deletedIdsRef.current.add(id);
    while (deletedIdsRef.current.size > SEEN_ACTIVITY_LIMIT) {
      const oldest = deletedIdsRef.current.values().next().value;
      if (oldest === undefined) break;
      deletedIdsRef.current.delete(oldest);
    }

    applyNotifications((current) => current.filter((item) => item._id !== id));
    // Deleting is not reading: only an unread row changes the badge, and only
    // by one.
    if (removed && !removed.read) setUnreadCount((count) => Math.max(0, count - 1));
  }, [applyNotifications]);

  const ensureLoaded = useCallback(() => {
    if (hasLoadedRef.current || loadingRef.current) return;
    void loadPage(null, categoryFilter);
  }, [categoryFilter, loadPage]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore || !nextCursor) return;
    void loadPage(nextCursor, categoryFilter);
  }, [categoryFilter, hasMore, loadPage, nextCursor]);

  const retry = useCallback(() => {
    hasLoadedRef.current = false;
    void loadPage(null, categoryFilter);
  }, [categoryFilter, loadPage]);

  const setCategoryFilter = useCallback((category: NotificationFilter | null) => {
    if (category === categoryFilter) return;
    setCategoryFilterState(category);
    applyNotifications(() => []);
    setHasMore(false);
    setNextCursor(null);
    hasLoadedRef.current = false;
    void loadPage(null, category);
  }, [applyNotifications, categoryFilter, loadPage]);

  const value = useMemo<NotificationContextValue>(() => ({
    notifications,
    unreadCount,
    loading,
    loadingMore,
    error,
    hasMore,
    categoryFilter,
    toasts,
    dismissToast,
    ensureLoaded,
    loadMore,
    retry,
    setCategoryFilter,
    markAllRead,
    removeNotification
  }), [
    notifications, unreadCount, loading, loadingMore, error, hasMore, categoryFilter,
    toasts, dismissToast,
    ensureLoaded, loadMore, retry, setCategoryFilter, markAllRead, removeNotification
  ]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
