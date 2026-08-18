'use client';

import Carousel, {
  CarouselNavigationButton,
  CarouselTimelineControl
} from '@components/ui/carousel';
import { VideoPlayerRef } from '@components/ui/video-player';
import { useCreatorVideos } from '@hooks/use-creator-videos';
import { usePostDetailNavigation } from '@hooks/use-post-detail-navigation';
import { PostInteractionChangeHandler, usePostInteractionState } from '@hooks/use-post-interactions';
import { PostNavigationDirection } from '@hooks/use-post-navigation-wheel';
import { usePostRoom } from '@hooks/use-post-room';
import { usePostStatsSync } from '@hooks/use-post-stats-sync';
import { usePostViewTracking } from '@hooks/use-post-view-tracking';
import { IPost } from '@interfaces/post';
import { PopupPipVideo } from '@lib/popup-pip';
import { GRAPHIC_SLIDE_DURATION_MS } from '@lib/post-graphic';
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaChevronLeft, FaChevronRight, FaTimes } from 'react-icons/fa';
import { CopyIcon, PauseIcon, PlayIcon } from 'src/icons';

import {
  getPostImages,
  isGraphicPost,
  supportsPostDetail
} from './home-feed-media';
import PostDetailDescription from './post-detail-description';
import PostNavigationControls from './post-navigation-controls';
import PostVideoDetailPanel, { PostVideoDetailTab } from './post-video-detail-panel';
import PostVideoStage, { PostVideoActionRail, VIDEO_DETAIL_PANEL_WIDTH } from './post-video-stage';

interface PostDetailModalProps {
  post: IPost;
  posts: IPost[];
  popupPlaylist?: PopupPipVideo[];
  initialTime?: number;
  onPlaybackTimeChange?: (currentTime: number) => void;
  onClose: () => void;
  onNavigate: (post: IPost) => void;
  initialDetailPanelTab?: PostVideoDetailTab | null;
  /** Comment a notification deep-linked to; resolved by the comments tab. */
  targetCommentId?: string | null;
  /** Aggregate fallback: the comment that opened the group. */
  targetCommentFallbackId?: string | null;
  closeOnVideoModeBack?: boolean;
  closeOnAvatarClick?: boolean;
  onInteractionChange?: PostInteractionChangeHandler;
}

interface DetailActionRailProps {
  post: IPost;
  mediaVariant: 'video' | 'graphic';
  previousPost?: IPost;
  nextPost?: IPost;
  onNavigate: (direction: PostNavigationDirection) => void;
  detailPanelOpen?: boolean;
  isLiked?: boolean;
  totalLike?: number;
  totalComment?: number;
  totalShare?: number;
  onLikeChange?: (isLiked: boolean, totalLikes: number) => void;
  onShared?: () => void;
  onOpenPanel?: (tab: PostVideoDetailTab) => void;
  onAvatarClick?: () => void;
}

function DetailActionRail({
  post,
  mediaVariant,
  previousPost,
  nextPost,
  onNavigate,
  detailPanelOpen,
  isLiked,
  totalLike,
  totalComment,
  totalShare,
  onLikeChange,
  onShared,
  onOpenPanel,
  onAvatarClick
}: DetailActionRailProps) {
  return (
    <PostVideoActionRail
      post={post}
      className="right-2"
      mediaVariant={mediaVariant}
      detailPanelOpenOverride={detailPanelOpen}
      isLikedOverride={isLiked}
      totalLikeOverride={totalLike}
      totalCommentOverride={totalComment}
      totalShareOverride={totalShare}
      onLikeChange={onLikeChange}
      onShared={onShared}
      onOpenPanel={onOpenPanel}
      onAvatarClick={onAvatarClick}
      topSlot={(
        <PostNavigationControls
          canPrevious={Boolean(previousPost)}
          canNext={Boolean(nextPost)}
          onNavigate={onNavigate}
        />
      )}
    />
  );
}

