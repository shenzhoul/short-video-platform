'use client';

import CommentReplies from '@components/comment/comment-replies';
import { LikeButton } from '@components/interactions';
import { IComment } from '@interfaces/comment';
import { IUser } from '@interfaces/user';
import moment from 'moment';
import Link from 'next/link';
import { AiOutlineDown, AiOutlineUp } from 'react-icons/ai';
import { FiTrash2 } from 'react-icons/fi';
import { CommentOutlineIcon, HeartFilledIcon, HeartOutlineIcon, ShareOutlineIcon } from 'src/icons';

type IProps = {
  item: IComment;
  onDelete?: (commentId: string) => void;
  user?: IUser;
  canReply?: boolean;
  level?: number;
  isRepliesOpen?: boolean;
  onToggleReplies?: () => void;
  onReply?: (comment: IComment) => void;
  isReplying?: boolean;
  replyTargetId?: string;
  createdReply?: IComment | null;
  /** Comment a notification deep-linked to; briefly highlighted on arrival. */
  highlightedCommentId?: string | null;
  /** Post author's id, so their own comments can be marked. */
  postOwnerId?: string | null;
};

export function CommentItem({
  item,
  onDelete,
  user,
  canReply = false,
  level = 0,
  isRepliesOpen = false,
  onToggleReplies,
  onReply,
  isReplying,
  replyTargetId,
  createdReply,
  highlightedCommentId = null,
  postOwnerId = null
}: IProps) {
  const allowReplies = canReply && level < 1;
  const isReply = level > 0;

  const displayName = item?.user?.name || item?.user?.username || 'N/A';
  const profileHref = item?.user?.isCreator
    ? `/${item?.user?.username || ''}`
    : `/user/profile/${item?.user?.username || ''}`;

  const handleReply = () => {
    onReply?.({
      ...item,
      parentCommentId: isReply ? item.objectId : item._id,
      isReplyToReply: isReply
    });
  };

  const shouldShowReplyToName =
    isReply &&
    !!item.replyToName;

  const isHighlighted = Boolean(highlightedCommentId) && highlightedCommentId === item._id;
  /**
   * Compared by id, never by display name: names are not unique and can be
   * changed, so matching on them would mislabel comments.
   */
  const isPostAuthor = Boolean(postOwnerId)
    && (item?.user?._id || item?.createdBy)?.toString() === postOwnerId?.toString();

  return (
    <div
      // The anchor the deep-link scrolls to. Always present, so scrolling never
      // depends on the highlight still being active.
      data-comment-id={item._id}
      className={`
        group relative flex w-full gap-3 py-1
        ${isReplying ? 'bg-[linear-gradient(270deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.06)_18.23%,rgba(255,255,255,0.06)_51.56%,rgba(255,255,255,0.06)_82.29%,rgba(255,255,255,0)_100%)]' : ''}
        ${isHighlighted ? 'rounded-lg bg-(--surface-soft) ring-1 ring-(--border-faint) transition-colors duration-500' : ''}
      `}
    >
      <Link href={profileHref} prefetch={false} className="mt-0.5 shrink-0">
        <img
          alt="user-avatar"
          src={item?.user?.avatar || '/no_avatar.jpeg'}
          className={`${isReply ? 'h-8 w-8' : 'h-9 w-9'} rounded-full object-cover`}
        />
      </Link>

      <div className="min-w-0 flex-1">
        {isReply ? (
          <div className="relative pr-6">
            {user?._id === item.createdBy ? (
              <button
                type="button"
                className="absolute right-0 top-0 opacity-0 text-[#fe2c55] transition group-hover:opacity-100"
                onClick={() => onDelete?.(item._id)}
                title="Delete Comment"
              >
                <FiTrash2 size={14} />
              </button>
            ) : null}

            <div className="flex min-w-0 items-center gap-1 text-[13px] leading-4">
              <Link
                href={profileHref}
                prefetch={false}
                className="shrink-0 font-semibold text-white/95 hover:underline"
              >
                {displayName}
              </Link>
              {isPostAuthor ? (
                <span className="shrink-0 rounded-[3px] bg-[#fe2c55]/15 px-1 py-px text-[11px] leading-4 font-medium text-[#fe2c55]">
                  Author
                </span>
              ) : null}

              {shouldShowReplyToName ? (
                <>
                  <span className="shrink-0">›</span>
                  <span className="min-w-0 truncate font-medium">
                    {item.replyToName}
                  </span>
                </>
              ) : null}
            </div>

            <p className="mt-1 whitespace-pre-wrap wrap-break-word text-[14px] leading-5 text-white/92">
              {item.content}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              {/*
                Name and badge share one group so the badge sits beside the
                name. Previously both were direct children of the
                `justify-between` row, which pushed the badge to the far edge.
              */}
              <div className="flex min-w-0 items-center gap-1">
                <Link
                  href={profileHref}
                  prefetch={false}
                  className="min-w-0 truncate text-[14px] font-semibold leading-5 text-white/95 hover:underline"
                >
                  {displayName}
                </Link>
                {isPostAuthor ? (
                  <span className="shrink-0 rounded-[3px] bg-[#fe2c55]/15 px-1 py-px text-[11px] leading-4 font-medium text-[#fe2c55]">
                    Author
                  </span>
                ) : null}
              </div>

              {user?._id === item.createdBy ? (
                <button
                  type="button"
                  className="opacity-0 text-[#fe2c55] transition group-hover:opacity-100"
                  onClick={() => onDelete?.(item._id)}
                  title="Delete Comment"
                >
                  <FiTrash2 size={15} />
                </button>
              ) : null}
            </div>

            <p className="mt-1 whitespace-pre-wrap wrap-break-word text-[15px] leading-5.5 text-white/92">
              {item.content}
            </p>
          </>
        )}

        <div className={`mt-2 text-white/60 ${isReply ? 'text-[12px]' : 'text-[13px]'}`}>
          {/* Time + location */}
          <div className="flex items-center gap-2">
            <span>{moment(item.createdAt).fromNow()}</span>
            <span>·</span>
            <span>Guangdong</span>
          </div>

          {/* Reply / Share / Like */}
          <div className="mt-1.5 flex items-center gap-3">
            <button
              type="button"
              onClick={handleReply}
              className="flex items-center gap-1 cursor-pointer hover:text-white"
            >
              <CommentOutlineIcon className='text-xl' />
              {isReplying ? 'Replying' : 'Reply'}
            </button>

            <button
              type="button"
              className="flex items-center gap-1 cursor-pointer hover:text-white"
            >
              <ShareOutlineIcon className='text-xl' />
              Share
            </button>

            <LikeButton
              contentType="comment"
              contentId={item._id}
              initialIsLiked={!!item.isLiked}
              initialTotalLikes={item.totalLike || 0}
              disabled={!user?._id}
              unstyled
              tooltip={false}
              showCount
              className="flex cursor-pointer items-center gap-1 hover:text-white"
              renderIcon={({ isLiked }) =>
                isLiked ? (
                  <HeartFilledIcon className="text-xl text-[#fe2c55]" />
                ) : (
                  <HeartOutlineIcon className="text-xl" />
                )
              }
              renderCount={(totalLikes) => <span>{totalLikes || 0}</span>}
            />
          </div>
        </div>

        {!isRepliesOpen && allowReplies && item.totalReply ? (
          <button
            type="button"
            onClick={onToggleReplies}
            className="mt-3 flex items-center gap-1 text-[13px] text-white/35 hover:text-white/60"
          >
            <span className="h-px w-6 bg-white/20" />
            Expand {item.totalReply} replies
            <AiOutlineDown size={12} />
          </button>
        ) : null}

        {isRepliesOpen && allowReplies ? (
          <>
            <CommentReplies
              parentId={item._id}
              user={user}
              onDelete={onDelete}
              onReply={onReply}
              replyTargetId={replyTargetId}
              createdReply={createdReply}
              highlightedCommentId={highlightedCommentId}
              postOwnerId={postOwnerId}
            />

            <button
              type="button"
              onClick={onToggleReplies}
              className="mt-2 ml-7 flex items-center gap-1 text-[13px] text-white/35 hover:text-white/60"
            >
              <span className="h-px w-6 bg-white/20" />
              Collapse
              <AiOutlineUp size={12} />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default CommentItem;
