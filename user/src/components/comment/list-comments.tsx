/**
 * ListComments Component
 *
 * A list component for displaying comments with loading states and empty states.
 * Renders individual comment items with support for nested replies.
 *
 * @example
 * // Basic comment list
 * <ListComments
 *   comments={commentsList}
 *   requesting={isLoading}
 *   user={currentUser}
 *   onDelete={(commentId) => handleDeleteComment(commentId)}
 *   canReply
 * />
 *
 * // Nested replies list
 * <ListComments
 *   comments={replies}
 *   requesting={false}
 *   user={currentUser}
 *   level={1}
 *   canReply={false}
 * />
 *
 * Features:
 * - List of comment items with proper spacing
 * - Loading spinner during data fetching
 * - Empty state message when no comments
 * - Support for nested comment levels
 * - Delete functionality for authorized users
 * - Reply functionality with level limits
 */

import CommentItem from '@components/comment/comment-item';
import Spin from '@components/ui/spin';
import { IComment } from '@interfaces/comment';
import { IUser } from '@interfaces/index';
import { useEffect, useRef, useState } from 'react';

type IProps = {
  comments: IComment[];
  requesting: boolean;
  onDelete?: (commentId: string) => void;
  user?: IUser;
  canReply?: boolean;
  level?: number;
  onReply?: (comment: IComment) => void;
  replyTargetId?: string;
  createdReply?: IComment | null;
  openReplyCommentId?: string | null;
  highlightedCommentId?: string | null;
  postOwnerId?: string | null;
  /** Whether the cursor has another page. Observation stops once false. */
  hasMore?: boolean;
  /** Loads the next cursor page; already guarded against concurrent calls. */
  onLoadMore?: () => void | Promise<void>;
}

export function ListComments({
  comments,
  requesting,
  user,
  onDelete,
  canReply = false,
  level = 0,
  onReply,
  replyTargetId,
  createdReply,
  openReplyCommentId,
  highlightedCommentId = null,
  postOwnerId = null,
  hasMore = false,
  onLoadMore
}: IProps) {
  const [activeReplyCommentId, setActiveReplyCommentId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /**
   * Load the next cursor page as the bottom of the list approaches.
   *
   * Replaces the old "View more comments" button, which paged through comments
   * already in memory and so could never reach past the first request.
   *
   * The observer is only attached while another page exists, so it detaches
   * itself at the end of the list rather than firing against a closed cursor.
   * Concurrent requests are already prevented inside `useComments.loadMore`,
   * which returns early while a fetch is in flight — a second guard here would
   * be a second source of truth for the same thing.
   */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || !onLoadMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void onLoadMore();
    }, { rootMargin: '160px 0px' });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, comments.length]);

  const handleToggleReplies = (commentId: string) => {
    setActiveReplyCommentId((prev) => (prev === commentId ? null : commentId));
  };

  useEffect(() => {
    if (openReplyCommentId) {
      setActiveReplyCommentId(openReplyCommentId);
    }
  }, [openReplyCommentId]);

  return (
    <div className="space-y-5 pb-4">
      {comments.length > 0 &&
        comments.map((comment: IComment) => (
          <CommentItem
            canReply={canReply}
            key={comment._id}
            item={comment}
            user={user}
            onDelete={onDelete}
            level={level}
            isRepliesOpen={activeReplyCommentId === comment._id}
            onToggleReplies={() => handleToggleReplies(comment._id)}
            onReply={onReply}
            isReplying={replyTargetId === comment._id}
            replyTargetId={replyTargetId}
            createdReply={createdReply}
            highlightedCommentId={highlightedCommentId}
            postOwnerId={postOwnerId}
          />
        ))}
      {hasMore ? (
        // Sentinel plus a light indicator, so reaching the bottom loads the
        // next page instead of asking the reader to click for it.
        <div ref={sentinelRef} data-testid="comment-scroll-sentinel" className="py-3 text-center">
          <Spin spinning />
        </div>
      ) : null}
      {!requesting && !comments.length && (
        <div className="flex min-h-[360px] flex-col items-center justify-center text-center text-white/35">
          <div
            className="
        mb-4 h-[120px] w-[180px]
        bg-[url('/no-comment-dark.png')]
        bg-contain bg-center bg-no-repeat
        opacity-70
      "
          />
          <div className="text-[13px]">No comments yet</div>
        </div>
      )}
      {requesting ? (
        <div className="text-center py-4">
          <Spin spinning />
        </div>
      ) : null}
    </div>
  );
}

export default ListComments;