function GraphicPostDetail({
  post,
  posts,
  onClose,
  onNavigate,
  initialDetailPanelTab = null,
  targetCommentId = null,
  targetCommentFallbackId = null,
  onInteractionChange
}: Pick<PostDetailModalProps, 'post' | 'posts' | 'onClose' | 'onNavigate' | 'initialDetailPanelTab' | 'targetCommentId' | 'targetCommentFallbackId' | 'onInteractionChange'>) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [detailPanelTab, setDetailPanelTab] = useState<PostVideoDetailTab | null>(initialDetailPanelTab);
  const interaction = usePostInteractionState(post, onInteractionChange);
  // Live detail events only while this post is actually open on screen.
  usePostRoom(post._id);
  // Shared counters reconcile to the server; `isLiked` stays this viewer's own.
  usePostStatsSync(post._id, interaction.applyStatsSnapshot);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const images = useMemo(() => getPostImages(post), [post]);
  const navigationPosts = useMemo(() => posts.filter(supportsPostDetail), [posts]);
  const activeImage = images[Math.min(activeImageIndex, Math.max(images.length - 1, 0))];
  const slideshowPlaying = images.length > 1 && isPlaying;
  const description = post.text || post.tagline;
  const creatorName = post.user?.name || post.user?.username || 'Creator';
  const timeText = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const creatorPosts = useCreatorVideos({
    userId: post.user?._id,
    currentPost: post,
    enabled: detailPanelTab === 'videos'
  });

  useEffect(() => {
    setDetailPanelTab(initialDetailPanelTab);
  }, [initialDetailPanelTab, post._id]);

  const handlePostNavigate = useCallback((target: IPost) => {
    setActiveImageIndex(0);
    setIsPlaying(true);
    onNavigate(target);
  }, [onNavigate]);
  const {
    previousPost,
    nextPost,
    navigate,
    handleWheel
  } = usePostDetailNavigation({
    posts: navigationPosts,
    post,
    onNavigate: handlePostNavigate
  });
  const handleOpenPanel = useCallback((tab: PostVideoDetailTab) => {
    setDetailPanelTab(current => current === tab ? null : tab);
  }, []);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowUp') navigate('previous');
      if (event.key === 'ArrowDown') navigate('next');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [navigate, onClose]);

  if (!images.length) return null;

  return (
    <div
      className="fixed inset-0 z-120 overflow-hidden bg-black text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Graphic post details"
      onWheel={handleWheel}
      style={{ '--post-video-detail-panel-width': '28.5714%' } as CSSProperties}
    >
      <img
        src={activeImage?.url}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -inset-10 h-[calc(100%+80px)] w-[calc(100%+80px)] scale-110 object-cover opacity-55 blur-[42px]"
      />
      <div className="pointer-events-none absolute inset-0 bg-black/35" />

      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        className="absolute left-8 top-9 z-50 flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/25 text-2xl text-white/80 backdrop-blur-md transition hover:bg-white/12 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        aria-label="Close graphic details"
      >
        <FaTimes />
      </button>

      <div className="absolute left-32 top-11 z-50 hidden h-10 w-72 items-center rounded-xl border border-white/25 bg-black/15 px-4 text-sm text-white/75 backdrop-blur-md md:flex">
        <span className="truncate">{description || `@${creatorName}`}</span>
        <span className="ml-auto text-white/55">Search</span>
      </div>

      <main
        className="absolute inset-0 right-24 flex items-center justify-center"
        style={{ right: detailPanelTab ? VIDEO_DETAIL_PANEL_WIDTH : '6rem' }}
        onClick={() => {
          if (images.length > 1) setIsPlaying(current => !current);
        }}
      >
        <Carousel
          resetKey={post._id}
          className="h-full w-full"
          interval={GRAPHIC_SLIDE_DURATION_MS}
          playing={slideshowPlaying}
          slideClassName="h-full"
          timelineAutoplay
          onIndexChange={setActiveImageIndex}
          control={(
            <>
              <CarouselNavigationButton
                direction="previous"
                className="absolute left-[18%] top-1/2 z-30 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/30 text-lg text-white/80 backdrop-blur-md transition hover:bg-black/50 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              >
                <FaChevronLeft />
              </CarouselNavigationButton>
              <CarouselNavigationButton
                direction="next"
                className="absolute right-[8%] top-1/2 z-30 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/30 text-lg text-white/80 backdrop-blur-md transition hover:bg-black/50 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
              >
                <FaChevronRight />
              </CarouselNavigationButton>
              <CarouselTimelineControl className="pointer-events-none fixed inset-x-0 bottom-12 z-60 px-3" />
            </>
          )}
        >
          {images.map((image, index) => (
            <div key={image._id || `${post._id}-${index}`} className="flex h-full w-full items-center justify-center px-24 py-8">
              <img
                src={image.url}
                alt={`${description || 'Graphic post'} ${index + 1} of ${images.length}`}
                className="h-full w-full object-contain drop-shadow-[0_20px_60px_rgba(0,0,0,0.32)]"
                draggable={false}
              />
            </div>
          ))}
        </Carousel>
        {!slideshowPlaying && images.length > 1 ? (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              setIsPlaying(true);
            }}
            className="absolute left-1/2 top-1/2 z-30 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/35 text-4xl text-white/95 backdrop-blur-sm transition hover:scale-105 hover:bg-black/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
            aria-label="Play image slideshow"
          >
            <PlayIcon />
          </button>
        ) : null}
      </main>

      {detailPanelTab !== 'details' ? (
        <div className="absolute bottom-24 left-4 z-40 max-w-[min(620px,55vw)] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]">
          <div className="flex flex-wrap items-center gap-2 text-xl font-bold">
            <span>@{post.user?.username || creatorName}</span>
            {timeText ? <span className="text-sm font-semibold text-white/80">· {timeText}</span> : null}
            <span className="flex items-center gap-1 rounded bg-white/20 px-2 py-1 text-xs font-semibold backdrop-blur-sm">
              <CopyIcon className="text-[14px]" />
              Text and images
            </span>
          </div>
          {description ? (
            <PostDetailDescription
              key={post._id}
              text={description}
              onOpenDetails={() => setDetailPanelTab('details')}
              className="mt-2"
            />
          ) : null}
        </div>
      ) : null}

      <DetailActionRail
        post={post}
        mediaVariant="graphic"
        previousPost={previousPost}
        nextPost={nextPost}
        onNavigate={navigate}
        detailPanelOpen={Boolean(detailPanelTab)}
        isLiked={interaction.isLiked}
        totalLike={interaction.totalLike}
        totalComment={interaction.totalComment}
        totalShare={interaction.totalShare}
        onShared={interaction.handleShared}
        onLikeChange={interaction.handleLikeChange}
        onOpenPanel={handleOpenPanel}
      />

      {detailPanelTab ? (
        <PostVideoDetailPanel
          post={post}
          activeTab={detailPanelTab}
          targetCommentId={targetCommentId}
          targetCommentFallbackId={targetCommentFallbackId}
          creatorVideos={creatorPosts.posts}
          creatorVideosLoading={creatorPosts.loading}
          creatorVideosHasMore={creatorPosts.hasMore}
          creatorVideosError={creatorPosts.error}
          onLoadMoreCreatorVideos={creatorPosts.loadMore}
          onSelectVideo={handlePostNavigate}
          onTabChange={handleOpenPanel}
          onClose={() => setDetailPanelTab(null)}
          totalComment={interaction.totalComment}
          onTotalCommentChange={interaction.handleTotalCommentChange}
        />
      ) : null}

      <div className='absolute inset-x-0 bottom-0 z-50 bg-linear-to-t from-black/95 via-black/70 to-transparent px-3 pb-1.5 pt-6 text-white transition-opacity duration-300 sm:px-4 opacity-100'>
        <button
          type="button"
          onClick={() => setIsPlaying(current => !current)}
          disabled={images.length <= 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sm hover:bg-white/15"
          aria-label={slideshowPlaying ? 'Pause image slideshow' : 'Play image slideshow'}
        >
          {slideshowPlaying ? <PauseIcon className='text-3xl' /> : <PlayIcon className='text-3xl' />}
        </button>
      </div>
    </div>
  );
}

