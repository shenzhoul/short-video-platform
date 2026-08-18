'use client';

import Carousel, {
  CarouselNavigationButton,
  CarouselTimelineControl
} from '@components/ui/carousel';
import { VideoPlayerRef } from '@components/ui/video-player';
import { useCreatorVideos } from '@hooks/use-creator-videos';
import { FollowingFeedPage, useFollowingFeed } from '@hooks/use-following-feed';
import { usePipFeedSync } from '@hooks/use-pip-feed-sync';
import { usePostInteractionState } from '@hooks/use-post-interactions';
import { PostNavigationDirection, usePostNavigationWheel } from '@hooks/use-post-navigation-wheel';
import { useVideoPlaybackContinuity } from '@hooks/use-video-playback-continuity';
import { IPost } from '@interfaces/post';
import { IUser } from '@interfaces/user';
import { GRAPHIC_SLIDE_DURATION_MS } from '@lib/post-graphic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { CopyIcon, PauseIcon, PlayIcon } from 'src/icons';

import HomeFeedCoverImage from '../content/post/home-feed-cover-image';
import { getPopupVideo, getPostImages, isGraphicPost } from '../content/post/home-feed-media';
import PostDetailModal from '../content/post/post-detail-modal';
import PostNavigationControls from '../content/post/post-navigation-controls';
import { PostVideoDetailTab } from '../content/post/post-video-detail-panel';
import PostVideoStage, { PostVideoActionRail } from '../content/post/post-video-stage';
import FollowingCreatorsRail from './following-creators-rail';

interface FollowingFeedProps {
  initialData?: FollowingFeedPage | null;
  initialCreators?: IUser[];
}

