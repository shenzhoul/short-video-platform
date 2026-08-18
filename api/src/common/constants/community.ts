// ===== SOCKET CONSTANTS =====

/**
 * Socket connection channels
 * Channels for tracking user socket connections
 */
export const SOCKET_CHANNELS = {
  /** User socket connection events */
  USER_CONNECTED: 'SOCKET_CHANNELS.USER_CONNECTED',
  /** Creator socket connection events */
  CREATOR_CONNECTED: 'SOCKET_CHANNELS.CREATOR_CONNECTED'
} as const;

/**
 * Socket event types
 * Events that can occur on socket connections
 */
export const SOCKET_EVENTS = {
  /** User connected to socket */
  CONNECTED: 'connected',
  /** User disconnected from socket */
  DISCONNECTED: 'disconnected'
} as const;

/**
 * Socket room identifiers
 * Global socket rooms for broadcasting
 */
export const SOCKET_ROOMS = {
  /** Global room for platform-wide events */
  GLOBAL: 'GLOBAL_ROOM'
} as const;

/**
 * Comment-related event channels
 * Socket/queue channels for comment events
 */
export const COMMENT_CHANNELS = {
  /** Comment events channel */
  COMMENT: 'COMMENT_CHANNELS.COMMENT'
} as const;

/**
 * Comment object types
 * Defines what types of content can be commented on
 */
export const COMMENT_OBJECT_TYPES = {
  /** Comments on social posts */
  POST: 'post',
  /** Replies to other comments */
  COMMENT: 'comment',
} as const;

/**
 * Comment pagination constants
 * Defines limits for traditional offset-based pagination
 */
export const COMMENT_PAGINATION = {
  /** Maximum offset allowed for traditional pagination */
  MAX_OFFSET: 2000,
  /** Default limit for comment queries */
  DEFAULT_LIMIT: 10,
  /** Maximum limit for comment queries */
  MAX_LIMIT: 50
} as const;

// ===== REACTION CONSTANTS =====

/**
 * Available reaction types
 * Different ways users can react to content
 */
export const REACTION_TYPES = {
  /** Like reaction */
  LIKE: 'like',
  /** One-way creator follow relationship */
  FOLLOW: 'follow',
  /**
   * Record that a user shared a post.
   *
   * Sharing itself stays a client-side link copy / native share. This row only
   * records that it happened so the post owner can be notified. It is written
   * through the idempotent `ReactionService.create`, and there is no unshare,
   * so a given user shares a given post at most once.
   */
  SHARE: 'share'
} as const;

/**
 * Reaction-related event channels
 * Socket/queue channels for reaction events
 */
export const REACTION_CHANNELS = {
  /** Reaction events channel */
  REACTION: 'REACTION_CHANNELS.REACTION'
} as const;

/**
 * Reaction target types
 * Defines what types of content can be reacted to
 */
export const REACTION_TARGET_TYPES = {
  /** Reactions on comments */
  COMMENT: 'comment',
  /** Reactions on social posts */
  POST: 'post',
  /** One-way follows of creator profiles */
  CREATOR: 'creator',
} as const;

// ===== NOTIFICATION CONSTANTS =====

/**
 * Interaction notification types.
 *
 * These are the semantic identifiers persisted on the notification document.
 * Presentation (message text, icon, navigation target) is derived from the type
 * at render time rather than stored, so wording and routes can change without a
 * data migration.
 */
export const NOTIFICATION_TYPES = {
  /** Someone liked the recipient's post. Aggregated per post. */
  POST_LIKE: 'post_like',
  /** Someone liked the recipient's comment. Aggregated per comment. */
  COMMENT_LIKE: 'comment_like',
  /** Someone commented on the recipient's post. Individual, then adaptive. */
  POST_COMMENT: 'post_comment',
  /** Someone replied to the recipient's comment. Individual, then adaptive. */
  COMMENT_REPLY: 'comment_reply',
  /** The recipient was @-mentioned in a post. */
  POST_MENTION: 'post_mention',
  /** The recipient was @-mentioned in a comment. */
  COMMENT_MENTION: 'comment_mention',
  /** Someone started following the recipient */
  FOLLOW: 'follow'
} as const;

/**
 * `post_share` is deliberately absent.
 *
 * Sharing will deliver the post through Message/DM, where the recipient already
 * gets a new-message indication. An interaction notification on top of that
 * would be redundant, so share contributes only to statistics.
 */

export type NotificationType = typeof NOTIFICATION_TYPES[keyof typeof NOTIFICATION_TYPES];

export const NOTIFICATION_TYPE_LIST = Object.values(NOTIFICATION_TYPES);

/** User-facing notification groups used by the panel filter. */
export const NOTIFICATION_FILTERS = {
  FOLLOWERS: 'followers',
  MENTIONS: 'mentions',
  COMMENTS: 'comments',
  LIKES: 'likes'
} as const;

export type NotificationFilter = typeof NOTIFICATION_FILTERS[keyof typeof NOTIFICATION_FILTERS];

/** Maps one panel category to every persisted type it contains. */
export const NOTIFICATION_FILTER_TYPE_MAP: Record<NotificationFilter, NotificationType[]> = {
  [NOTIFICATION_FILTERS.FOLLOWERS]: [NOTIFICATION_TYPES.FOLLOW],
  [NOTIFICATION_FILTERS.MENTIONS]: [
    NOTIFICATION_TYPES.POST_MENTION,
    NOTIFICATION_TYPES.COMMENT_MENTION
  ],
  [NOTIFICATION_FILTERS.COMMENTS]: [
    NOTIFICATION_TYPES.POST_COMMENT,
    NOTIFICATION_TYPES.COMMENT_REPLY
  ],
  [NOTIFICATION_FILTERS.LIKES]: [
    NOTIFICATION_TYPES.POST_LIKE,
    NOTIFICATION_TYPES.COMMENT_LIKE
  ]
};

