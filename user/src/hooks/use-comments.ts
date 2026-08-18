/**
 * Comments Hook with Infinite Scroll Support
 *
 * Manages comments for various content types with CRUD operations and cursor-based pagination.
 * Provides loading states, error handling, optimistic updates, and infinite scroll functionality.
 * Uses cursor-based pagination for better performance with large comment datasets.
 *
 * @example
 * ```tsx
 * const {
 *   comments,
 *   loading,
 *   createComment,
 *   deleteComment,
 *   loadMore,
 *   hasMore
 * } = useComments({
 *   objectId: 'post-123',
 *   objectType: 'post',
 *   limit: 10
 * });
 *
 * // Create a new comment
 * await createComment({ content: 'Great post!' });
 *
 * // Delete a comment
 * await deleteComment(comment);
 *
 * // Load more comments with infinite scroll
 * if (hasMore) await loadMore();
 * ```
 */

import { IComment } from '@interfaces/comment';
import { showErrorMessage } from '@lib/utils';
import {
  createComment as createCommentApi,
  deleteComment as deleteCommentApi,
  searchComments as searchCommentsApi
} from '@services/comment.service';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseCommentsProps {
  objectId: string;
  objectType: 'post' | 'comment';
  limit?: number;
  autoload?: boolean;
}

