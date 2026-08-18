/**
 * Interaction notification types.
 *
 * Mirrors NOTIFICATION_TYPES in the API. The value is the only thing persisted;
 * message, icon and navigation target are derived from it on the client, so
 * wording and routes can change without touching stored notifications.
 */
export const NOTIFICATION_TYPE = {
  POST_LIKE: 'post_like',
  COMMENT_LIKE: 'comment_like',
  POST_COMMENT: 'post_comment',
  COMMENT_REPLY: 'comment_reply',
  POST_MENTION: 'post_mention',
  COMMENT_MENTION: 'comment_mention',
  FOLLOW: 'follow'
} as const;

export type NotificationType = typeof NOTIFICATION_TYPE[keyof typeof NOTIFICATION_TYPE];

export const NOTIFICATION_FILTER = {
  FOLLOWERS: 'followers',
  MENTIONS: 'mentions',
  COMMENTS: 'comments',
  LIKES: 'likes'
} as const;

export type NotificationFilter = typeof NOTIFICATION_FILTER[keyof typeof NOTIFICATION_FILTER];

export const NOTIFICATION_FILTER_TYPES: Record<NotificationFilter, NotificationType[]> = {
  [NOTIFICATION_FILTER.FOLLOWERS]: [NOTIFICATION_TYPE.FOLLOW],
  [NOTIFICATION_FILTER.MENTIONS]: [
    NOTIFICATION_TYPE.POST_MENTION,
    NOTIFICATION_TYPE.COMMENT_MENTION
  ],
  [NOTIFICATION_FILTER.COMMENTS]: [
    NOTIFICATION_TYPE.POST_COMMENT,
    NOTIFICATION_TYPE.COMMENT_REPLY
  ],
  [NOTIFICATION_FILTER.LIKES]: [
    NOTIFICATION_TYPE.POST_LIKE,
    NOTIFICATION_TYPE.COMMENT_LIKE
  ]
};

/** Trimmed identity of the person whose action produced the notification. */
export interface INotificationActor {
  _id: string;
  username?: string;
  name?: string;
  avatar?: string;
}

export interface INotification {
  _id: string;
  type: NotificationType;
  actorId: string;
  actor?: INotificationActor;
  postId?: string | null;
  commentId?: string | null;
  /** Resolved post cover, present for post-scoped types when the post has media. */
  postThumbnail?: string | null;
  /** Only meaningful for FOLLOW rows, where the panel renders a follow control. */
  isActorFollowed?: boolean;
  /**
   * Set on comment-scoped rows whose comment has since been deleted.
   *
   * The row survives — the interaction still happened — but the quoted content
   * is gone, so it renders a removed-comment notice and still opens the
   * containing post.
   */
  commentDeleted?: boolean;
  /**
   * Current text of the comment this row is about, resolved server-side from the
   * live comment. Absent once that comment is deleted, when `commentDeleted`
   * carries the explanation instead.
   */
  commentPreview?: string | null;
  isAggregate?: boolean;
  activityCount?: number;
  actorCount?: number;
  /**
   * Newest event folded into an aggregate row.
   *
   * A comment id for the adaptive comment types, a **reaction** id for the like
   * aggregates — so it must never be treated as a comment reference without
   * checking `type` first.
   */
  lastEventId?: string | null;
  read: boolean;
  readAt?: string | null;
  /** Time of the most recent occurrence; the list is ordered and paged by this. */
  lastActivityAt: string;
  createdAt: string;
}
