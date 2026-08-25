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
  /**
   * A new reply was created inside one of the post's threads.
   *
   * Carries the parent id and the parent's reply count, never the reply itself.
   * Everyone watching the post is told a thread grew — which is all the
   * collapsed "Expand N replies" control needs — while the reply body goes only
   * to {@link COMMENT_ROOM_EVENTS.REPLY_CREATED}, in the thread room, where
   * somebody is actually reading it.
   */
  REPLY_CREATED: 'post:reply_created',
  /** A comment or reply was removed. */
  COMMENT_DELETED: 'post:comment_deleted',
  /** Coalesced absolute snapshot of the post's shared counters. */
  STATS_UPDATED: 'post:stats_updated',
  /**
   * Coalesced absolute snapshot of one comment's own counters.
   *
   * One event for both counters rather than a separate like event and reply
   * event: they are coalesced through the same set, so a comment taking likes
   * and replies at once costs one frame instead of two, and the client has a
   * single place that applies counters by id.
   */
  COMMENT_STATS_UPDATED: 'post:comment_stats_updated'
} as const;

/**
 * Server -> a single user's own sockets.
 *
 * Not a room in the Socket.IO sense: `SocketUserService.emitToUsers` addresses
 * every socket that user currently has open, which is what makes a count land on
 * all of their tabs at once.
 */
export const USER_STATS_EVENTS = {
  /**
   * Coalesced absolute snapshot of one user's follow counters.
   *
   * Sent only to the user the numbers belong to. Following counts are not
   * public live data — a stranger watching a profile has no business receiving a
   * frame every time that person gains a follower — so this is deliberately
   * per-user rather than a profile room.
   */
  FOLLOW_STATS_UPDATED: 'user:follow_stats_updated'
} as const;

/**
 * The room carrying one comment thread's replies.
 *
 * Separate from the post room on purpose. A post can hold thousands of threads,
 * and a viewer is reading at most a handful of them; sending every reply on the
 * post to everyone watching it would put the bulk of the traffic in front of
 * people with the thread collapsed. Joining is therefore scoped to the threads
 * actually expanded, and leaving is tied to collapsing them.
 */
export const COMMENT_ROOM = {
  /** Room name for the viewers of one expanded thread. */
  name: (commentId: string) => `comment:${commentId}:replies`,
  /** Client -> server: start/stop receiving one thread's replies. */
  JOIN: 'comment/join',
  LEAVE: 'comment/leave'
} as const;

/** Server -> comment thread room events. */
export const COMMENT_ROOM_EVENTS = {
  /** A new reply, in full, for the thread rooms that have it open. */
  REPLY_CREATED: 'comment:reply_created'
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
  MAX_POSTS_PER_FLUSH: 200,

  /**
   * Ceiling on comments drained per flush. Separate from the post ceiling
   * because one post can have many comments moving at once, so the two sets
   * drain at genuinely different volumes.
   */
  MAX_COMMENTS_PER_FLUSH: 500,

  /**
   * Ceiling on users drained per follow-stats flush. Lower than the others: each
   * one costs two counting queries, and the audience for each snapshot is a
   * single person's own sessions rather than a room.
   */
  MAX_USERS_PER_FOLLOW_FLUSH: 200
} as const;

/**
 * Promotion rule for the single "hot" comment shown above the canonical list.
 *
 * Deliberately explainable rather than a score: a comment must clear a real
 * engagement bar before it is promoted, and likes are already an authoritative
 * counter. No reply weighting and no time decay in v1.
 */
export const HOT_COMMENT_MIN_LIKES = 3;

// ===== POST SHARE CONSTANTS =====

/** Queue channel used to make a share's counter update durable. */
export const SHARE_CHANNELS = {
  SHARE: 'SHARE_CHANNELS.SHARE'
} as const;

/**
 * Share domain events.
 *
 * `record-requested` is an outbox entry, not a notification: the shared message
 * already exists, and this says the distinct-sharer row still has to be written.
 * Published only when the inline attempt failed, so the happy path costs no job.
 */
export const SHARE_EVENTS = {
  RECORD_REQUESTED: 'share:record-requested'
} as const;

// ===== USER RELATIONSHIP CONSTANTS =====

/**
 * One-way flags a user sets on another user.
 *
 * Deliberately separate from follows. A follow is about seeing someone's
 * content; these are about what somebody may send you, and conflating them is
 * what made "unfollow to stop the messages" the only tool available.
 *
 * - `block`    — hard stop, symmetric in effect: neither may message the other.
 * - `restrict` — one-way, quiet: the restricted person cannot send any more.
 *
 * `mute` is intentionally absent; nothing in the product produces it yet.
 */
/** Queue channel carrying block/restrict changes for other domains to react to. */
export const RELATIONSHIP_CHANNELS = {
  RELATIONSHIP: 'RELATIONSHIP_CHANNELS.RELATIONSHIP'
} as const;