interface UseCommentsReturn {
  comments: IComment[];
  loading: boolean;
  submitting: boolean;
  total: number;
  hasMore: boolean;
  createComment: (
    data: { content: string; objectId?: string; objectType?: 'post' | 'comment' },
    creator?: any
  ) => Promise<IComment | void>;
  /**
   * Delete a comment.
   * Returns:
   * - true when the comment was actually deleted
   * - false when the user cancelled or deletion failed
   */
  deleteComment: (comment: IComment) => Promise<boolean>;
  deleteReply: (commentId: string) => void;
  insertLiveComment: (comment: IComment) => void;
  removeLiveComment: (commentId: string) => void;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

interface CursorInfo {
  id: string;
  createdAt: number;
}

export const useComments = ({
  objectId,
  objectType,
  limit = 10,
  autoload = true
}: UseCommentsProps): UseCommentsReturn => {
  const [comments, setComments] = useState<IComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const firstLoadRef = useRef(false);
  const nextCursorRef = useRef<CursorInfo | null>(null);
  // Guards cursor pages against duplicate concurrent requests.
  const loadingMoreRef = useRef(false);

  // Fetch comments with cursor-based pagination
  const fetchComments = useCallback(async (reset = false) => {
    try {
      setLoading(true);

      // Build query parameters
      const queryParams: any = { limit };

      // Add cursor parameters for pagination (except on reset)
      if (!reset && nextCursorRef.current) {
        queryParams.cursor = nextCursorRef.current.id;
        queryParams.lastCreatedAt = nextCursorRef.current.createdAt.toString();
      }

      const response = await searchCommentsApi(objectType, objectId, queryParams);

      const newComments = response.data?.data || [];
      const responseHasMore = response.data?.hasMore ?? false;
      const responseNextCursor = response.data?.nextCursor || null;

      if (reset) {
        setComments(newComments);
        nextCursorRef.current = responseNextCursor;
        setTotal(response.data?.total || newComments.length);
      } else {
        setComments(prev => [...prev, ...newComments]);
        nextCursorRef.current = responseNextCursor;
      }

      setHasMore(responseHasMore);
    } catch (error: unknown) {
      showErrorMessage(error, 'Failed to load comments');
    } finally {
      setLoading(false);
    }
    // Note: nextCursor is intentionally NOT in deps to avoid infinite loop
  }, [objectId, objectType, limit]);

  // Create new comment
  const createComment = useCallback(async (
    data: {
      content: string;
      objectId?: string;
      objectType?: 'post' | 'comment';
      replyToUserId?: string;
      replyToName?: string;
    },
    creator?: any
  ) => {
    try {
      setSubmitting(true);

      const targetObjectId = data.objectId || objectId;
      const targetObjectType = data.objectType || objectType;

      const payload = { ...data };
      delete payload.objectId;
      delete payload.objectType;

      const response = await createCommentApi(
        targetObjectType,
        targetObjectId,
        payload
      );

      if (response.data) {
        const newComment = response.data;

        if (creator) {
          newComment.user = {
            ...newComment.user,
            ...creator,
            avatar: creator.avatar || newComment.user?.avatar,
            name: creator.name || newComment.user?.name,
            username: creator.username || newComment.user?.username
          };
        }

        const isCurrentList =
          targetObjectId === objectId &&
          targetObjectType === objectType;

        if (isCurrentList) {
          setComments(prev => {
            if (prev.some(item => item._id === newComment._id)) return prev;

            return objectType === 'comment'
              ? [...prev, newComment]
              : [newComment, ...prev];
          });
          setTotal(prev => prev + 1);
        }

        return newComment;
      }
    } catch (error: any) {
      showErrorMessage(error, 'Failed to post comment', {
        toastId: 'comment-submit-error'
      });
      throw error;
    } finally {
      setSubmitting(false);
    }
  }, [objectId, objectType]);

  // Delete comment
  const deleteComment = useCallback(async (comment: IComment): Promise<boolean> => {
    if (!window.confirm('Are you sure you want to delete this comment?')) {
      return false;
    }

    try {
      await deleteCommentApi(comment._id);

      // Remove comment from list
      setComments(prev => prev.filter(c => c._id !== comment._id));
      setTotal(prev => prev - 1);

      return true;
    } catch (error: any) {
      showErrorMessage(error, 'Failed to delete comment');
      return false;
    }
  }, []);

  // Delete reply from comment list
  const deleteReply = useCallback((commentId: string) => {
    setComments(prev =>
      prev.filter(c => c._id !== commentId)
    );
  }, []);

  /**
   * Insert a comment that arrived over the socket at the top of the list.
   *
   * Only prepends a genuinely new comment; the cursor and the pages already
   * fetched are untouched, so canonical server ordering is preserved and
   * `loadMore` keeps paging from exactly where it was.
   */
  const insertLiveComment = useCallback((comment: IComment) => {
    setComments((prev) => (prev.some((item) => item._id === comment._id)
      ? prev
      : [comment, ...prev]));
    setTotal((current) => current + 1);
  }, []);

  /** Drop a comment removed elsewhere, so it cannot linger on screen. */
  const removeLiveComment = useCallback((commentId: string) => {
    setComments((prev) => {
      if (!prev.some((item) => item._id === commentId)) return prev;
      setTotal((current) => Math.max(0, current - 1));
      return prev.filter((item) => item._id !== commentId);
    });
  }, []);

  /**
   * Load the next cursor page.
   *
   * The in-flight guard is a ref rather than the `loading` state because the
   * scroll sentinel can fire several times in one synchronous batch, and every
   * one of those calls would close over the same stale `loading === false` and
   * issue a duplicate request. A ref is updated immediately, so the second and
   * third calls see the fetch that is already running.
   */
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || loading || !hasMore || !nextCursorRef.current) return;

    loadingMoreRef.current = true;
    try {
      await fetchComments(false);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [loading, hasMore, fetchComments]);

  // Refetch comments (reset to first page)
  const refetch = useCallback(async () => {
    nextCursorRef.current = null;
    await fetchComments(true);
  }, [fetchComments]);

  // Initial load
  useEffect(() => {
    if (!firstLoadRef.current && !autoload) {
      firstLoadRef.current = true;
      return;
    }

    if (objectId) {
      fetchComments(true);
    }
  }, [objectId, objectType, fetchComments, autoload]);

  return {
    comments,
    loading,
    submitting,
    total,
    hasMore,
    createComment,
    deleteComment,
    deleteReply,
    insertLiveComment,
    removeLiveComment,
    loadMore,
    refetch
  };
};
