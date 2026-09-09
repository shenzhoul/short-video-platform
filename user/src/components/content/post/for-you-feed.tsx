'use client';

import { VideoPlayerRef } from '@components/ui/video-player';
import { useElementHeight } from '@hooks/use-element-height';
import { useNavigationInputActive } from '@hooks/use-navigation-input-active';
import { usePipFeedSync } from '@hooks/use-pip-feed-sync';
import { usePostDetailMode } from '@hooks/use-post-detail-mode';
import { usePostDetailSequence } from '@hooks/use-post-detail-sequence';
import { usePostDragNavigation } from '@hooks/use-post-drag-navigation';
import { usePostInteractionState } from '@hooks/use-post-interactions';
import { usePostNavigationWheel } from '@hooks/use-post-navigation-wheel';
import { useRecommendationImpression } from '@hooks/use-recommendation-impression';
import { useRecommendationPhotoDwell } from '@hooks/use-recommendation-photo-dwell';
import { useRecommendationWatchTracking } from '@hooks/use-recommendation-watch-tracking';
import { RecommendedVideoPage, useRecommendedVideos } from '@hooks/use-recommended-videos';
import { useVideoPlaybackContinuity } from '@hooks/use-video-playback-continuity';
import { IPost } from '@interfaces/post';
import { enqueueRecommendationEvent } from '@lib/recommendation-event-queue';
import { useMessageWorkspace } from '@providers/message-workspace.provider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isVideoPost, supportsPostDetail } from './home-feed-media';
import PostDetailModal from './post-detail-modal';
import PostFeedDragViewport from './post-feed-drag-viewport';
import PostNavigationControls from './post-navigation-controls';
import { PostVideoDetailTab } from './post-video-detail-panel';
import PostVideoStage, { PostVideoActionRail } from './post-video-stage';

interface ForYouFeedProps {
  initialData?: RecommendedVideoPage | null;
}

