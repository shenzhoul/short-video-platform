'use client';

import { CommentForm, CommentFormRef, ListComments } from '@components/comment';
import CommentItem from '@components/comment/comment-item';
import CommentTargetContext from '@components/comment/comment-target-context';
import { useCommentTarget } from '@hooks/use-comment-target';
import { useComments } from '@hooks/use-comments';
import { useHotComment } from '@hooks/use-hot-comment';
import { usePostLiveComments } from '@hooks/use-post-live-comments';
import { IComment, ICreateComment } from '@interfaces/comment';
import { IUser } from '@interfaces/user';
import { showErrorMessage } from '@lib/utils';
import { useProfile } from '@providers/profile.provider';
import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState
} from 'react';
import { toast } from 'react-toastify';

type CommentObjectType = 'post' | 'comment';

interface CommentWrapperProps {
  /** ID of the content being commented on */
  contentId: string;
  /** Type of content (post, video, etc.) */
  contentType?: CommentObjectType;
  /** Current user */
  user?: IUser;
  /** Whether to initially show comments */
  initialVisible?: boolean;
  /** Whether users can reply to comments */
  canReply?: boolean;
  /** Nesting level (0 = top level, 1 = reply) */
  level?: number;
  /** Number of items per page */
  itemsPerPage?: number;
  /** auto load comment list */
  autoload?: boolean;
  /** Callback when total comments count changes */
  onTotalChange?: (total: number) => void;
  /** Callback when comment is created */
  onCommentCreate?: (comment: IComment) => void;
  /** Callback when comment is deleted */
  onCommentDelete?: (commentId: string) => void;
  /** Additional CSS classes */
  className?: string;
  /** init total comments - must be set for server-rendered content */
  initialTotalComments?: number;
  /**
   * Comment a notification deep-linked to. Only an id: whether it still exists
   * is resolved here, so a stale link cannot assert a state of its own.
   */
  targetCommentId?: string | null;
  /**
   * Aggregate fallback: the comment that opened the group. Its presence also
   * means the row stands for several events.
   */
  targetCommentFallbackId?: string | null;
  /** Post author's id, used only to mark their own comments. */
  postOwnerId?: string | null;
  /** Viewer's own id, used only to decide whether they own this post. */
  viewerId?: string | null;
}

export interface CommentWrapperRef {
  /** Show/hide the comment section */
  setVisible: (visible: boolean) => void;
  /** Toggle visibility of comment section */
  toggle: () => void;
  /** Get current visibility state */
  isVisible: () => boolean;
  /** Refresh comments */
  refresh: () => void;
  /** Get current total comments */
  getTotalComments: () => number;
}

/**
 * CommentWrapper - A comprehensive comment management component with infinite scroll
 *
 * This component handles all comment-related functionality including:
 * - Comment form for creating new comments
 * - List of comments with infinite scroll pagination
 * - CRUD operations (create, read, update, delete)
 * - State management and API calls with cursor-based pagination
 * - Visibility control from parent components
 * - Optimized performance for large comment datasets
 *
 * @example
 * // Basic usage
 * const commentRef = useRef<CommentWrapperRef>(null);
 *
 * <CommentWrapper
 *   ref={commentRef}
 *   contentId="post-123"
 *   contentType="post"
 *   user={currentUser}
 *   onTotalChange={(total) => setTotalComments(total)}
 * />
 *
 * // Control from parent
 * commentRef.current?.setVisible(true);
 * commentRef.current?.toggle();
 */