export default function FollowingFeed({ initialData, initialCreators = [] }: FollowingFeedProps) {
  const playerRef = useRef<VideoPlayerRef>(null);
  const { posts, hasMore, loading, error, loadMore, updatePostInteraction, markCreatorFollowed, unfollowCreator } = useFollowingFeed(initialData);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [unfollowedCreatorIds, setUnfollowedCreatorIds] = useState<Set<string>>(() => new Set());
  const [detailPanelTab, setDetailPanelTab] = useState<PostVideoDetailTab | null>(null);
  const [detailModalPost, setDetailModalPost] = useState<IPost | null>(null);
  const [detailModalInitialTime, setDetailModalInitialTime] = useState(0);
  const [detailModalTab, setDetailModalTab] = useState<PostVideoDetailTab | null>(null);
  const [graphicPlaying, setGraphicPlaying] = useState(true);
  const activePost = posts[currentIndex];
  const {
    resumeTime,
    getPlaybackTime,
    rememberPlaybackTime,
    resumePlayback
  } = useVideoPlaybackContinuity(activePost?._id);
  const activeInteraction = usePostInteractionState(activePost, updatePostInteraction);
  const graphicPost = activePost ? isGraphicPost(activePost) : false;
  const images = useMemo(() => activePost ? getPostImages(activePost) : [], [activePost]);
  const graphicSlideshowPlaying = images.length > 1 && graphicPlaying;
  const popupPlaylist = useMemo(() => posts.map(getPopupVideo).filter(Boolean) as NonNullable<ReturnType<typeof getPopupVideo>>[], [posts]);
  const creators = useMemo(() => {
    const creatorMap = new Map(initialCreators.map(creator => [creator._id, creator]));
    posts.forEach(post => {
      if (post.user?._id && !creatorMap.has(post.user._id)) creatorMap.set(post.user._id, post.user);
    });
    return [...creatorMap.values()].filter(creator => !unfollowedCreatorIds.has(creator._id));
  }, [initialCreators, posts, unfollowedCreatorIds]);
  const creatorVideos = useCreatorVideos({
    userId: activePost?.user?._id,
    currentPost: activePost,
    enabled: detailPanelTab === 'videos'
  });

  const navigate = useCallback((direction: PostNavigationDirection) => {
    setDetailPanelTab(null);
    setCurrentIndex(index => direction === 'previous'
      ? Math.max(0, index - 1)
      : Math.min(posts.length - 1, index + 1));
  }, [posts.length]);
  const wheel = usePostNavigationWheel({
    canPrevious: currentIndex > 0,
    canNext: currentIndex < posts.length - 1,
    onNavigate: navigate
  });
  const popupPipState = usePipFeedSync(posts, activePost, setCurrentIndex);

  useEffect(() => {
    if (posts.length - currentIndex <= 3 && hasMore && !loading) void loadMore();
  }, [currentIndex, hasMore, loadMore, loading, posts.length]);

  useEffect(() => {
    setGraphicPlaying(true);
  }, [activePost?._id]);

  useEffect(() => {
    if (currentIndex >= posts.length) setCurrentIndex(Math.max(0, posts.length - 1));
  }, [currentIndex, posts.length]);

  const handleUnfollowCreator = useCallback(async (creatorId: string) => {
    await unfollowCreator(creatorId);
    setUnfollowedCreatorIds(current => new Set(current).add(creatorId));
  }, [unfollowCreator]);

  const openDetailModal = useCallback((post: IPost, tab: PostVideoDetailTab | null = null) => {
    const activeTime = playerRef.current?.getVideoElement()?.currentTime;
    if (activePost && !isGraphicPost(activePost) && Number.isFinite(activeTime)) {
      rememberPlaybackTime(activePost._id, activeTime as number);
    }
    const initialTime = post._id === activePost?._id && Number.isFinite(activeTime)
      ? activeTime as number
      : getPlaybackTime(post._id);
    setDetailModalInitialTime(initialTime);
    setDetailModalTab(tab);
    setDetailModalPost(post);
  }, [activePost, getPlaybackTime, rememberPlaybackTime]);

  const openCreatorVideos = useCallback((creatorId: string) => {
    const videoIndex = posts.findIndex(post => post.user?._id === creatorId && !isGraphicPost(post));
    const fallbackIndex = posts.findIndex(post => post.user?._id === creatorId);
    const index = videoIndex >= 0 ? videoIndex : fallbackIndex;
    if (index < 0) return;

    setCurrentIndex(index);
    openDetailModal(posts[index], 'videos');
  }, [openDetailModal, posts]);

  const navigateDetailModal = useCallback((post: IPost) => {
    setDetailModalInitialTime(getPlaybackTime(post._id));
    setDetailModalPost(post);
  }, [getPlaybackTime]);

  const closeDetailModal = useCallback(() => {
    if (activePost && !isGraphicPost(activePost)) resumePlayback(activePost._id);
    setDetailModalPost(null);
    setDetailModalTab(null);
  }, [activePost, resumePlayback]);

  if (!activePost) {
    return (
      <div className="flex h-full min-h-0 w-full">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-(--page-bg) text-sm font-semibold text-(--text-muted)">
          <span>{loading ? 'Loading followed posts...' : error || 'Follow creators to see their latest posts here.'}</span>
          {error ? <button type="button" onClick={() => void loadMore()} className="cursor-pointer rounded-full bg-white px-4 py-2 text-xs font-bold text-black">Try again</button> : null}
        </div>
      </div>
    );
  }

  const description = activePost.text || activePost.tagline;
  return (
    <div className="flex h-full min-h-0 w-full bg-(--page-bg)">
      <FollowingCreatorsRail
        creators={creators}
        activeCreatorId={activePost.user?._id}
        onSelectCreator={openCreatorVideos}
        onUnfollowCreator={handleUnfollowCreator}
      />
      <section className="relative min-w-0 flex-1 overflow-hidden text-white" onWheel={wheel}>
        {graphicPost ? (
          <div className="relative h-full w-full overflow-hidden">
            <div
              className="relative h-full overflow-hidden rounded-2xl bg-black shadow-[0_24px_70px_rgba(0,0,0,.32)]"
              style={{ width: 'calc(100% - 68px)' }}
              onClick={() => {
                if (images.length > 1) setGraphicPlaying(current => !current);
              }}
            >
              <Carousel
                className="h-full w-full"
                slideClassName="h-full"
                interval={GRAPHIC_SLIDE_DURATION_MS}
                playing={graphicSlideshowPlaying}
                timelineAutoplay
                resetKey={activePost._id}
                control={(
                  <>
                    <CarouselNavigationButton
                      direction="previous"
                      className="absolute left-5 top-1/2 z-40 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/35 text-white/85 backdrop-blur-sm transition hover:bg-black/55 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                    >
                      <FaChevronLeft />
                    </CarouselNavigationButton>
                    <CarouselNavigationButton
                      direction="next"
                      className="absolute right-28 top-1/2 z-40 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/35 text-white/85 backdrop-blur-sm transition hover:bg-black/55 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
                    >
                      <FaChevronRight />
                    </CarouselNavigationButton>
                    <CarouselTimelineControl className="pointer-events-none absolute inset-x-0 bottom-11 z-50 px-3" />
                  </>
                )}
              >
                {images.map((image, index) => (
                  <HomeFeedCoverImage key={image._id || image.url} src={image.url} alt={`${description || 'Post'} ${index + 1}`} loading={index ? 'lazy' : 'eager'} />
                ))}
              </Carousel>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-2/5 bg-linear-to-t from-black/85 to-transparent" />
              <div className="pointer-events-none absolute bottom-16 left-5 z-30 max-w-[55%]">
                <p className="text-base font-bold">@{activePost.user?.name || activePost.user?.username}</p>
                {description ? <p className="mt-2 text-sm leading-6">{description}</p> : null}
                <span className="mt-2 inline-flex items-center gap-1 rounded bg-white/15 px-2 py-1 text-xs"><CopyIcon /> Text and images</span>
              </div>
              {!graphicSlideshowPlaying && images.length > 1 ? (
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    setGraphicPlaying(true);
                  }}
                  className="absolute left-1/2 top-1/2 z-50 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/40 text-4xl text-white backdrop-blur-sm transition hover:scale-105 hover:bg-black/55 focus-visible:outline-2 focus-visible:outline-white"
                  aria-label="Play image slideshow"
                >
                  <PlayIcon />
                </button>
              ) : null}
              <div className="absolute inset-x-0 bottom-0 z-40 flex h-11 items-center bg-linear-to-t from-black/90 to-black/25 px-3">
                <button
                  type="button"
                  onClick={event => {
                    event.stopPropagation();
                    setGraphicPlaying(current => !current);
                  }}
                  disabled={images.length <= 1}
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-3xl text-white transition hover:bg-white/15 disabled:cursor-default disabled:opacity-45"
                  aria-label={graphicSlideshowPlaying ? 'Pause image slideshow' : 'Play image slideshow'}
                >
                  {graphicSlideshowPlaying ? <PauseIcon /> : <PlayIcon />}
                </button>
              </div>
            </div>
            <PostVideoActionRail
              post={activePost}
              mediaVariant="graphic"
              className="right-18 pr-4"
              isLikedOverride={activeInteraction.isLiked}
              totalLikeOverride={activeInteraction.totalLike}
              totalCommentOverride={activeInteraction.totalComment}
              onLikeChange={activeInteraction.handleLikeChange}
              onFollow={markCreatorFollowed}
              onAvatarClick={() => openDetailModal(activePost, 'videos')}
              onOpenPanel={(tab) => openDetailModal(activePost, tab)}
            />
          </div>
        ) : (
          <PostVideoStage
            key={activePost._id}
            post={activePost}
            playerId={`following-${activePost._id}`}
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
            onSelectCreatorVideo={(post) => openDetailModal(post, detailPanelTab)}
            onTotalCommentChange={activeInteraction.handleTotalCommentChange}
          >
            <PostVideoActionRail
              post={activePost}
              className="right-18 pr-4"
              isLikedOverride={activeInteraction.isLiked}
              totalLikeOverride={activeInteraction.totalLike}
              totalCommentOverride={activeInteraction.totalComment}
              onLikeChange={activeInteraction.handleLikeChange}
              onFollow={markCreatorFollowed}
              onAvatarClick={() => openDetailModal(activePost, 'videos')}
            />
          </PostVideoStage>
        )}

        <aside className="absolute right-3 top-1/2 z-80 -translate-y-1/2">
          <PostNavigationControls canPrevious={currentIndex > 0} canNext={currentIndex < posts.length - 1} onNavigate={navigate} />
        </aside>
      </section>

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
          initialDetailPanelTab={detailModalTab}
          closeOnVideoModeBack
          closeOnAvatarClick
          onInteractionChange={updatePostInteraction}
        />
      ) : null}
    </div>
  );
}
