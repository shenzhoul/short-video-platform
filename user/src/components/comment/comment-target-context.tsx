'use client';

import CommentItem from '@components/comment/comment-item';
import type { CommentTarget } from '@hooks/use-comment-target';
import { IComment } from '@interfaces/comment';
import { IUser } from '@interfaces/user';
import { FiX } from 'react-icons/fi';

interface CommentTargetContextProps {
  target: CommentTarget;
  user?: IUser;
  onReply?: (comment: any) => void;
  replyTargetId?: string;
  /** Leaves the contextual view and returns to the plain comment list. */
  onDismiss?: () => void;
  /**
   * Comment whose replies are currently open, owned by the wrapper and shared
   * with the canonical list.
   *
   * The context section shows a comment the list is hiding, so it needs the
   * same expansion state rather than a private copy — otherwise replying to the
   * target from the composer would expand a thread nobody can see.
   */
  expandedCommentId?: string | null;
  /** Opens or closes the target's replies. */
  onToggleReplies?: (commentId: string) => void;
  /** A reply just posted here, so it appears without refetching the thread. */
  createdReply?: IComment | null;
  postOwnerId?: string | null;
}

/**
 * The comment a notification pointed at, shown as navigation context.
 *
 * Deliberately its own section above the list rather than an entry inside it.
 * Prepending the target made it look like the newest or top-ranked comment when
 * it might be hours old and only surfaced because a notification was clicked —
 * the reader had no way to tell the difference. Keeping it outside the list
 * means the canonical ordering below is exactly what the server returned.
 *
 * Whatever the notification named, the card renders the **root** of that thread.
 * A reply is reached inside it, through the same expandable thread the list uses,
 * so there is one entity on screen rather than a copy that can drift from it.
 *
 * Styled with the `--overlay-*` tokens rather than the page's `--surface-*` /
 * `--text-*` ones. This card lives inside the Post Detail panel, which is dark in
 * both themes; page tokens flip, so in light mode they painted a near-white card
 * behind the panel's white text and the whole thing became unreadable.
 */
export default function CommentTargetContext({
  target,
  user,
  onReply,
  replyTargetId,
  onDismiss,
  expandedCommentId = null,
  onToggleReplies,
  createdReply,
  postOwnerId = null
}: CommentTargetContextProps) {
  // Nothing to show before resolution finishes, and nothing to show for an
  // aggregate whose retained ids are all gone — other represented comments may
  // still exist, so claiming a deletion would be wrong.
  if (target.status === 'idle' || target.status === 'resolving') return null;
  if (target.status === 'missing' && target.ambiguous) return null;

  const isDeleted = target.status === 'missing';

  return (
    <section
      aria-label="From your notification"
      data-testid="comment-target-context"
      className="mx-4 mb-3 shrink-0 rounded-xl border border-(--overlay-border-faint) bg-(--overlay-surface-soft) px-3 py-2.5"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[12px] leading-4 font-medium text-(--overlay-text-muted)">
          From your notification
        </p>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification context"
            className="-mr-1 shrink-0 cursor-pointer rounded p-0.5 text-(--overlay-text-muted) transition hover:bg-(--overlay-surface-hover) hover:text-(--overlay-text-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--overlay-text-muted)"
          >
            <FiX size={14} />
          </button>
        ) : null}
      </div>

      {isDeleted ? (
        <p className="py-1 text-[13px] leading-5 text-(--overlay-text-muted) italic">
          This comment has been deleted.
        </p>
      ) : (
        /*
          Always the **root** of the target's thread, even when the notification
          named a reply.

          Rendering the reply as its own standalone row was the presentation half
          of the duplicate bug: the card showed a copy of the reply while the real
          one lived inside the root's thread, so the two could drift and the same
          reply could appear twice once the thread was expanded.

          Showing the root instead means the target reply is reached through the
          ordinary `CommentReplies` the canonical list uses — same component, same
          store, same realtime subscription. `highlightedCommentId` is what marks
          the reply the notification was actually about, and the wrapper expands
          this thread on arrival so it is visible without a click.
        */
        <CommentItem
          item={target.root!}
          user={user}
          canReply={Boolean(onReply)}
          level={0}
          onReply={onReply}
          isReplying={replyTargetId === target.root!._id}
          replyTargetId={replyTargetId}
          isRepliesOpen={expandedCommentId === target.root!._id}
          onToggleReplies={() => onToggleReplies?.(target.root!._id)}
          createdReply={createdReply}
          highlightedCommentId={target.comment!._id}
          postOwnerId={postOwnerId}
        />
      )}
    </section>
  );
}
