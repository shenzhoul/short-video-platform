'use client';

import { VideoPlayerRef } from '@components/ui/video-player';
import { useCreatorVideos } from '@hooks/use-creator-videos';
import { usePipFeedSync } from '@hooks/use-pip-feed-sync';
import { usePostInteractionState } from '@hooks/use-post-interactions';
import { PostNavigationDirection, usePostNavigationWheel } from '@hooks/use-post-navigation-wheel';
import { useRecommendationImpression } from '@hooks/use-recommendation-impression';
import { useRecommendationPhotoDwell } from '@hooks/use-recommendation-photo-dwell';
import { useRecommendationWatchTracking } from '@hooks/use-recommendation-watch-tracking';
import { RecommendedVideoPage, useRecommendedVideos } from '@hooks/use-recommended-videos';
import { useVideoPlaybackContinuity } from '@hooks/use-video-playback-continuity';
import { IPost } from '@interfaces/post';
import { enqueueRecommendationEvent } from '@lib/recommendation-event-queue';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isVideoPost, supportsPostDetail } from './home-feed-media';
import PostDetailModal from './post-detail-modal';
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
    posts: rawPosts, loading, error, sessionId, sessionForPost, loadMore, updatePostInteraction
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
  const [detailPanelTab, setDetailPanelTab] = useState<PostVideoDetailTab | null>(null);
  const [detailModalPost, setDetailModalPost] = useState<IPost | null>(null);
  const [detailModalInitialTime, setDetailModalInitialTime] = useState(0);

  const activePost = posts[currentIndex];
  /*
   * Attribution follows the post, not the newest session.
   *
   * A For You session is a bounded segment: scrolling far enough opens a second
   * and third one while posts from the first are still on screen. Reporting
   * their impressions and watch time under whichever session is newest would
   * file that evidence against a ranking that never chose them.
   */
  const activeSessionId = sessionForPost(activePost?.feedKey) || sessionId;
  const {
    resumeTime,
    getPlaybackTime,
    rememberPlaybackTime,
    resumePlayback
  } = useVideoPlaybackContinuity(activePost?._id);
  /*
   * The same three navigation modes the detail modal has, applied to the inline
   * stage.
   *
   * With the creator grid open, up/down used to keep walking the For You feed —
   * so the grid on screen belonged to one creator while the arrows carried the
   * viewer to another's post, and the panel header then followed the new post.
   * Which list owns next/previous is decided here, once.
   */
  const creatorScopeCreatorId = useRef<string | null>(null);
  const inCreatorMode = detailPanelTab === 'videos';
  if (inCreatorMode && !creatorScopeCreatorId.current) {
    creatorScopeCreatorId.current = activePost?.user?._id || null;
  } else if (!inCreatorMode && creatorScopeCreatorId.current) {
    creatorScopeCreatorId.current = null;
  }
  const creatorVideos = useCreatorVideos({
    userId: inCreatorMode ? creatorScopeCreatorId.current || undefined : undefined,
    currentPost: activePost,
    enabled: inCreatorMode
  });
  // Creator mode navigates the creator's posts; any other open tab navigates
  // nothing; a closed panel navigates the recommendation session.
  const feedNavigationEnabled = !detailPanelTab;
  const canPrevious = feedNavigationEnabled && currentIndex > 0;
  const canNext = feedNavigationEnabled && currentIndex < posts.length - 1;
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

  const navigate = useCallback((direction: PostNavigationDirection) => {
    // Locked and creator modes do not move the feed; the creator grid's own
    // tiles are how the viewer moves inside a creator here.
    if (!feedNavigationEnabled) return;
    setCurrentIndex((index) => {
      if (direction === 'previous') return Math.max(0, index - 1);
      return Math.min(posts.length - 1, index + 1);
    });
  }, [feedNavigationEnabled, posts.length]);

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
  const popupPipState = usePipFeedSync(posts, activePost, setCurrentIndex);

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
        className="relative h-full min-h-0 flex-1 overflow-hidden bg-(--page-bg) text-white"
        onWheel={handleWheel}
      >
        <PostVideoStage
          key={activePost._id}
          post={activePost}
          playerId={`for-you-${activePost._id}`}
          popupPipState={popupPipState}
          playerRef={playerRef}
          initialTime={resumeTime}
          isActiveSlide={!detailModalPost}
          rightGutter="68px"
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
            className="right-18 pr-4"
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

        <aside
          className="absolute right-4 top-1/2 z-80 flex -translate-y-1/2 items-center justify-center"
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
          recommendationSessionId={sessionForPost(detailModalPost.feedKey) || sessionId}
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
