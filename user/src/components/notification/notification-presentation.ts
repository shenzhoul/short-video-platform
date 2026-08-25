import { INotification, NOTIFICATION_TYPE, NotificationType } from '@interfaces/notification';

/**
 * How one notification type is presented and where it leads.
 *
 * This module is the only place notification types are branched on. Components
 * read the resolved result, so adding a type means adding one entry here rather
 * than editing every component that renders a notification.
 */
/**
 * Which badge a row wears, if any.
 *
 * A small vocabulary of kinds rather than one per type, because several types
 * share a badge — a post like and a comment like are both likes. Components map
 * the kind to a component, so notification types stay branched on in this file
 * alone.
 *
 * Only the three interaction families carry a badge. A follow says everything it
 * needs to in its wording and its follow-back control, and an unrecognised type
 * has nothing honest to draw, so both resolve to `null` and the badge is left
 * off the avatar entirely rather than rendered as an empty disc.
 */
export type NotificationIconKind = 'like' | 'comment' | 'mention';

interface NotificationPresentation {
  /** Sentence shown under the actor's name. */
  message: string;
  /** Badge drawn over the actor's avatar, or null for a bare avatar. */
  icon: NotificationIconKind | null;
  /** Whether the row shows the related post's cover. */
  showThumbnail: boolean;
  /** Whether the row offers a follow control for the actor. */
  showFollowAction: boolean;
  /**
   * Notice shown when the quoted comment no longer exists. Null for everything
   * else, so the row only grows a second line when there is something to say.
   */
  deletedNotice: string | null;
  /**
   * The referenced comment's current text, quoted under the actor. Null when
   * there is nothing to quote — a follow, a post like, or a deleted comment,
   * where `deletedNotice` speaks instead.
   */
  commentPreview: string | null;
}

/** Wording for a comment that has been removed since the notification. */
const DELETED_COMMENT_NOTICE = 'This comment has been deleted.';

/**
 * Types whose subject is a comment rather than the post itself.
 *
 * Drives two behaviours that must agree: these open the post's Comments tab,
 * and only these can show a removed-comment notice.
 */
const COMMENT_SCOPED_TYPES: NotificationType[] = [
  NOTIFICATION_TYPE.POST_COMMENT,
  NOTIFICATION_TYPE.COMMENT_REPLY,
  NOTIFICATION_TYPE.COMMENT_MENTION,
  // A like on a comment is about that comment, not about the post it sits in.
  // Its `commentId` is the liked comment and is stable for the life of the
  // group — the group key is per-comment — so it deep-links like the others.
  // Its `lastEventId` is a *reaction* id, which is why the aggregate rule below
  // still excludes it.
  NOTIFICATION_TYPE.COMMENT_LIKE
];

export function isCommentScoped(notification: INotification): boolean {
  return COMMENT_SCOPED_TYPES.includes(notification.type);
}

/**
 * Types that quote the referenced comment under the actor's name.
 *
 * Narrower than the comment-scoped set: a like on your own comment quotes text
 * you wrote yourself, which tells you nothing you did not already know and
 * costs the row two lines. "liked your comment" plus the thumbnail is the whole
 * message; the comment itself is one click away.
 */
const QUOTED_TYPES: NotificationType[] = [
  NOTIFICATION_TYPE.POST_COMMENT,
  NOTIFICATION_TYPE.COMMENT_REPLY,
  NOTIFICATION_TYPE.COMMENT_MENTION
];

/**
 * Types whose aggregate rows fold *comments* in, so `lastEventId` is a comment.
 *
 * The like aggregates also carry `lastEventId`, but there it is a reaction id.
 * Treating that as a comment would deep-link to something that is not a
 * comment at all, which is why this list exists rather than a plain
 * `isAggregate` check.
 */
const ADAPTIVE_COMMENT_TYPES: NotificationType[] = [
  NOTIFICATION_TYPE.POST_COMMENT,
  NOTIFICATION_TYPE.COMMENT_REPLY
];

/**
 * The comment a row should focus, and what to fall back to.
 *
 * An individual row stands for one event, so its `commentId` is that event.
 * An aggregate row is different: `commentId` is written insert-only and stays
 * pinned to the comment that *created* the group, while `lastEventId` advances
 * with every event folded in. Reading `commentId` there would say "H and 2
 * others commented" and then open the comment H replaced — so the newest event
 * is preferred and the originating comment becomes the fallback.
 *
 * Only those two ids are retained by the model, so the fallback is a real
 * represented event rather than a guess.
 */
export function resolveTargetCommentIds(notification: INotification): {
  targetId: string | null;
  fallbackId: string | null;
} {
  const commentId = notification.commentId || null;

  const usesLastEvent = notification.isAggregate
    && ADAPTIVE_COMMENT_TYPES.includes(notification.type)
    && Boolean(notification.lastEventId);
  if (!usesLastEvent) return { targetId: commentId, fallbackId: null };

  const lastEventId = notification.lastEventId as string;
  return {
    targetId: lastEventId,
    // Only worth carrying when it names a different event.
    fallbackId: commentId && commentId !== lastEventId ? commentId : null
  };
}

