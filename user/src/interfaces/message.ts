import type { IUser } from './user';

/**
 * Message content types. Mirrors MESSAGE_TYPES in the API.
 */
export const MESSAGE_TYPE = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video'
} as const;

export type MessageType = typeof MESSAGE_TYPE[keyof typeof MESSAGE_TYPE];

/** A resolved attachment on a message. */
export interface IMessageFile {
  _id: string;
  type?: string;
  name?: string;
  mimeType?: string;
  url?: string;
  /**
   * Intrinsic dimensions, used to reserve a media bubble's aspect ratio before
   * the file loads so an arriving photo does not shove the thread's scroll.
   */
  width?: number;
  height?: number;
  duration?: number;
  thumbnails?: string[];
  status?: string;
  processingStatus?: string;
}

export interface IMessage {
  _id: string;
  conversationId: string;
  type: MessageType | string;
  text: string;
  senderId: string;
  fileIds?: string[];
  files?: IMessageFile[];
  createdAt: string;
  updatedAt?: string;
}

/**
 * A message that exists only on this client until the server confirms it.
 *
 * Kept as a distinct shape rather than a flag on `IMessage` so nothing can
 * accidentally treat a local id as a server id — de-duplication against socket
 * echoes keys on the server `_id`, and a pending bubble has none yet.
 */
export interface IPendingMessage {
  /** Local-only identity, used solely to reconcile or remove this bubble. */
  localId: string;
  conversationId: string;
  type: MessageType | string;
  text: string;
  senderId: string;
  files?: IMessageFile[];
  createdAt: string;
  status: 'uploading' | 'sending' | 'failed';
  /** Upload progress, 0-100, while an attachment is transferring. */
  progress?: number;
  error?: string;
}

/** Which participant currently owes a reply, from the reader's point of view. */
export type AwaitingReplyFrom = 'me' | 'them' | null;

/**
 * Where a conversation's message request stands.
 *
 * `mutual` and `accepted` both mean "send freely", but for different reasons:
 * mutual freedom disappears the moment either side unfollows, while an accepted
 * request survives until the pair's follow state changes.
 */
export type MessageRequestState = 'mutual' | 'accepted' | 'waiting' | 'idle';

export interface IConversation {
  _id: string;
  recipientIds: string[];
  /** The other person in the conversation. */
  participant?: Partial<IUser>;
  lastMessage: string;
  lastMessageType: string | null;
  lastSenderId: string | null;
  lastMessageCreatedAt: string | null;
  /** This reader's unread count. Server-authoritative. */
  unreadCount: number;
  isMutualFollow: boolean;
  /**
   * Whether the composer should be offered. Advisory only — the server decides
   * again on send, because the follow relation can change in between.
   */
  canSend: boolean;
  awaitingReplyFrom: AwaitingReplyFrom;
  requestState: MessageRequestState;
  restrictionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Authoritative unread totals driving the header indicator. */
export interface IMessageUnreadTotals {
  totalUnreadMessages: number;
  totalUnreadConversations: number;
}

/** Socket event names. Mirrors MESSAGE_SOCKET_EVENTS in the API. */
export const MESSAGE_SOCKET_EVENT = {
  CREATED: 'message:created',
  CONVERSATION_UPDATED: 'conversation:updated',
  UNREAD_UPDATED: 'message:unread-updated',
  READ: 'message:read'
} as const;