function VideoPostDetail({
  post,
  posts,
  popupPlaylist = [],
  initialTime = 0,
  onPlaybackTimeChange = () => undefined,
  onClose,
  onNavigate,
  initialDetailPanelTab = null,
  targetCommentId = null,
  targetCommentFallbackId = null,
  closeOnVideoModeBack = false,
  closeOnAvatarClick = false,
  onInteractionChange
}: PostDetailModalProps) {
  const videoRef = useRef<VideoPlayerRef>(null);
  const feedIndexRef = useRef(0);
  const videoModeOriginPostRef = useRef(post);
  const [detailPanelTab, setDetailPanelTab] = useState<PostVideoDetailTab | null>(initialDetailPanelTab);
  const [videoModeActive, setVideoModeActive] = useState(initialDetailPanelTab === 'videos');
  const interaction = usePostInteractionState(post, onInteractionChange);
  // Live detail events only while this post is actually open on screen.
  usePostRoom(post._id);
  // Shared counters reconcile to the server; `isLiked` stays this viewer's own.
  usePostStatsSync(post._id, interaction.applyStatsSnapshot);
  const description = post.text || post.tagline;
  const feedPosts = useMemo(() => posts.filter(supportsPostDetail), [posts]);
  const creatorVideos = useCreatorVideos({
    userId: post.user?._id,
    currentPost: post,
    enabled: videoModeActive
  });
  const feedPostIndex = feedPosts.findIndex(item => item._id === post._id);
  if (feedPostIndex >= 0) feedIndexRef.current = feedPostIndex;
  const creatorNavigationEnabled = videoModeActive && (!detailPanelTab || detailPanelTab === 'videos');
  const navigationPosts = creatorNavigationEnabled
    ? creatorVideos.posts
    : detailPanelTab
      ? []
      : feedPosts;
  const {
    currentIndex,
    previousPost,
    nextPost,
    navigate,
    handleWheel
  } = usePostDetailNavigation({
    posts: navigationPosts,
    post,
    onNavigate,
    fallbackIndex: !detailPanelTab ? feedIndexRef.current : -1
  });

  useEffect(() => {
    if (!videoModeActive || currentIndex < 0) return;
    if (creatorVideos.posts.length - currentIndex <= 4 && creatorVideos.hasMore && !creatorVideos.loading) {
      creatorVideos.loadMore();
    }
  }, [creatorVideos, currentIndex, videoModeActive]);

  const closeDetail = useCallback(() => {
    const currentTime = videoRef.current?.getVideoElement()?.currentTime;
    if (Number.isFinite(currentTime)) onPlaybackTimeChange(currentTime as number);
    onClose();
  }, [onClose, onPlaybackTimeChange]);

  const backOrCloseDetail = useCallback(() => {
    if (videoModeActive) {
      if (closeOnVideoModeBack) {
        closeDetail();
        return;
      }
      setDetailPanelTab(null);
      setVideoModeActive(false);
      const originPost = videoModeOriginPostRef.current;
      if (originPost?._id !== post._id) onNavigate(originPost);
      return;
    }
    closeDetail();
  }, [closeDetail, closeOnVideoModeBack, onNavigate, post._id, videoModeActive]);

  const handleVideoModeActiveChange = useCallback((active: boolean) => {
    if (active && !videoModeActive) videoModeOriginPostRef.current = post;
    setVideoModeActive(active);
  }, [post, videoModeActive]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') backOrCloseDetail();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [backOrCloseDetail]);

  return (
    <div className="fixed inset-0 z-120 overflow-hidden bg-black text-white" onWheel={handleWheel}>
      <button
        type="button"
        onClick={backOrCloseDetail}
        className="absolute left-8 top-9 z-50 flex h-16 w-16 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/20 text-2xl text-white/75 transition hover:bg-white/10 hover:text-white"
        aria-label={videoModeActive ? 'Exit creator videos' : 'Close video'}
      >
        {videoModeActive ? <FaChevronLeft /> : <FaTimes />}
      </button>

      <div className="absolute left-32 top-11 z-50 hidden h-10 w-72 items-center rounded-xl border border-white/25 bg-white/5 px-4 text-sm text-white/70 backdrop-blur-md md:flex">
        <span className="truncate">{description}</span>
        <span className="ml-auto text-white/50">Search</span>
      </div>

      <PostVideoStage
        key={post._id}
        post={post}
        playerId={`post-detail-${post._id}`}
        popupPlaylist={popupPlaylist}
        playerRef={videoRef}
        initialTime={initialTime}
        onPictureInPictureOpen={closeDetail}
        onTimeUpdate={onPlaybackTimeChange}
        className="absolute inset-0"
        detailPanelTab={detailPanelTab}
        targetCommentId={targetCommentId}
        targetCommentFallbackId={targetCommentFallbackId}
        onDetailPanelTabChange={setDetailPanelTab}
        videoModeActive={videoModeActive}
        onVideoModeActiveChange={handleVideoModeActiveChange}
        creatorVideos={creatorVideos.posts}
        creatorVideosLoading={creatorVideos.loading}
        creatorVideosHasMore={creatorVideos.hasMore}
        creatorVideosError={creatorVideos.error}
        onLoadMoreCreatorVideos={creatorVideos.loadMore}
        onSelectCreatorVideo={onNavigate}
        onTotalCommentChange={interaction.handleTotalCommentChange}
        disableRounding
      >
        <DetailActionRail
          post={post}
          mediaVariant="video"
          previousPost={previousPost}
          nextPost={nextPost}
          onNavigate={navigate}
          isLiked={interaction.isLiked}
          totalLike={interaction.totalLike}
          totalComment={interaction.totalComment}
          totalShare={interaction.totalShare}
          onShared={interaction.handleShared}
          onLikeChange={interaction.handleLikeChange}
          onAvatarClick={closeOnAvatarClick ? closeDetail : undefined}
        />
      </PostVideoStage>
    </div>
  );
}

export default function PostDetailModal(props: PostDetailModalProps) {
  usePostViewTracking(props.post._id, props.onInteractionChange);

  if (isGraphicPost(props.post)) {
    return (
      <GraphicPostDetail
        post={props.post}
        posts={props.posts}
        onClose={props.onClose}
        onNavigate={props.onNavigate}
        initialDetailPanelTab={props.initialDetailPanelTab}
        targetCommentId={props.targetCommentId}
        targetCommentFallbackId={props.targetCommentFallbackId}
        onInteractionChange={props.onInteractionChange}
      />
    );
  }

  return <VideoPostDetail {...props} />;
}
