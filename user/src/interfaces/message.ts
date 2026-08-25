import type { IUser } from './user';

/**
 * Message content types. Mirrors MESSAGE_TYPES in the API.
 */
export const MESSAGE_TYPE = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  /** A shared post. Carries `postId` and a server-resolved `sharedPost` card. */
  POST: 'post',
  /** A notice the system placed in the thread. Nobody sent it. */
  SYSTEM: 'system'
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

/**
 * The post preview inside a shared-post bubble.
 *
 * Resolved by the server on every read, never stored on the message: a post that
 * is deleted or hidden must stop rendering in history too, so the card can
 * arrive unavailable at any time and the bubble has to handle it.
 */
export interface ISharedPost {
  postId: string;
  available: boolean;
  type?: string | null;
  thumbnailUrl?: string | null;
  caption?: string | null;
  isVideo?: boolean;
  isMultiImage?: boolean;
  author?: Partial<IUser> | null;
  unavailableReason?: 'deleted' | 'not_accessible' | null;
}

export interface IMessage {
  _id: string;
  conversationId: string;
  type: MessageType | string;
  text: string;
  senderId: string;
  fileIds?: string[];
  files?: IMessageFile[];
  /** Set on `post` messages. The card itself is `sharedPost`. */
  postId?: string | null;
  sharedPost?: ISharedPost | null;
  /**
   * Which notice this is, on a `system` message.
   *
   * Present so an unrecognised notice can be skipped rather than drawn as an
   * empty bubble. The wording arrives in `text`, already translated.
   */
  systemEvent?: string | null;
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
 * Where a conversation stands, in the server's evaluation order.
 *
 * `blocked` and `restricted` sit above everything: a flag is not undone by a
 * follow, by an accepted request, or by the other person replying.
 *
 * `mutual` and `accepted` both mean "send freely", for different reasons.
 * Mutual freedom disappears the moment either side unfollows; an accepted
 * request is durable and survives it, because agreeing to talk is not the same
 * act as following someone.
 */
export type MessageRequestState =
  | 'blocked'
  | 'restricted'
  | 'accepted'
  | 'mutual'
  | 'waiting'
  | 'idle';

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
  /**
   * The viewer's own flags on the other person, driving Unblock / Unrestrict.
   *
   * Only this direction exists: the server never reports that somebody else
   * restricted you, because a restriction is only useful while unconfirmed.
   */
  blockedByMe?: boolean;
  restrictedByMe?: boolean;
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