/**
 * Relationship domain events.
 *
 * Only the clearing of a flag is published. Setting one takes permissions away,
 * and nothing needs to react to that; lifting one can make an announcement true
 * that was refused while the flag was up.
 */
export const RELATIONSHIP_EVENTS = {
  CLEARED: 'relationship:cleared'
} as const;

export const RELATIONSHIP_TYPES = {
  BLOCK: 'block',
  RESTRICT: 'restrict'
} as const;

export const RELATIONSHIP_TYPE_LIST = Object.values(RELATIONSHIP_TYPES);

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[keyof typeof RELATIONSHIP_TYPES];

// ===== DIRECT MESSAGE CONSTANTS =====

/**
 * Message content types supported by the direct-message composer.
 *
 * Deliberately narrow. Audio, stickers and system messages exist in older
 * codebases but nothing in this product produces them, and an enum value with
 * no producer is a branch every renderer has to handle for no reason.
 */
export const MESSAGE_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  /**
   * A post shared into the conversation.
   *
   * Carries only `postId`. The card is rendered from the post read back at
   * request time, never from a copy taken when it was shared: a post that was
   * deleted, hidden or whose author was suspended must stop rendering, and a
   * snapshot in the message would keep showing content that has been withdrawn.
   */
  POST: 'post',
  /**
   * A notice the system itself put in the thread — nobody sent it.
   *
   * Carries `systemEvent` rather than text, so the wording stays translatable
   * and is resolved per reader instead of frozen in whichever language the
   * event happened to fire in.
   */
  SYSTEM: 'system'
} as const;

export const MESSAGE_TYPE_LIST = Object.values(MESSAGE_TYPES);

/**
 * The types the composer may ask for.
 *
 * `post` is excluded on purpose: a shared post is created by the share endpoint,
 * which resolves the post and checks that both people may see it. Letting the
 * composer name the type would allow a message to claim to be a shared post
 * while carrying no post at all.
 */
/**
 * Notices the system can place in a conversation.
 *
 * Deliberately its own field rather than one message type per event: the
 * renderer branches on `type === 'system'` once, and a future notice is a new
 * value here instead of a new branch everywhere a message is drawn.
 */
export const MESSAGE_SYSTEM_EVENTS = {
  /** The two participants now follow each other, so the thread is open. */
  MUTUAL_FOLLOW: 'mutual_follow'
} as const;

export const MESSAGE_SYSTEM_EVENT_LIST = Object.values(MESSAGE_SYSTEM_EVENTS);

export type MessageSystemEvent =
  (typeof MESSAGE_SYSTEM_EVENTS)[keyof typeof MESSAGE_SYSTEM_EVENTS];

export const MESSAGE_COMPOSER_TYPE_LIST = [
  MESSAGE_TYPES.TEXT,
  MESSAGE_TYPES.IMAGE,
  MESSAGE_TYPES.VIDEO
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

/** Queue channel carrying message domain events for asynchronous fan-out. */
export const MESSAGE_CHANNELS = {
  MESSAGE: 'MESSAGE_CHANNELS.MESSAGE'
} as const;

/** Message domain events published on {@link MESSAGE_CHANNELS}. */
export const MESSAGE_EVENTS = {
  CREATED: 'message:created',
  /**
   * A system notice was added to a conversation.
   *
   * Separate from `CREATED` because it has no sender: the delivery path for a
   * user's message reads one, and quietly reusing it would mean inventing a
   * sender for something nobody sent.
   */
  SYSTEM_CREATED: 'message:system-created',
  READ: 'message:read'
} as const;

/**
 * Socket events pushed to a participant's own sockets.
 *
 * Every one of these is addressed to specific users, never broadcast: a direct
 * message and its unread counters are private to the two people in the
 * conversation.
 */
export const MESSAGE_SOCKET_EVENTS = {
  /** A new message, delivered to both participants so multi-tab senders stay in sync. */
  CREATED: 'message:created',
  /** The recipient's view of a conversation changed: preview, order, unread, permission. */
  CONVERSATION_UPDATED: 'conversation:updated',
  /** Authoritative unread totals for the header indicator. */
  UNREAD_UPDATED: 'message:unread-updated',
  /** A conversation was read, so the reader's other tabs can clear it too. */
  READ: 'message:read'
} as const;

/**
 * Preview length stored on the conversation.
 *
 * Long enough to fill a list row at the workspace's width and short enough that
 * the conversation list never pays for message bodies it will not show.
 */
export const MESSAGE_PREVIEW_LENGTH = 120;

/** Upper bound on a single message's text, matching the schema's `maxlength`. */
export const MESSAGE_TEXT_MAX_LENGTH = 5000;

/** Attachments allowed on one message. */
export const MESSAGE_MAX_ATTACHMENTS = 1;