const CommentWrapper = forwardRef<CommentWrapperRef, CommentWrapperProps>(({
  contentId,
  contentType = 'post',
  user,
  initialVisible = false,
  canReply = false,
  level = 0,
  itemsPerPage = 10,
  autoload,
  onTotalChange,
  onCommentCreate,
  onCommentDelete,
  className = '',
  initialTotalComments = 0,
  targetCommentId = null,
  targetCommentFallbackId = null,
  postOwnerId = null,
  viewerId = null
}, ref) => {
  const [isVisible, setIsVisible] = useState(initialVisible);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [hasLoadedComments, setHasLoadedComments] = useState(false);
  const [replyTarget, setReplyTarget] = useState<IComment | null>(null);
  const [createdReply, setCreatedReply] = useState<IComment | null>(null);
  const [openReplyCommentId, setOpenReplyCommentId] = useState<string | null>(null);
  const [displayTotalComments, setDisplayTotalComments] = useState(initialTotalComments);

  const { current: profileUser } = useProfile();
  const isTopLevelThread = level === 0;
  const commentFormRef = useRef<CommentFormRef>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Whether the reader is at the newest comments; drives whether an arrival may
  // be inserted or has to queue behind a count.
  const [isAtNewest, setIsAtNewest] = useState(true);
  /**
   * Whether the reader has closed the notification context.
   *
   * Local UI state, not a change to the notification itself: dismissing the
   * block here must never touch the stored notification record.
   */
  const [targetDismissed, setTargetDismissed] = useState(false);

  /**
   * The hot comment is an owner-facing view of their own post's engagement, so
   * it is requested only when the viewer owns the post. The server enforces the
   * same rule; this just avoids a pointless request.
   */
  const isPostOwner = Boolean(postOwnerId && viewerId
    && postOwnerId.toString() === viewerId.toString());
  const { hotComment } = useHotComment(
    isTopLevelThread ? contentId : null,
    isPostOwner
  );

  // Resolved directly by id, so a target thousands of comments deep is found
  // without paging the list.
  const target = useCommentTarget(
    isTopLevelThread ? targetCommentId : null,
    isTopLevelThread ? targetCommentFallbackId : null
  );

  // Use the updated useComments hook with infinite scroll support
  const {
    comments,
    loading: commentsLoading,
    submitting,
    total: totalComments,
    createComment: createCommentHook,
    deleteComment: deleteCommentHook,
    deleteReply,
    hasMore: hasMoreComments,
    loadMore: loadMoreComments,
    insertLiveComment,
    removeLiveComment,
    refetch: refetchComments
  } = useComments({
    objectId: contentId,
    objectType: contentType as 'post' | 'comment',
    limit: itemsPerPage,
    autoload: autoload !== undefined ? autoload : isVisible
  });

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    setVisible: (visible: boolean) => {
      setIsVisible(visible);
      if (visible && isFirstLoad) {
        setIsFirstLoad(false);
        if (!hasLoadedComments) {
          setHasLoadedComments(true);
        }
      }
    },
    toggle: () => {
      const newVisible = !isVisible;
      setIsVisible(newVisible);
      if (newVisible && isFirstLoad) {
        setIsFirstLoad(false);
        if (!hasLoadedComments) {
          setHasLoadedComments(true);
        }
      }
    },
    isVisible: () => isVisible,
    refresh: () => refetchComments(),
    getTotalComments: () => totalComments
  }), [isVisible, isFirstLoad, totalComments, refetchComments, hasLoadedComments]);

  // A new notification target is a new context, so a previous dismissal must
  // not suppress it.
  useEffect(() => {
    setTargetDismissed(false);
  }, [targetCommentId, targetCommentFallbackId]);

  /**
   * Expand the thread a deep-linked reply belongs to.
   *
   * The target itself is rendered in its own context section above the list, so
   * nothing is inserted into the canonical comment array. Opening the thread is
   * still worth doing: the reader usually wants to continue the conversation
   * where it actually lives.
   */
  useEffect(() => {
    if (target.status !== 'found' || !target.isReply || !target.root) return;
    setOpenReplyCommentId(target.root._id);
  }, [target]);

  /**
   * Scroll the context section into view once it has rendered.
   *
   * The section sits at the top of the panel, so this mostly matters when the
   * reader arrives with the list already scrolled.
   */
  useEffect(() => {
    if (target.status !== 'found' && target.status !== 'missing') return;

    const frame = requestAnimationFrame(() => {
      document
        .querySelector('[data-testid="comment-target-context"]')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [target.status]);

  /**
   * Live comments arriving while this post is open.
   *
   * `atNewest` is the scroll position test: a reader sitting at the top of the
   * list can absorb an insertion, while one reading older comments must not have
   * content pushed out from under them.
   */
  const { pendingCount, revealPending } = usePostLiveComments({
    postId: isTopLevelThread ? contentId : null,
    atNewest: isAtNewest,
    onInsert: insertLiveComment,
    onRemove: removeLiveComment
  });

  /**
   * Leave the contextual view without disturbing anything else.
   *
   * Strips only the target params, using `replaceState` — the same mechanism
   * `updateModalUrl` already uses for `modal_id` — so the modal stays open on
   * the Comments tab, no navigation occurs, and Back does not bounce the reader
   * into the context they just closed.
   *
   * The canonical comment list is untouched: the target was never part of it,
   * so there is nothing to move, re-sort or re-fetch, and the cursor keeps its
   * position.
   */
  const dismissTarget = useCallback(() => {
    setTargetDismissed(true);
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    url.searchParams.delete('target_comment_id');
    url.searchParams.delete('target_comment_fallback_id');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  /**
   * The server page, minus a row the context section is already showing.
   *
   * A render-time filter only: `comments` — the canonical array the cursor
   * pages into — is never touched, and the surviving rows keep their server
   * order exactly. It exists purely so the target does not appear twice in one
   * viewport when it happens to sit on the loaded page.
   */
  /**
   * The comment currently promoted into the hot slot.
   *
   * Notification context outranks it: when both point at the same comment the
   * hot slot stands down rather than showing the reader the same comment twice
   * under two different headings.
   */
  const hotCommentId = useMemo(() => {
    if (!hotComment) return null;
    const contextId = !targetDismissed && target.status === 'found'
      ? target.comment?._id
      : null;
    return contextId === hotComment._id ? null : hotComment._id;
  }, [hotComment, target, targetDismissed]);

  /**
   * The server page, minus rows a context section is already showing.
   *
   * Render-time only: `comments` — the canonical array the cursor pages into —
   * is never modified, and the surviving rows keep their server order. When a
   * comment stops being contextual it simply reappears in its own position,
   * with no refetch and no cursor change.
   */
  const visibleComments = useMemo(() => {
    const suppressed = new Set<string>();
    if (!targetDismissed && target.status === 'found' && !target.isReply && target.comment) {
      suppressed.add(target.comment._id);
    }
    if (hotCommentId) suppressed.add(hotCommentId);

    if (!suppressed.size) return comments;
    return comments.filter((item) => !suppressed.has(item._id));
  }, [comments, target, targetDismissed, hotCommentId]);

  // Track when comments are actually loaded
  useEffect(() => {
    if (comments.length > 0 || (autoload && !commentsLoading)) {
      setHasLoadedComments(true);
    }
  }, [comments, commentsLoading, autoload]);

  /**
   * The displayed total follows the authoritative value from above.
   *
   * This is the only synchronisation left, and it is one-directional. There used
   * to be a second effect pushing `displayTotalComments` back up whenever it
   * changed, which closed a loop: report up -> parent interaction state updates
   * -> `detailPost` is patched -> the stage mirrors `post.totalComment` -> this
   * component receives a new `initialTotalComments` -> the mirror effect writes
   * it to state -> the reporting effect fires again. Any momentary disagreement
   * between the two sides — an optimistic +1 racing an authoritative
   * `post:stats_updated` snapshot — left them chasing each other until React
   * gave up with "Maximum update depth exceeded".
   *
   * Now the total flows down as a prop and only real mutations are reported
   * upward, from the handlers that perform them.
   */
  useEffect(() => {
    setDisplayTotalComments(initialTotalComments);
  }, [contentId, initialTotalComments]);

  // Handle comment creation with the hook
  const handleCreateComment = async (values: ICreateComment & { objectId?: string; objectType?: CommentObjectType; }) => {
    if (!user?._id) {
      toast.error('Please login to comment');
      return;
    }

    const trimmedContent = values.content?.trim() || '';
    if (!trimmedContent) {
      toast.error('Comment content is required');
      return;
    }

    try {
      const finalValues = {
        ...values,
        content: trimmedContent,
        objectId: values.objectId || contentId,
        objectType: values.objectType || contentType,
        replyToUserId: (values as any).replyToUserId,
        replyToName: (values as any).replyToName
      };

      const newComment = await createCommentHook(finalValues, profileUser);

      if (newComment) {
        // Reported here, where a comment genuinely was created, rather than
        // from an effect watching the value. Computed outside the updater so a
        // StrictMode double-invoke cannot report the change twice.
        const nextTotal = displayTotalComments + 1;
        setDisplayTotalComments(nextTotal);
        onTotalChange?.(nextTotal);
        onCommentCreate?.(newComment);
      }

      toast.success('Comment added successfully');
      return newComment;
    } catch (error: any) {
      showErrorMessage(error);
    }
  };

  // Handle comment deletion with the hook
  const handleDeleteComment = async (commentId: string) => {
    try {
      const deleted = await deleteCommentHook({
        _id: commentId
      } as IComment);

      if (!deleted) {
        return;
      }

      const target = comments.find((comment) => comment._id === commentId);
      const removedCount = target
        ? 1 + (target.totalReply || 0)
        : 1;

      const nextTotal = Math.max(0, displayTotalComments - removedCount);
      setDisplayTotalComments(nextTotal);
      onTotalChange?.(nextTotal);
      onCommentDelete?.(commentId);
      deleteReply(commentId);
      toast.success('Comment removed successfully');
    } catch (error: any) {
      showErrorMessage(error);
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={[
        isTopLevelThread
          ? 'flex h-full min-h-0 flex-col overflow-hidden text-white'
          : 'space-y-4',
        className
      ].join(' ')}
    >
      <div className="shrink-0 px-4 pb-2 pt-3 text-[15px] leading-6 text-white/90">
        <div>
          Everyone is searching:
          <span className="ml-0.5 font-semibold text-[#ffd400]">Truth capture⌕</span>
        </div>
        <div className="font-medium">All Comments ({displayTotalComments})</div>
      </div>

      {/*
        Navigation context, not a comment. Rendered outside the list so the
        canonical ordering below stays exactly as the server returned it.
      */}
      {isTopLevelThread && !targetDismissed ? (
        <CommentTargetContext
          target={target}
          user={user}
          onReply={(comment) => setReplyTarget(comment)}
          replyTargetId={replyTarget?._id}
          onDismiss={dismissTarget}
        />
      ) : null}

      {/* Comments List */}
      {pendingCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            revealPending();
            listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="mx-4 mb-2 shrink-0 cursor-pointer rounded-full bg-(--surface-raised) px-3 py-1.5 text-[13px] leading-5 font-medium text-(--text-strong) shadow-(--shadow-popover) transition hover:bg-(--hover-bg)"
        >
          {pendingCount} new comment{pendingCount === 1 ? '' : 's'}
        </button>
      ) : null}

      {/*
        Engagement context, not part of the ordering below. Rendered through the
        ordinary comment component so there is one comment UI, not two.
      */}
      {hotCommentId && hotComment ? (
        <section
          aria-label="Top comment"
          data-testid="hot-comment"
          className="mx-4 mb-3 shrink-0 rounded-xl border border-(--border-faint) bg-(--surface-soft) px-3 py-2.5"
        >
          <p className="mb-1.5 text-[12px] leading-4 font-medium text-(--text-muted)">
            Top comment
          </p>
          <CommentItem item={hotComment} user={user} canReply={false} postOwnerId={postOwnerId} />
        </section>
      ) : null}

      <div
        ref={listRef}
        onScroll={(event) => setIsAtNewest(event.currentTarget.scrollTop <= 24)}
        className={`scrollbar-thin scrollbar-thumb-white/16 scrollbar-track-transparent ${isTopLevelThread ? 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pr-2' : ''}`}
      >
        <ListComments
          comments={visibleComments}
          postOwnerId={postOwnerId}
          hasMore={hasMoreComments}
          onLoadMore={loadMoreComments}
          requesting={commentsLoading}
          user={user}
          onDelete={handleDeleteComment}
          canReply={canReply}
          level={level}
          replyTargetId={replyTarget?._id}
          onReply={(comment) => {
            setReplyTarget((current) => current?._id === comment._id ? null : comment);

            requestAnimationFrame(() => {
              commentFormRef.current?.focus();
            });
          }}
          createdReply={createdReply}
          openReplyCommentId={openReplyCommentId}
        />
      </div>

      {/* Comment Form */}
      <div className={isTopLevelThread ? 'shrink-0 bg-[#191a23] px-4 pb-2 pt-1' : ''}>
        {!!user?._id ? (
          <CommentForm
            ref={commentFormRef}
            objectId={replyTarget?._id || contentId}
            objectType={replyTarget ? 'comment' : contentType}
            creator={user}
            onSubmit={async (values) => {
              const targetObjectId =
                (replyTarget as any)?.parentCommentId ||
                replyTarget?._id ||
                contentId;

              const newComment = await handleCreateComment({
                ...values,
                objectId: targetObjectId,
                objectType: replyTarget ? 'comment' : contentType,
                replyToUserId: (replyTarget as any)?.isReplyToReply
                  ? replyTarget?.user?._id
                  : undefined,
                replyToName: (replyTarget as any)?.isReplyToReply
                  ? replyTarget?.user?.name || replyTarget?.user?.username
                  : undefined
              });

              if (replyTarget && newComment) {
                setCreatedReply(newComment);
                setOpenReplyCommentId(targetObjectId);
              }

              setReplyTarget(null);
            }}
            requesting={submitting}
            replyTarget={replyTarget}
            onCancelReply={() => setReplyTarget(null)}
          />
        ) : (
          <div className="flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-white/20 text-sm text-white/60 transition hover:bg-white/30">
            Please <span className="mx-1 text-[#fe2c55]">login</span> before leaving comments
          </div>
        )}
      </div>
    </div>
  );
});

CommentWrapper.displayName = 'CommentWrapper';

export default CommentWrapper;