export default function ForYouFeed({ initialData }: ForYouFeedProps) {
  const playerRef = useRef<VideoPlayerRef>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const {
    posts: rawPosts, loading, error, hasMore, sessionId, sessionForPost, loadMore, updatePostInteraction
  } = useRecommendedVideos(initialData);
  /*
   * A recommended post the stage cannot draw is skipped rather than rendered.
   *
   * `supportsPostDetail` is true for a video with a playable URL and for photos
   * with at least one image. Anything else — a post whose media never finished
   * processing, or a legacy row with an empty `files` array — would otherwise
   * become a blank stage the viewer cannot get past, because next/previous move
   * by index through this same array.
   *
   * The reason is logged rather than swallowed: a silently shorter feed is how
   * a data problem stays invisible.
   */
  const posts = useMemo(() => {
    const usable = rawPosts.filter(supportsPostDetail);
    if (process.env.NODE_ENV !== 'production' && usable.length !== rawPosts.length) {
      rawPosts
        .filter((post) => !supportsPostDetail(post))
        .forEach((post) => console.warn(
          `[for-you] skipped post ${post._id}: no playable video and no images `
          + `(type=${post.type}, files=${(post.files || []).length})`
        ));
    }
    return usable;
  }, [rawPosts]);
  const [currentIndex, setCurrentIndex] = useState(0);
  /**
   * A post reached through the creator grid that the recommendation feed does
   * not hold.
   *
   * Creator mode navigates that creator's catalogue, which is a different list —
   * so "next" there routinely lands on a post with no index in `posts`. Holding
   * it beside the index rather than trying to force it into the feed keeps the
   * feed position intact underneath, so closing the grid resumes the browse
   * instead of restarting it.
   */
  const [creatorStagePost, setCreatorStagePost] = useState<IPost | null>(null);
  const [detailPanelTab, setDetailPanelTab] = useState<PostVideoDetailTab | null>(null);
  const [detailModalPost, setDetailModalPost] = useState<IPost | null>(null);
  const [detailModalInitialTime, setDetailModalInitialTime] = useState(0);

  const activePost = creatorStagePost || posts[currentIndex];
  /*
   * Attribution follows the post, not the newest session.
   *
   * A For You session is a bounded segment: scrolling far enough opens a second
   * and third one while posts from the first are still on screen. Reporting
   * their impressions and watch time under whichever session is newest would
   * file that evidence against a ranking that never chose them.
   */
  const activeSessionId = sessionForPost(activePost?._id) || sessionId;
  const {
    resumeTime,
    getPlaybackTime,
    rememberPlaybackTime,
    resumePlayback
  } = useVideoPlaybackContinuity(activePost?._id);
  /*
   * The inline stage runs the same three navigation contexts the detail popup
   * does, resolved by the same function and driven by the same controller.
   *
   * It used to disable navigation outright whenever any tab was open, so the
   * Videos tab — the creator's own grid — could not be stepped through here at
   * all, while the popup stepped through it. Two surfaces showing the same grid
   * and answering "next" differently is precisely the split
   * `usePostDetailSequence` exists to close, so For You now calls it rather
   * than keeping a second, thinner copy.
   */
  const inputActive = useNavigationInputActive(stageContainerRef);
  /*
    Messages sits beside the media here, not on top of it. For You keeps the
    header and the rail, so it is not a fullscreen surface — but it does lay
    itself out in columns, and the panel used to cover the post entirely.
  */
  const { open: messagesOpen, claimColumnPlacement } = useMessageWorkspace();
  useEffect(() => claimColumnPlacement(), [claimColumnPlacement]);
  const { mode, creatorId } = usePostDetailMode({
    post: activePost,
    panelTab: detailPanelTab,
    source: 'for-you',
    inputActive,
    messagesOpen
  });
  const activeInteraction = usePostInteractionState(activePost, updatePostInteraction);

  useRecommendationImpression({
    elementRef: stageContainerRef,
    enabled: true,
    postId: activePost?._id,
    sessionId: activeSessionId,
    source: 'for-you'
  });
  /*
   * Watch quality and photo dwell are different vocabularies for the same
   * question, and which one applies is decided by the post, not the surface.
   * A photo on this stage produces no `timeupdate`, so before photos were drawn
   * here at all it produced no watch signal either — and would now produce a
   * permanently empty one if the video hook stayed enabled for it.
   */
  const activeIsVideo = activePost ? isVideoPost(activePost) : false;
  const watchTracking = useRecommendationWatchTracking({
    enabled: activeIsVideo,
    postId: activePost?._id,
    sessionId: activeSessionId,
    source: 'for-you'
  });
  useRecommendationPhotoDwell({
    enabled: Boolean(activePost) && !activeIsVideo && Boolean(activeSessionId) && !detailModalPost,
    postId: activePost?._id,
    sessionId: activeSessionId,
    source: 'for-you'
  });

  /**
   * Fires the recommendation-scoped `like` signal alongside the real like
   * mutation `LikeButton` already performs (`activeInteraction.handleLikeChange`
   * only patches local state) — never on an *unlike*, and only when there is
   * an active session to attribute it to.
   */
  const handleLikeChangeWithTracking = useCallback((isLiked: boolean, totalLike: number) => {
    activeInteraction.handleLikeChange(isLiked, totalLike);
    if (isLiked && activePost && activeSessionId) {
      enqueueRecommendationEvent({
        postId: activePost._id, sessionId: activeSessionId, eventType: 'like', source: 'for-you'
      });
    }
  }, [activeInteraction, activePost, activeSessionId]);

  /**
   * Fires the recommendation `comment` signal from the one place a comment
   * genuinely was created by this viewer (`CommentWrapper.onCommentCreate`),
   * carrying the real comment id for server-side verification — never from a
   * total-count change, which is also what another viewer's comment arriving
   * over the socket looks like (rules/instructions §2).
   */
  const handleCommentCreateWithTracking = useCallback((comment: { _id?: string }) => {
    if (!activePost || !activeSessionId || !comment?._id) return;
    enqueueRecommendationEvent({
      postId: activePost._id, sessionId: activeSessionId, eventType: 'comment', source: 'for-you', commentId: comment._id
    });
  }, [activePost, activeSessionId]);

  /**
   * Fires the recommendation `share` signal from the one place a share
   * genuinely succeeded.
   *
   * `PostVideoActionRail` only calls `onShared` once the server reports the
   * share was recorded, so a cancelled popover, a failed request, or a
   * re-share that moves no counter never reaches here. This rail wired
   * `onLikeChange` and `onFollow` but not `onShared`, so sharing from For You
   * created a real message and a real share reaction while the recommender
   * learned nothing from it — the signal existed on `PostDetailModal`'s rails
   * and nowhere else.
   */
  const handleSharedWithTracking = useCallback(() => {
    if (!activePost || !activeSessionId) return;
    enqueueRecommendationEvent({
      postId: activePost._id, sessionId: activeSessionId, eventType: 'share', source: 'for-you'
    });
  }, [activePost, activeSessionId]);

  const handleFollowWithTracking = useCallback((creatorId: string) => {
    if (activePost && activeSessionId && activePost.user?._id === creatorId) {
      enqueueRecommendationEvent({
        postId: activePost._id, sessionId: activeSessionId, eventType: 'follow_after_view', source: 'for-you'
      });
    }
  }, [activePost, activeSessionId]);

  /**
   * Show a post on the inline stage, wherever the sequence found it.
   *
   * A recommendation-mode neighbour is in `posts`, so it moves the index and
   * everything keyed off it (impressions, watch tracking, prefetch) follows. A
   * creator-mode neighbour usually is not — the creator's catalogue is a
   * different list — so it is held separately and shown over the feed position,
   * which is preserved underneath and resumed when the grid closes.
   */
  const showPost = useCallback((next: IPost) => {
    const feedIndex = posts.findIndex((item) => item._id === next._id);
    if (feedIndex >= 0) {
      setCreatorStagePost(null);
      setCurrentIndex(feedIndex);
      return;
    }
    setCreatorStagePost(next);
  }, [posts]);

  const sequence = usePostDetailSequence({
    post: activePost,
    feedPosts: posts,
    mode,
    creatorId,
    // A ranked session is a bounded segment and `loadMore` opens the next one,
    // so "next" is a real option past the end of the loaded array.
    hasMoreAhead: hasMore,
    onNavigate: showPost
  });
  const creatorVideos = sequence.creatorPosts;
  const canPrevious = Boolean(sequence.previousPost);
  const canNext = sequence.canNext;
  const navigate = sequence.navigate;

  const openDetailModal = useCallback((post: IPost) => {
    const activeTime = playerRef.current?.getVideoElement()?.currentTime;
    if (activePost && Number.isFinite(activeTime)) {
      rememberPlaybackTime(activePost._id, activeTime as number);
    }
    const initialTime = post._id === activePost?._id && Number.isFinite(activeTime)
      ? activeTime as number
      : getPlaybackTime(post._id);
    setDetailModalInitialTime(initialTime);
    setDetailModalPost(post);
  }, [activePost, getPlaybackTime, rememberPlaybackTime]);

  const navigateDetailModal = useCallback((post: IPost) => {
    setDetailModalInitialTime(getPlaybackTime(post._id));
    setDetailModalPost(post);
  }, [getPlaybackTime]);

  const closeDetailModal = useCallback(() => {
    if (activePost) resumePlayback(activePost._id);
    setDetailModalPost(null);
  }, [activePost, resumePlayback]);

  useEffect(() => {
    // No `hasMore` guard: a ranked session is a bounded segment, and `loadMore`
    // opens a fresh one when this one is spent. Gating on `hasMore` would stop
    // the feed dead at the end of the first segment.
    if (posts.length - currentIndex <= 3 && !loading) void loadMore();
  }, [currentIndex, loadMore, loading, posts.length]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (detailModalPost) return;
      if (event.key === 'ArrowUp') navigate('previous');
      if (event.key === 'ArrowDown') navigate('next');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detailModalPost, navigate]);

  const handleWheel = usePostNavigationWheel({
    canPrevious,
    canNext,
    onNavigate: navigate
  });
  /*
    Touch had no navigation path at all: the feed is index-based with
    `overflow: hidden`, so there is nothing to scroll, and the only forward
    control was the up/down capsule the compact layout hides. Same threshold and
    same lock as the wheel, so a flick and a scroll notch mean the same thing.
  */
  /*
    Touch drags the stage rather than firing at a threshold: the current post
    follows the finger and the neighbour it uncovers is visible the whole way,
    which is what makes the feed read as a stack of cards. A release short of
    the commit distance springs back, so an accidental drag during a tap costs
    nothing.
  */
  const itemHeight = useElementHeight(stageContainerRef);
  const drag = usePostDragNavigation({
    canPrevious,
    canNext,
    onNavigate: navigate,
    itemHeight,
    enabled: mode !== 'disabled'
  });
  const popupPipState = usePipFeedSync(posts, activePost, useCallback((index: number) => {
    setCreatorStagePost(null);
    setCurrentIndex(index);
  }, []));

  if (!activePost) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-(--page-bg) text-sm font-semibold text-white/65">
        <span>{loading ? 'Loading recommendations...' : error || 'No recommended videos yet'}</span>
        {error && !loading ? (
          <button type="button" onClick={() => void loadMore()} className="cursor-pointer rounded-full bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-white/85">
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div
        ref={stageContainerRef}
        className="relative h-full min-h-0 flex-1 overflow-hidden bg-(--page-bg) text-white touch-pan-x"
        onWheel={handleWheel}
        {...drag.handlers}
      >
        <PostFeedDragViewport
          itemHeight={itemHeight}
          dragDeltaY={drag.dragDeltaY}
          transitionMs={drag.transitionMs}
          previewDirection={drag.previewDirection}
          previousPost={sequence.previousPost}
          nextPost={sequence.nextPost}
        >
          <PostVideoStage
            key={activePost._id}
            post={activePost}
            playerId={`for-you-${activePost._id}`}
            popupPipState={popupPipState}
            playerRef={playerRef}
            initialTime={resumeTime}
            isActiveSlide={!detailModalPost}
            rightGutter="var(--feed-nav-gutter, 68px)"
            detailPanelTab={detailPanelTab}
            onDetailPanelTabChange={setDetailPanelTab}
            creatorVideos={creatorVideos.posts}
            creatorVideosLoading={creatorVideos.loading}
            creatorVideosHasMore={creatorVideos.hasMore}
            creatorVideosError={creatorVideos.error}
            onLoadMoreCreatorVideos={creatorVideos.loadMore}
            onSelectCreatorVideo={openDetailModal}
            onTotalCommentChange={activeInteraction.handleTotalCommentChange}
            onCommentCreate={handleCommentCreateWithTracking}
            onTimeUpdate={watchTracking.handleTimeUpdate}
            onPause={watchTracking.handlePause}
            onEnded={watchTracking.handleEnded}
          >
            <PostVideoActionRail
              post={activePost}
              mediaVariant={activeIsVideo ? 'video' : 'graphic'}
              className="right-18 max-lg:right-0 pr-4 max-lg:pr-1"
              isLikedOverride={activeInteraction.isLiked}
              totalLikeOverride={activeInteraction.totalLike}
              totalCommentOverride={activeInteraction.totalComment}
              onLikeChange={handleLikeChangeWithTracking}
              onShared={handleSharedWithTracking}
              onFollow={handleFollowWithTracking}
              onAvatarClick={() => openDetailModal(activePost)}
              footer={loading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
            ) : null}
            />
          </PostVideoStage>
        </PostFeedDragViewport>

        <aside
          className="absolute right-4 top-1/2 z-80 flex -translate-y-1/2 items-center justify-center max-lg:hidden"
          aria-label="Video navigation"
        >
          <PostNavigationControls
            canPrevious={canPrevious}
            canNext={canNext}
            onNavigate={navigate}
          />
        </aside>

      </div>
      {detailModalPost ? (
        <PostDetailModal
          post={detailModalPost}
          posts={posts}
          source="for-you"
          recommendationSessionId={sessionForPost(detailModalPost._id) || sessionId}
          initialTime={detailModalInitialTime}
          onPlaybackTimeChange={(currentTime) => {
            rememberPlaybackTime(detailModalPost._id, currentTime);
          }}
          onClose={closeDetailModal}
          onNavigate={navigateDetailModal}
          initialDetailPanelTab="videos"
          closeOnVideoModeBack
          closeOnAvatarClick
          onInteractionChange={updatePostInteraction}
        />
      ) : null}
    </>
  );
}
