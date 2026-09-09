'use client';

import { IPost } from '@interfaces/post';
import { useCallback, useEffect, useRef } from 'react';

import { enqueueRecommendationEvent, RecommendationEventSource } from '../lib/recommendation-event-queue';
import { PostDetailSource } from './use-post-detail-sequence';

interface UseRecommendationDetailTrackingOptions {
  post: IPost;
  /** The modal's own `source` prop — mapped to the coarser recommendation event source below. */
  source?: PostDetailSource;
  /** `useRecommendationDetailFeed`'s session id (Home/direct-link) or the For You feed session id. */
  sessionId?: string | null;
}

/**
 * `detail_open`, and like/share/follow attribution composed with the real
 * interaction handlers, for a post open inside `PostDetailModal` — shared by
 * `GraphicPostDetail` and `VideoPostDetail` so the two layouts cannot drift
 * (the same failure mode documented at the top of this file's module: two
 * copies, one missing a rule, nothing notices).
 *
 * A source of `'for-you'` reports recommendation events as `'for-you'`
 * (continuing that feed's own session); every other source — `home-feed`,
 * `direct-link`, `notification`, `message-shared-post` — reports `'post-detail'`,
 * since none of those are a feed session, only the anchor-based Post Detail
 * one. `following-feed`/creator-scoped sources are never given a
 * `sessionId` by their callers, so every event here is a no-op for them.
 */
export function useRecommendationDetailTracking({ post, source, sessionId }: UseRecommendationDetailTrackingOptions) {
  const recoSource: RecommendationEventSource = source === 'for-you' ? 'for-you' : 'post-detail';

  /*
   * One `detail_open` per genuine exposure, not per mount.
   *
   * This hook is called by both popup layouts, so stepping between a photo and
   * a video unmounts one and mounts the other — and returning to a post the
   * viewer already had open (Back out of the creator grid) remounts it with the
   * same session and the same post. The effect then re-fired for an identity
   * that had already been reported, and the duplicate landed in the same batch
   * as the original often enough to be rejected by the unique index rather than
   * absorbed by the server's pre-check.
   *
   * The exposure key is what changes, not the mount, so it is what the guard
   * remembers. A genuinely new exposure — a different post, or the same post in
   * a new recommendation session — has a different key and reports normally.
   */
  const reportedExposureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const exposureKey = `${sessionId}:${post._id}`;
    if (reportedExposureRef.current === exposureKey) return;
    reportedExposureRef.current = exposureKey;
    enqueueRecommendationEvent({
      postId: post._id, sessionId, eventType: 'detail_open', source: recoSource
    });
    // Intentionally keyed on the post/session pair only — refiring on every
    // render would spam the queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post._id, sessionId]);

  const trackLikeChange = useCallback((original?: (isLiked: boolean, totalLikes: number) => void) => (
    isLiked: boolean, totalLikes: number
  ) => {
    original?.(isLiked, totalLikes);
    if (isLiked && sessionId) {
      enqueueRecommendationEvent({
        postId: post._id, sessionId, eventType: 'like', source: recoSource
      });
    }
  }, [post._id, recoSource, sessionId]);

  const trackShared = useCallback((original?: () => void) => () => {
    original?.();
    if (sessionId) {
      enqueueRecommendationEvent({
        postId: post._id, sessionId, eventType: 'share', source: recoSource
      });
    }
  }, [post._id, recoSource, sessionId]);

  const trackFollow = useCallback((creatorId: string) => {
    if (sessionId && post.user?._id === creatorId) {
      enqueueRecommendationEvent({
        postId: post._id, sessionId, eventType: 'follow_after_view', source: recoSource
      });
    }
  }, [post._id, post.user?._id, recoSource, sessionId]);

  /**
   * Fired from `CommentWrapper`'s `onCommentCreate`, which runs only where a
   * comment genuinely *was* created by this viewer (`handleCreateComment`'s
   * success branch) — never from a total-count change, which is also how
   * somebody else's comment arriving over the socket looks.
   *
   * Carries the real `commentId`: the server re-reads that comment and checks
   * it exists, was written by the authenticated actor, and belongs to this
   * post (through its parent, for a reply) before applying any signal, and
   * uses it as the dedupe key so a queue retry cannot double-count
   * (rules/instructions §2). A reply reports the post it belongs to, once —
   * not the parent comment, and not twice.
   */
  const trackCommentCreate = useCallback((comment: { _id?: string } | null | undefined) => {
    if (!sessionId || !comment?._id) return;
    enqueueRecommendationEvent({
      postId: post._id, sessionId, eventType: 'comment', source: recoSource, commentId: comment._id
    });
  }, [post._id, recoSource, sessionId]);

  return {
    trackLikeChange, trackShared, trackFollow, trackCommentCreate
  };
}
