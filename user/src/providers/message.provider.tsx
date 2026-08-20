'use client';

import type {
  IConversation,
  IMessage,
  IMessageUnreadTotals
} from '@interfaces/message';
import { MESSAGE_SOCKET_EVENT } from '@interfaces/message';
import type { CursorInfo } from '@interfaces/pagination';
import {
  getMessageUnreadCount,
  markAllMessagesRead,
  markConversationRead as markConversationReadRequest,
  openConversation as openConversationRequest,
  searchConversations
} from '@services/message.service';
import { useSession } from 'next-auth/react';
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from 'react';
import { useSocket } from 'src/socket/socket-context';
import { useSocketListener } from 'src/socket/use-socket-listener';

const PAGE_LIMIT = 20;

/**
 * Bound on the set of message ids remembered for de-duplication. Comfortably
 * larger than any thread page, and capped so a long session cannot grow it
 * without limit.
 */
const SEEN_MESSAGE_LIMIT = 500;

/** A message delivered over the socket, for whichever thread is listening. */
export type MessageArrivalHandler = (message: IMessage) => void;

interface MessageContextValue {
  /** Signed-in user's id, so a surface can tell its own bubbles from theirs. */
  currentUserId: string | null;
  conversations: IConversation[];
  unread: IMessageUnreadTotals;
  /** The header indicator: whether anything at all is unread. */
  hasUnread: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  keyword: string;
  /** Loads the first page if it has not been loaded yet. */
  ensureLoaded: () => void;
  loadMore: () => void;
  retry: () => void;
  setKeyword: (keyword: string) => void;
  /** Opens (or creates) the conversation with one user and returns its id. */
  openConversationWith: (participantId: string) => Promise<IConversation | null>;
  markConversationRead: (conversationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  getConversation: (conversationId: string) => IConversation | undefined;
  /**
   * Subscribe to arriving messages. Returns an unsubscribe function.
   *
   * Threads register here instead of adding their own socket listener, so the
   * number of socket handlers stays fixed no matter how many surfaces are open.
   */
  subscribeToMessages: (handler: MessageArrivalHandler) => () => void;
  /** Records a message this client just sent, so its socket echo is ignored. */
  rememberMessage: (messageId: string) => void;
}

const MessageContext = createContext<MessageContextValue | null>(null);

/**
 * Activity time of a conversation, for ordering only.
 *
 * Falls back to when the conversation was opened, because a conversation with
 * no messages yet still has a place in the list. This mirrors what the server
 * orders by — the participant's `lastMessageAt`, which is seeded with the
 * creation time and then tracks real messages — so a client-side re-sort cannot
 * move a row to a different position than the page it arrived in.
 *
 * Deliberately not `lastMessageCreatedAt` alone: that field means strictly "the
 * last message", is null for an empty conversation, and sorting by it sent
 * every empty conversation to the bottom the moment anything triggered a
 * re-sort.
 */
function activityTime(conversation: IConversation): number {
  const source = conversation.lastMessageCreatedAt || conversation.createdAt;
  const time = source ? new Date(source).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

/** Most recent activity first, with a stable fallback for equal timestamps. */
function sortConversations(items: IConversation[]): IConversation[] {
  return [...items].sort((a, b) => {
    const left = activityTime(a);
    const right = activityTime(b);
    if (left !== right) return right - left;
    return a._id < b._id ? 1 : -1;
  });
}

/**
 * Owns the direct-message domain for the signed-in user.
 *
 * Mounted above every message surface rather than inside one, for the same two
 * reasons the notification provider is:
 *
 * - the unread indicator must stay live even if the workspace is never opened,
 *   so the socket subscription cannot be tied to the panel's lifetime;
 * - it is the *only* subscriber to the message socket events, so opening and
 *   closing the workspace, navigating to the full page, a reconnect, or a
 *   StrictMode double-invoke cannot register a second handler and double-count.
 *
 * The conversation list itself is still lazy: nothing is fetched until
 * `ensureLoaded` runs, which the workspace calls when it first opens.
 *
 * Unread counts are never computed here. They arrive from the server, either in
 * a conversation payload or in an unread-totals event. A client-side increment
 * would drift the moment a frame was replayed or missed, and the badge would
 * disagree with the rows with no way for the user to reconcile it.
 */
export function MessageProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const { isConnected } = useSocket();
  const isAuthenticated = status === 'authenticated';
  const currentUserId = (session?.user as any)?._id || (session?.user as any)?.id || null;

  const [conversations, setConversations] = useState<IConversation[]>([]);
  const [unread, setUnread] = useState<IMessageUnreadTotals>({
    totalUnreadMessages: 0,
    totalUnreadConversations: 0
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(null);
  const [keyword, setKeywordState] = useState('');
  // Mirror of the keyword, so the setter can compare without being re-created
  // on every change — the list depends on its identity being stable.
  const keywordRef = useRef('');

  const loadingRef = useRef(false);
  const hasLoadedRef = useRef(false);
  // Discards responses from a superseded search so a slow request cannot
  // overwrite the results of a newer one.
  const requestIdRef = useRef(0);
  // Messages already applied, from any source. Insertion ordered, so the oldest
  // entry is the one evicted at the cap.
  const seenMessagesRef = useRef<Set<string>>(new Set());
  // Threads currently listening for arrivals.
  const messageHandlersRef = useRef<Set<MessageArrivalHandler>>(new Set());
  // Mirror of the list, so a read can check the row's current unread count
  // without depending on a stale closure or on when React runs an updater.
  const conversationsRef = useRef<IConversation[]>([]);
  conversationsRef.current = conversations;

  const rememberMessage = useCallback((messageId: string) => {
    if (!messageId) return;
    const seen = seenMessagesRef.current;
    seen.add(messageId);
    while (seen.size > SEEN_MESSAGE_LIMIT) {
      const oldest = seen.values().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }, []);

  const subscribeToMessages = useCallback((handler: MessageArrivalHandler) => {
    messageHandlersRef.current.add(handler);
    return () => {
      messageHandlersRef.current.delete(handler);
    };
  }, []);

  const refreshUnread = useCallback(async () => {
    try {
      const response = await getMessageUnreadCount();
      setUnread({
        totalUnreadMessages: response?.data?.totalUnreadMessages || 0,
        totalUnreadConversations: response?.data?.totalUnreadConversations || 0
      });
    } catch {
      // A failed badge count must never surface as an error in the header.
    }
  }, []);

  const loadPage = useCallback(async (cursor: CursorInfo | null, search: string) => {
    // A keyword change must be allowed to replace an in-flight first page.
    // Cursor requests stay serialized so a page cannot be appended twice.
    if (cursor && loadingRef.current) return;
    loadingRef.current = true;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await searchConversations({
        limit: PAGE_LIMIT,
        ...(search ? { q: search } : {}),
        ...(cursor ? { cursor: cursor.id, lastCreatedAt: cursor.createdAt.toString() } : {})
      });
      if (requestId !== requestIdRef.current) return;

      const page = response?.data || {};
      const incoming: IConversation[] = page.data || [];

      setConversations((current) => {
        if (!cursor) return incoming;
        // De-duplicate by id: a realtime update can race a page load and would
        // otherwise place the same conversation in the list twice.
        const merged = new Map(current.map((item) => [item._id, item]));
        incoming.forEach((item) => merged.set(item._id, item));
        return sortConversations([...merged.values()]);
      });
      setHasMore(Boolean(page.hasMore));
      setNextCursor(page.nextCursor || null);
      hasLoadedRef.current = true;
    } catch {
      if (requestId === requestIdRef.current) setError('Conversations could not be loaded.');
    } finally {
      if (requestId === requestIdRef.current) {
        loadingRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  // The indicator is authoritative from sign-in onward, independent of whether
  // the workspace is ever opened.
  useEffect(() => {
    if (!isAuthenticated) {
      setConversations([]);
      setUnread({ totalUnreadMessages: 0, totalUnreadConversations: 0 });
      setHasMore(false);
      setNextCursor(null);
      hasLoadedRef.current = false;
      keywordRef.current = '';
      setKeywordState('');
      // Nothing from the previous session may suppress the next one's events.
      seenMessagesRef.current.clear();
      return;
    }
    void refreshUnread();
  }, [isAuthenticated, refreshUnread]);

  // A dropped connection can miss deliveries entirely, so the totals are
  // re-derived from the server whenever the socket comes back rather than left
  // showing whatever they were when it died.
  useEffect(() => {
    if (!isAuthenticated || !isConnected) return;
    void refreshUnread();
  }, [isAuthenticated, isConnected, refreshUnread]);

  /**
   * A message arrived.
   *
   * De-duplicated on the server id, which covers three separate cases with one
   * check: the sender's own echo of a message they just posted through the API,
   * a redelivery after a queue retry, and the same frame reaching two surfaces.
   * Threads are notified only for a genuinely new message.
   */
  useSocketListener<IMessage>(MESSAGE_SOCKET_EVENT.CREATED, (message) => {
    if (!message?._id) return;
    if (seenMessagesRef.current.has(message._id)) return;
    rememberMessage(message._id);

    messageHandlersRef.current.forEach((handler) => {
      try {
        handler(message);
      } catch {
        // One thread failing to apply a message must not stop the others.
      }
    });
  }, { enabled: isAuthenticated });

  /**
   * A conversation row changed for this reader.
   *
   * The payload is built per participant on the server and already carries this
   * reader's own unread count and permission state, so it replaces the row
   * wholesale rather than being merged field by field.
   */
  useSocketListener<IConversation>(MESSAGE_SOCKET_EVENT.CONVERSATION_UPDATED, (conversation) => {
    if (!conversation?._id) return;

    setConversations((current) => {
      const index = current.findIndex((item) => item._id === conversation._id);
      if (index === -1) {
        // Only insert into a list the user has actually loaded, otherwise the
        // workspace would open showing a single row instead of a real page.
        return hasLoadedRef.current ? sortConversations([conversation, ...current]) : current;
      }
      const next = [...current];
      next[index] = conversation;
      return sortConversations(next);
    });
  }, { enabled: isAuthenticated });

  /** Authoritative totals. Always replaces, never adjusts. */
  useSocketListener<IMessageUnreadTotals>(MESSAGE_SOCKET_EVENT.UNREAD_UPDATED, (totals) => {
    if (!totals) return;
    setUnread({
      totalUnreadMessages: totals.totalUnreadMessages || 0,
      totalUnreadConversations: totals.totalUnreadConversations || 0
    });
  }, { enabled: isAuthenticated });

  /**
   * This reader marked something read, possibly in another tab.
   *
   * Applied to the rows here so every surface agrees, without refetching.
   */
  useSocketListener<{ conversationIds: string[] | null }>(MESSAGE_SOCKET_EVENT.READ, (payload) => {
    const ids = payload?.conversationIds;
    setConversations((current) => current.map((item) => {
      if (ids !== null && !(ids || []).includes(item._id)) return item;
      return item.unreadCount === 0 ? item : { ...item, unreadCount: 0 };
    }));
  }, { enabled: isAuthenticated });

  const ensureLoaded = useCallback(() => {
    if (hasLoadedRef.current || loadingRef.current) return;
    void loadPage(null, keyword);
  }, [keyword, loadPage]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore || !nextCursor) return;
    void loadPage(nextCursor, keyword);
  }, [hasMore, keyword, loadPage, nextCursor]);

  const retry = useCallback(() => {
    hasLoadedRef.current = false;
    void loadPage(null, keyword);
  }, [keyword, loadPage]);

  const setKeyword = useCallback((next: string) => {
    // A no-op search must stay a no-op. The list re-runs its debounced search on
    // every mount, and the workspace unmounts whenever it closes — so without
    // this guard, simply opening the panel would blank the rows and refetch the
    // page the user was already looking at.
    if (next === keywordRef.current) return;

    keywordRef.current = next;
    setKeywordState(next);
    setConversations([]);
    setHasMore(false);
    setNextCursor(null);
    hasLoadedRef.current = false;
    void loadPage(null, next);
  }, [loadPage]);

  const openConversationWith = useCallback(async (participantId: string) => {
    if (!participantId) return null;
    try {
      const response = await openConversationRequest(participantId);
      const conversation: IConversation = response?.data;
      if (!conversation?._id) return null;

      // Inserted even when the list has not been loaded yet. Unlike a socket
      // arrival, this conversation was explicitly asked for — a profile's
      // "Message" action — and the thread that opens next reads its participant
      // from here. Leaving it out rendered the header as "Conversation" instead
      // of the creator's name, and left the list empty on the way back.
      //
      // Upserted by `_id`, so opening the same conversation twice updates the
      // existing row instead of adding a second one.
      setConversations((current) => {
        const index = current.findIndex((item) => item._id === conversation._id);
        if (index !== -1) {
          const next = [...current];
          next[index] = conversation;
          return next;
        }
        // A search is showing a filtered result set. Injecting a row that does
        // not match the active keyword would contradict what the user asked to
        // see; it appears as soon as the search is cleared.
        if (keywordRef.current) return current;
        return sortConversations([conversation, ...current]);
      });
      return conversation;
    } catch {
      return null;
    }
  }, []);

  /**
   * Mark one conversation read.
   *
   * Applied locally first so opening a thread clears its badge immediately, then
   * confirmed by the server. The socket `read` frame that follows carries the
   * same outcome, so the two agree rather than fighting. On failure the totals
   * are re-derived rather than guessed at.
   */
  const markConversationRead = useCallback(async (conversationId: string) => {
    if (!conversationId) return;

    setConversations((current) => current.map((item) => (
      item._id === conversationId && item.unreadCount > 0
        ? { ...item, unreadCount: 0 }
        : item
    )));

    // Always told to the server, never skipped because the local row happens to
    // show zero. That local count is frequently stale in exactly the case that
    // matters: a message arriving in the thread the user is already reading is
    // applied to the thread before the row's own increment has come back over
    // the socket, so a "was it unread?" check sees 0, suppresses the call, and
    // the increment lands a moment later with nothing left to clear it.
    //
    // The call is idempotent and cheap — it reports how much it cleared — so
    // making it unconditionally is both simpler and correct.
    try {
      await markConversationReadRequest(conversationId);
    } catch {
      await refreshUnread();
    }
  }, [refreshUnread]);

  const markAllRead = useCallback(async () => {
    setConversations((current) => current.map((item) => (
      item.unreadCount === 0 ? item : { ...item, unreadCount: 0 }
    )));
    setUnread({ totalUnreadMessages: 0, totalUnreadConversations: 0 });

    try {
      await markAllMessagesRead();
    } catch {
      await refreshUnread();
    }
  }, [refreshUnread]);

  const getConversation = useCallback(
    (conversationId: string) => conversations.find((item) => item._id === conversationId),
    [conversations]
  );

  const value = useMemo<MessageContextValue>(() => ({
    currentUserId,
    conversations,
    unread,
    hasUnread: unread.totalUnreadMessages > 0,
    loading,
    loadingMore,
    error,
    hasMore,
    keyword,
    ensureLoaded,
    loadMore,
    retry,
    setKeyword,
    openConversationWith,
    markConversationRead,
    markAllRead,
    getConversation,
    subscribeToMessages,
    rememberMessage
  }), [
    currentUserId, conversations, unread, loading, loadingMore, error, hasMore, keyword,
    ensureLoaded, loadMore, retry, setKeyword, openConversationWith,
    markConversationRead, markAllRead, getConversation, subscribeToMessages,
    rememberMessage
  ]);

  return (
    <MessageContext.Provider value={value}>
      {children}
    </MessageContext.Provider>
  );
}

export function useMessages() {
  const context = useContext(MessageContext);
  if (!context) {
    throw new Error('useMessages must be used within a MessageProvider');
  }
  return context;
}
