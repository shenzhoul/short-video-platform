'use client';

import CommentItem from '@components/comment/comment-item';
import type { CommentTarget } from '@hooks/use-comment-target';
import { IUser } from '@interfaces/user';
import { FiX } from 'react-icons/fi';

interface CommentTargetContextProps {
  target: CommentTarget;
  user?: IUser;
  onReply?: (comment: any) => void;
  replyTargetId?: string;
  /** Leaves the contextual view and returns to the plain comment list. */
  onDismiss?: () => void;
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
 * A reply is shown under its root so the exchange makes sense on its own; the
 * root alone would not explain what was replied to.
 */
export default function CommentTargetContext({
  target,
  user,
  onReply,
  replyTargetId,
  onDismiss
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
      className="mx-4 mb-3 shrink-0 rounded-xl border border-(--border-faint) bg-(--surface-soft) px-3 py-2.5"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[12px] leading-4 font-medium text-(--text-muted)">
          From your notification
        </p>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification context"
            className="-mr-1 shrink-0 cursor-pointer rounded p-0.5 text-(--text-muted) transition hover:text-(--text-strong)"
          >
            <FiX size={14} />
          </button>
        ) : null}
      </div>

      {isDeleted ? (
        <p className="py-1 text-[13px] leading-5 text-(--text-muted) italic">
          This comment has been deleted.
        </p>
      ) : (
        <div className="space-y-2">
          {/*
            A reply is rendered beneath its root, indented, so the target reads
            as part of a conversation rather than as a stray line.
          */}
          {target.isReply && target.root ? (
            <div className="opacity-70">
              <CommentItem item={target.root} user={user} canReply={false} level={1} />
            </div>
          ) : null}

          <div className={target.isReply ? 'border-l border-(--border-faint) pl-3' : ''}>
            <CommentItem
              item={target.comment!}
              user={user}
              canReply={Boolean(onReply)}
              level={target.isReply ? 1 : 0}
              onReply={onReply}
              isReplying={replyTargetId === target.comment!._id}
              highlightedCommentId={target.comment!._id}
            />
          </div>
        </div>
      )}
    </section>
  );
}
