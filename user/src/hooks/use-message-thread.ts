'use client';

import type {
  AwaitingReplyFrom,
  IMessage,
  IMessageFile,
  IPendingMessage,
  MessageRequestState } from '@interfaces/message';
import { MESSAGE_TYPE } from '@interfaces/message';
import type { CursorInfo } from '@interfaces/pagination';
import { useMessages } from '@providers/message.provider';
import {
  searchMessages,
  sendMessage,
  uploadMessagePhoto,
  uploadMessageVideo
} from '@services/message.service';
import {
  useCallback, useEffect, useMemo, useRef, useState
} from 'react';

const PAGE_LIMIT = 25;

export interface UseMessageThreadResult {
  /** Confirmed history, oldest first, ready to render top to bottom. */
  messages: IMessage[];
  /** Bubbles that exist only locally until the server confirms them. */
  pending: IPendingMessage[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  sending: boolean;
  canSend: boolean;
  awaitingReplyFrom: AwaitingReplyFrom;
  /**
   * Where the request stands, straight from the server: `mutual`, `accepted`,
   * `waiting` or `idle`. `null` until the conversation is known.
   *
   * The thread needs this as well as `canSend` because the two free states —
   * mutual followers, and an answered request — allow the same sends but must
   * be explained differently.
   */
  requestState: MessageRequestState | null;
  /** Loads older messages. Safe to call repeatedly. */
  loadOlder: () => void;
  retry: () => void;
  send: (input: { text: string; file?: File | null }) => Promise<boolean>;
  /** Discards a failed bubble. */
  dismissPending: (localId: string) => void;
  /** Retries a failed bubble's text. Media has to be re-picked. */
  retryPending: (localId: string) => Promise<boolean>;
}

let localIdCounter = 0;
function nextLocalId() {
  localIdCounter += 1;
  return `pending-${Date.now()}-${localIdCounter}`;
}

/** Oldest first, with `_id` breaking ties so same-millisecond sends are stable. */
function sortMessages(items: IMessage[]): IMessage[] {
  return [...items].sort((a, b) => {
    const left = new Date(a.createdAt).getTime();
    const right = new Date(b.createdAt).getTime();
    if (left !== right) return left - right;
    return a._id < b._id ? -1 : 1;
  });
}

/**
 * A throwaway object URL so the pending bubble shows the actual picture while it
 * uploads, rather than a grey placeholder.
 *
 * Guarded on the method, not just on `URL`: the constructor exists in every
 * environment this runs in, including jsdom, but `createObjectURL` does not.
 * A preview is a nicety, so its absence degrades to no thumbnail rather than
 * failing the send.
 */
function buildLocalPreview(file: File, isVideo: boolean): IMessageFile {
  const canCreateUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';

  return {
    _id: `local-${file.name}`,
    mimeType: file.type,
    name: file.name,
    url: canCreateUrl ? URL.createObjectURL(file) : undefined,
    type: isVideo ? 'video' : 'image'
  };
}

/**
 * Release a pending bubble's preview.
 *
 * An object URL pins its blob in memory until it is revoked, so a session that
 * sends a lot of photos would otherwise hold every one of them.
 */
function releasePreview(pending: IPendingMessage | undefined) {
  const url = pending?.files?.[0]?.url;
  if (!url || !url.startsWith('blob:')) return;
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

/** Turn a refused send into something worth showing the person who typed it. */
function resolveSendError(error: any): string {
  const status = error?.statusCode || error?.status;
  const message = error?.message || error?.data?.message;
  if (status === 403) return message || 'You can send one message until they reply.';
  return message || 'Message could not be sent.';
}

/**
 * History, pagination and sending for one conversation.
 *
 * Deliberately a hook rather than a second provider: both the sidebar thread and
 * the full page render the same conversation from the same shared domain state,
 * and each simply calls this with the id it is showing. Everything genuinely
 * shared — the conversation rows, unread totals, the socket subscription and the
 * de-duplication set — lives in MessageProvider, so two surfaces open on the
 * same thread stay consistent without talking to each other.
 */
export function useMessageThread(conversationId: string | null): UseMessageThreadResult {
  const {
    currentUserId,
    getConversation,
    markConversationRead,
    subscribeToMessages,
    rememberMessage
  } = useMessages();

  const [messages, setMessages] = useState<IMessage[]>([]);
  const [pending, setPending] = useState<IPendingMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(null);
  const [sending, setSending] = useState(false);
  // Permission as the last send reported it, which is fresher than the
  // conversation row until the row's socket update lands.
  const [localPermission, setLocalPermission] = useState<{
    canSend: boolean;
    awaitingReplyFrom: AwaitingReplyFrom;
    requestState: MessageRequestState | null;
  } | null>(null);

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const conversationIdRef = useRef<string | null>(conversationId);
  conversationIdRef.current = conversationId;

  const conversation = conversationId ? getConversation(conversationId) : undefined;

  /**
   * Insert a message in place, keyed on its id.
   *
   * The list is the single source of truth for what is on screen, so an
   * already-present id replaces rather than appends — that is what keeps the
   * API response and the socket echo of the same send from rendering twice.
   */
  const applyMessage = useCallback((message: IMessage) => {
    setMessages((current) => {
      const index = current.findIndex((item) => item._id === message._id);
      if (index !== -1) {
        const next = [...current];
        next[index] = message;
        return next;
      }
      return sortMessages([...current, message]);
    });
  }, []);

  const loadPage = useCallback(async (cursor: CursorInfo | null) => {
    const targetId = conversationIdRef.current;
    if (!targetId) return;
    if (cursor && loadingRef.current) return;

    loadingRef.current = true;
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await searchMessages(targetId, {
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor: cursor.id, lastCreatedAt: cursor.createdAt.toString() } : {})
      });
      // Discard a response for a conversation the user has since navigated away
      // from, or for a superseded request.
      if (requestId !== requestIdRef.current || conversationIdRef.current !== targetId) return;

      const page = response?.data || {};
      const incoming: IMessage[] = page.data || [];

      // The server returns newest first for the cursor to work; the thread
      // renders oldest first.
      incoming.forEach((message) => rememberMessage(message._id));

      setMessages((current) => {
        const merged = new Map(current.map((item) => [item._id, item]));
        incoming.forEach((item) => merged.set(item._id, item));
        return sortMessages([...merged.values()]);
      });
      setHasMore(Boolean(page.hasMore));
      setNextCursor(page.nextCursor || null);
    } catch {
      if (requestId === requestIdRef.current) setError('Messages could not be loaded.');
    } finally {
      if (requestId === requestIdRef.current) {
        loadingRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [rememberMessage]);

  // Reset and load whenever the thread changes. Without the reset, switching
  // conversations would briefly show the previous one's messages.
  useEffect(() => {
    setMessages([]);
    setPending((current) => {
      current.forEach(releasePreview);
      return [];
    });
    setHasMore(false);
    setNextCursor(null);
    setError(null);
    setLocalPermission(null);
    loadingRef.current = false;

    if (!conversationId) return;
    void loadPage(null);
    // Opening a thread is what marks it read — opening the workspace is not.
    void markConversationRead(conversationId);
  }, [conversationId, loadPage, markConversationRead]);

  /**
   * Apply arriving messages for this thread.
   *
   * Subscribed through the provider rather than to the socket directly, so the
   * number of socket handlers does not grow with the number of open surfaces.
   */
  useEffect(() => {
    if (!conversationId) return undefined;

    return subscribeToMessages((message) => {
      if (message.conversationId !== conversationIdRef.current) return;
      applyMessage(message);

      // A message arriving in the thread the user is currently reading is read
      // on arrival. Marking read is idempotent, so this cannot double-clear.
      if (message.senderId !== currentUserId) {
        void markConversationRead(message.conversationId);
      }
    });
  }, [applyMessage, conversationId, currentUserId, markConversationRead, subscribeToMessages]);

  const loadOlder = useCallback(() => {
    if (loadingRef.current || !hasMore || !nextCursor) return;
    void loadPage(nextCursor);
  }, [hasMore, loadPage, nextCursor]);

  const retry = useCallback(() => {
    void loadPage(null);
  }, [loadPage]);

  const dismissPending = useCallback((localId: string) => {
    setPending((current) => {
      releasePreview(current.find((item) => item.localId === localId));
      return current.filter((item) => item.localId !== localId);
    });
  }, []);

  const updatePending = useCallback((localId: string, patch: Partial<IPendingMessage>) => {
    setPending((current) => current.map((item) => (
      item.localId === localId ? { ...item, ...patch } : item
    )));
  }, []);

  /**
   * Send one message.
   *
   * A local bubble appears immediately so the thread feels responsive, and is
   * removed once the confirmed message is in the list. A failed send keeps its
   * bubble in a `failed` state rather than vanishing — silently dropping what
   * somebody typed is worse than showing them it did not go.
   *
   * Media uploads first and the message is only created once the file has an id.
   * That ordering is deliberate: a message row pointing at an upload that never
   * completed would render as a permanently broken bubble.
   */
  const send = useCallback(async ({ text, file }: { text: string; file?: File | null }) => {
    const targetId = conversationIdRef.current;
    if (!targetId) return false;

    const trimmed = (text || '').trim();
    if (!trimmed && !file) return false;

    const localId = nextLocalId();
    const isVideo = Boolean(file && file.type.startsWith('video'));
    setPending((current) => [...current, {
      localId,
      conversationId: targetId,
      type: file ? (isVideo ? MESSAGE_TYPE.VIDEO : MESSAGE_TYPE.IMAGE) : MESSAGE_TYPE.TEXT,
      text: trimmed,
      senderId: currentUserId || '',
      createdAt: new Date().toISOString(),
      status: file ? 'uploading' : 'sending',
      progress: file ? 0 : undefined,
      files: file ? [buildLocalPreview(file, isVideo)] : []
    }]);
    setSending(true);

    try {
      let fileIds: string[] | undefined;
      if (file) {
        const upload = isVideo
          ? await uploadMessageVideo(file, (progress) => {
            updatePending(localId, { progress: progress.percentage ?? 0 });
          })
          : await uploadMessagePhoto(file, (progress) => {
            updatePending(localId, { progress: progress.percentage ?? 0 });
          });
        fileIds = [upload.fileId || upload._id];
        updatePending(localId, { status: 'sending', progress: 100 });
      }

      const response = await sendMessage(targetId, {
        text: trimmed,
        ...(fileIds ? { fileIds } : {})
      });

      const created: IMessage | undefined = response?.data?.message;
      if (created?._id) {
        // Remembered before it is applied, so the socket echo of this same
        // message is recognised as already seen and ignored.
        rememberMessage(created._id);
        applyMessage(created);
      }
      setLocalPermission({
        canSend: Boolean(response?.data?.canSend),
        awaitingReplyFrom: response?.data?.awaitingReplyFrom ?? null,
        // The send that answers a request is what accepts it, so this response
        // is the sender's first news that the thread is now unrestricted.
        requestState: response?.data?.requestState ?? null
      });
      dismissPending(localId);
      return true;
    } catch (err: any) {
      updatePending(localId, {
        status: 'failed',
        error: resolveSendError(err)
      });
      return false;
    } finally {
      setSending(false);
    }
  }, [applyMessage, currentUserId, dismissPending, rememberMessage, updatePending]);

  const retryPending = useCallback(async (localId: string) => {
    const target = pending.find((item) => item.localId === localId);
    if (!target) return false;
    // Media cannot be retried from here: the File object is gone once the
    // composer cleared it, so the user re-picks rather than being shown a retry
    // that silently sends a message without its attachment.
    if (target.type !== MESSAGE_TYPE.TEXT) return false;

    dismissPending(localId);
    return send({ text: target.text });
  }, [dismissPending, pending, send]);

  const permission = useMemo(() => {
    if (localPermission) return localPermission;
    return {
      canSend: conversation?.canSend ?? true,
      awaitingReplyFrom: conversation?.awaitingReplyFrom ?? null,
      requestState: conversation?.requestState ?? null
    };
  }, [
    conversation?.awaitingReplyFrom,
    conversation?.canSend,
    conversation?.requestState,
    localPermission
  ]);

  // A conversation update from the socket is newer than whatever the last send
  // reported, so it supersedes the local snapshot.
  useEffect(() => {
    setLocalPermission(null);
  }, [conversation?.awaitingReplyFrom, conversation?.canSend, conversation?.requestState]);

  return {
    messages,
    pending,
    loading,
    loadingMore,
    error,
    hasMore,
    sending,
    canSend: permission.canSend,
    awaitingReplyFrom: permission.awaitingReplyFrom,
    requestState: permission.requestState,
    loadOlder,
    retry,
    send,
    dismissPending,
    retryPending
  };
}