/** The per-type wording. The comment-derived fields are resolved separately. */
type NotificationPresentationBase = Omit<
  NotificationPresentation, 'deletedNotice' | 'commentPreview'
>;

const PRESENTATION: Record<NotificationType, NotificationPresentationBase> = {
  [NOTIFICATION_TYPE.POST_LIKE]: {
    message: 'liked your post',
    icon: 'like',
    showThumbnail: true,
    showFollowAction: false
  },
  [NOTIFICATION_TYPE.COMMENT_LIKE]: {
    message: 'liked your comment',
    icon: 'like',
    showThumbnail: true,
    showFollowAction: false
  },
  [NOTIFICATION_TYPE.POST_COMMENT]: {
    message: 'commented on your post',
    icon: 'comment',
    showThumbnail: true,
    showFollowAction: false
  },
  [NOTIFICATION_TYPE.COMMENT_REPLY]: {
    message: 'replied to your comment',
    icon: 'comment',
    showThumbnail: true,
    showFollowAction: false
  },
  [NOTIFICATION_TYPE.POST_MENTION]: {
    message: 'mentioned you in a post',
    icon: 'mention',
    showThumbnail: true,
    showFollowAction: false
  },
  [NOTIFICATION_TYPE.COMMENT_MENTION]: {
    message: 'mentioned you in a comment',
    icon: 'mention',
    showThumbnail: true,
    showFollowAction: false
  },
  [NOTIFICATION_TYPE.FOLLOW]: {
    message: 'started following you',
    icon: null,
    showThumbnail: false,
    showFollowAction: true
  }
};

const FALLBACK: NotificationPresentationBase = {
  message: 'interacted with you',
  // Nothing is drawn for a type this build does not know: a wrong badge would
  // describe the interaction inaccurately, and an empty disc describes nothing.
  icon: null,
  showThumbnail: false,
  showFollowAction: false
};

/**
 * Resolve how a notification should read.
 *
 * Falls back to a neutral phrasing rather than rendering nothing, so a row
 * created by a newer backend type still appears instead of silently vanishing.
 */
export function resolveNotificationPresentation(notification: INotification): NotificationPresentation {
  const base = PRESENTATION[notification.type] || FALLBACK;
  // Only a comment-scoped row can lose its comment. The flag is ignored on any
  // other type so a stray value cannot put a comment notice on a follow.
  const deletedNotice = notification.commentDeleted && isCommentScoped(notification)
    ? DELETED_COMMENT_NOTICE
    : null;

  // A deleted comment has nothing left to show but the notice.
  const commentPreview = !deletedNotice && QUOTED_TYPES.includes(notification.type)
    ? notification.commentPreview || null
    : null;

  const actorCount = Math.max(1, notification.actorCount || 1);
  if (actorCount === 1) return { ...base, deletedNotice, commentPreview };

  const otherCount = actorCount - 1;
  return {
    ...base,
    deletedNotice,
    commentPreview,
    message: `and ${otherCount} other${otherCount === 1 ? '' : 's'} ${base.message}`
  };
}

/** Display name for the actor, tolerating partially populated records. */
export function resolveActorName(notification: INotification): string {
  return notification.actor?.name || notification.actor?.username || 'Someone';
}

/**
 * Where a notification navigates.
 *
 * Post-scoped types open the post through the `modal_id` search param, which is
 * how post detail is presented across the app — there is no standalone post
 * route. Comment and reply notifications resolve to the containing post because
 * the app has no per-comment deep link; the comment id is still carried on the
 * record so this can be tightened later without a data change.
 *
 * Returns null when the target cannot be resolved, and the row renders as
 * non-navigable rather than linking somewhere misleading.
 */
export function resolveNotificationTarget(notification: INotification): string | null {
  if (notification.type === NOTIFICATION_TYPE.FOLLOW) {
    const username = notification.actor?.username;
    return username ? `/${username}` : null;
  }

  if (!notification.postId) return null;

  if (!isCommentScoped(notification)) return `/?modal_id=${notification.postId}`;

  /**
   * A row whose subject is a comment opens the Comments tab *and* names the
   * exact comment, so a post with thousands of them still lands the reader on
   * the one they were told about.
   *
   * The id travels; the comment's fate does not. Whether it still exists is
   * resolved by the app from this id, never asserted by the link — a URL
   * claiming `commentDeleted` would be unverifiable state that a stale or
   * hand-edited link could lie about.
   *
   * Both params ride alongside the existing `modal_id` rather than introducing
   * a route, matching how post detail is already addressed.
   */
  const { targetId, fallbackId } = resolveTargetCommentIds(notification);
  const target = targetId ? `&target_comment_id=${targetId}` : '';
  // Present only for an aggregate whose newest event differs from the one that
  // opened the group. Its presence also tells the comment list that this row
  // stands for several events, so a deleted target must not be reported as
  // "the comment was deleted" while others may still exist.
  const fallback = fallbackId ? `&target_comment_fallback_id=${fallbackId}` : '';
  return `/?modal_id=${notification.postId}&modal_tab=comments${target}${fallback}`;
}