export const NOTIFICATION_FILTER_LIST = Object.values(NOTIFICATION_FILTERS);

/**
 * Tunables for the notification lifecycle policies.
 *
 * Centralised so the thresholds are never duplicated as literals across
 * listeners and services.
 */
export const NOTIFICATION_POLICY = {
  /**
   * Number of comment/reply notifications for one recipient and resource before
   * further activity collapses into a single aggregate row. The event that
   * crosses this threshold starts the aggregate and is the only event it counts;
   * the individual rows created before it stay as history.
   */
  COMMENT_AGGREGATION_THRESHOLD: 5,

  /**
   * How long a follow notification stays quiet after being delivered. Follow and
   * unfollow can be toggled freely; only the notification is throttled, never the
   * relationship itself.
   */
  FOLLOW_COOLDOWN_MS: 5 * 60 * 1000
} as const;

/**
 * Identity of a notification group, per type.
 *
 * Each type decides what "the same notification" means: likes group by the
 * resource, mentions are unique per resource, follows are reusable per actor,
 * and comments have both an individual and an aggregate form. Persisting this as
 * one string keeps a single unique index able to express all of them.
 */
export const NOTIFICATION_GROUP_KEYS = {
  postLike: (postId: string) => `post_like:${postId}`,
  commentLike: (commentId: string) => `comment_like:${commentId}`,
  postMention: (postId: string) => `post_mention:${postId}`,
  commentMention: (commentId: string) => `comment_mention:${commentId}`,
  follow: (actorId: string) => `follow:${actorId}`,
  postComment: (commentId: string) => `post_comment:${commentId}`,
  postCommentAggregate: (postId: string) => `post_comment_agg:${postId}`,
  commentReply: (replyId: string) => `comment_reply:${replyId}`,
  commentReplyAggregate: (threadId: string) => `comment_reply_agg:${threadId}`
} as const;

/**
 * Notification event channel.
 *
 * Creation and delivery are deliberately separated: domain listeners create the
 * notification and publish here, and only the delivery listener subscribes. A
 * failed socket emit therefore retries delivery alone and can never re-run
 * creation, which would resurface an already-read notification.
 */
export const NOTIFICATION_CHANNELS = {
  NOTIFICATION: 'NOTIFICATION_CHANNELS.NOTIFICATION'
} as const;

/** Socket event name used to push a new notification to its recipient. */
export const NOTIFICATION_SOCKET_EVENTS = {
  CREATED: 'notification:created',
  /**
   * An existing notification's rendered content changed — today, because the
   * comment it quotes was deleted.
   *
   * Deliberately distinct from CREATED: this is not arriving activity, so the
   * client patches the row in place and leaves read state, ordering and the
   * unread badge alone.
   */
  UPDATED: 'notification:updated'
} as const;

/**
 * Live Post Detail rooms.
 *
 * A room per post, joined only while a viewer actually has that post open, so
 * live detail traffic reaches the people looking at it rather than everyone
 * connected.
 *
 * Deliberately separate from notification delivery: a notification is addressed
 * to one recipient's user sockets, while these events describe shared state and
 * go to whoever is watching. A notification must never be emitted into a post
 * room — the two have different audiences and different payloads.
 */
export const POST_ROOM = {
  /** Room name for one post's viewers. */
  name: (postId: string) => `post:${postId}`,
  /** Client -> server: start/stop receiving one post's live events. */
  JOIN: 'post/join',
  LEAVE: 'post/leave'
} as const;

/** Server -> post room events. */
export const POST_ROOM_EVENTS = {
  /** A new top-level comment was created on the post. */
  COMMENT_CREATED: 'post:comment_created',
  /** A new reply was created inside one of the post's threads. */
  REPLY_CREATED: 'post:reply_created',
  /** A comment or reply was removed. */
  COMMENT_DELETED: 'post:comment_deleted',
  /** Coalesced absolute snapshot of the post's shared counters. */
  STATS_UPDATED: 'post:stats_updated'
} as const;

/**
 * How shared post counters are coalesced for the live rooms.
 *
 * Centralised rather than inlined so the flush rate is one decision in one
 * place: it is the sole thing bounding broadcast volume on a viral post.
 */
export const POST_STATS_POLICY = {
  /**
   * Milliseconds between snapshot flushes. At 500ms a post emits at most two
   * snapshots a second no matter how many likes it takes, which still reads as
   * live while keeping fan-out flat under load.
   */
  FLUSH_INTERVAL_MS: 500,

  /**
   * Ceiling on posts drained per flush, so one enormous backlog cannot turn a
   * single tick into an unbounded burst of emits. Anything above the cap stays
   * in the set and is picked up by the next flush.
   */
  MAX_POSTS_PER_FLUSH: 200
} as const;

/**
 * Promotion rule for the single "hot" comment shown above the canonical list.
 *
 * Deliberately explainable rather than a score: a comment must clear a real
 * engagement bar before it is promoted, and likes are already an authoritative
 * counter. No reply weighting and no time decay in v1.
 */
export const HOT_COMMENT_MIN_LIKES = 3;
