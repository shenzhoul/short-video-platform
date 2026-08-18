'use client';

import { CommentButton } from '@components/comment';
import { LikeButton, ShareButton } from '@components/interactions';
import { IPost, IUser } from 'src/interfaces';

interface PostActionsProps {
  /** Post data */
  post: IPost;
  /** Current user */
  currentUser?: IUser;
  /** Total comments count */
  totalComments: number;
  /** Whether comment section is open */
  isCommentOpen: boolean;
  /** Whether actions are disabled */
  disabled?: boolean;
  /** Callback when comment button is clicked */
  onCommentClick: () => void;
  /** Callback when tip is successful */
  onTipSuccess?: (amount: number, newTotal: number) => void;
  /** Callback when like is successful */
  onLikeSuccess?: (isLiked: boolean, totalLikes: number) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * PostActions - A component that renders all action buttons for a post
 *
 * This component includes:
 * - Like button
 * - Comment button
 * - Tip button (if creator exists)
 * - Report button
 *
 * All buttons use the social components with automatic login checking.
 *
 * @example
 * <PostActions
 *   post={post}
 *   currentUser={user}
 *   totalComments={42}
 *   totalTips={100}
 *   isCommentOpen={false}
 *   onCommentClick={() => setCommentsOpen(true)}
 *   onTipSuccess={(amount, newTotal) => setTotalTips(newTotal)}
 * />
 */
export default function PostActions({
  post,
  currentUser,
  totalComments,
  isCommentOpen,
  disabled = false,
  onCommentClick,
  onLikeSuccess,
  className = ''
}: PostActionsProps) {
  const user = currentUser || ({} as IUser);
  const creator = post?.user;

  // Check if current user is the creator/owner of this post
  const isOwner = user?._id === creator?._id;

  // Disable interactions if creator is deleted
  const isCreatorDeleted = post?.isCreatorDeleted || false;
  const interactionDisabled = disabled || isCreatorDeleted;

  return (
    <div className={`flex items-center justify-between w-full gap-2 ${className}`}>
      <div className="flex items-center gap-2">
        <LikeButton
          contentType="post"
          contentId={post._id}
          initialIsLiked={!!post?.isLiked}
          initialTotalLikes={post?.totalLike || 0}
          disabled={interactionDisabled || isOwner}
          variant="grey-light"
          size="md"
          onSuccess={onLikeSuccess}
          className='py-0! px-3! h-[35px] gap-1!'
          iconSize={20}
        />

        <CommentButton
          totalComments={totalComments}
          className={`py-0! px-3! h-[35px] gap-1! ${isCommentOpen ? 'text-primary!' : ''}`}
          onClick={onCommentClick}
          disabled={interactionDisabled}
          variant="grey-light"
          size="md"
          iconSize={20}
        />
      </div>

      <div className="flex items-center gap-2">
        <ShareButton
          postId={post._id}
          variant="grey-light"
          size="md"
          disabled={disabled}
          content='icon'
          className='py-0! px-3! h-[35px] gap-1!'
          iconSize={20}
        />
      </div>
    </div>
  );
}
