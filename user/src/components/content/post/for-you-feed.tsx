'use client';

import { VideoPlayerRef } from '@components/ui/video-player';
import { useCreatorVideos } from '@hooks/use-creator-videos';
import { usePipFeedSync } from '@hooks/use-pip-feed-sync';
import { usePostInteractionState } from '@hooks/use-post-interactions';
import { PostNavigationDirection, usePostNavigationWheel } from '@hooks/use-post-navigation-wheel';
import { RecommendedVideoPage, useRecommendedVideos } from '@hooks/use-recommended-videos';
import { useVideoPlaybackContinuity } from '@hooks/use-video-playback-continuity';
import { IPost } from '@interfaces/post';
import { PopupPipVideo } from '@lib/popup-pip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getPopupVideo } from './home-feed-media';
import PostDetailModal from './post-detail-modal';
import PostNavigationControls from './post-navigation-controls';
import { PostVideoDetailTab } from './post-video-detail-panel';
import PostVideoStage, { PostVideoActionRail } from './post-video-stage';

interface ForYouFeedProps {
  initialData?: RecommendedVideoPage | null;
}

export default function ForYouFeed({ initialData }: ForYouFeedProps) {
  const playerRef = useRef<VideoPlayerRef>(null);
  const { posts, hasMore, loading, error, loadMore, updatePostInteraction } = useRecommendedVideos(initialData);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [detailPanelTab, setDetailPanelTab] = useState<PostVideoDetailTab | null>(null);
  const [detailModalPost, setDetailModalPost] = useState<IPost | null>(null);
  const [detailModalInitialTime, setDetailModalInitialTime] = useState(0);

  const activePost = posts[currentIndex];
  const {
    resumeTime,
    getPlaybackTime,
    rememberPlaybackTime,
    resumePlayback
  } = useVideoPlaybackContinuity(activePost?._id);
  const creatorVideos = useCreatorVideos({
    userId: activePost?.user?._id,
    currentPost: activePost,
    enabled: detailPanelTab === 'videos'
  });
  const canPrevious = currentIndex > 0;
  const canNext = currentIndex < posts.length - 1;
  const popupPlaylist = useMemo(() => posts
    .map(getPopupVideo)
    .filter((video): video is PopupPipVideo => Boolean(video)), [posts]);
  const activeInteraction = usePostInteractionState(activePost, updatePostInteraction);

  const navigate = useCallback((direction: PostNavigationDirection) => {
    setCurrentIndex((index) => {
      if (direction === 'previous') return Math.max(0, index - 1);
      return Math.min(posts.length - 1, index + 1);
    });
  }, [posts.length]);

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
    if (posts.length - currentIndex <= 3 && hasMore && !loading) void loadMore();
  }, [currentIndex, hasMore, loadMore, loading, posts.length]);

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
        className="home-feed-scrollbar relative h-full min-h-0 flex-1 overflow-hidden bg-(--page-bg) text-white"
        onWheel={handleWheel}
      >
        <PostVideoStage
          key={activePost._id}
          post={activePost}
          playerId={`for-you-${activePost._id}`}
          popupPlaylist={popupPlaylist}
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
        >
          <PostVideoActionRail
            post={activePost}
            className="right-18 pr-4"
            isLikedOverride={activeInteraction.isLiked}
            totalLikeOverride={activeInteraction.totalLike}
            totalCommentOverride={activeInteraction.totalComment}
            onLikeChange={activeInteraction.handleLikeChange}
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
          popupPlaylist={popupPlaylist}
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
