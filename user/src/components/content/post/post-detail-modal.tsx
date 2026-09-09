'use client';

import PostDetailMessageButton from '@components/message/post-detail-message-button';
import Carousel, {
  CarouselNavigationButton,
  CarouselTimelineControl
} from '@components/ui/carousel';
import { VideoPlayerRef } from '@components/ui/video-player';
import { useElementHeight } from '@hooks/use-element-height';
import { useNavigationInputActive } from '@hooks/use-navigation-input-active';
import { PostDetailMode, usePostDetailMode } from '@hooks/use-post-detail-mode';
import { PostDetailSource, usePostDetailSequence } from '@hooks/use-post-detail-sequence';
import { usePostDragNavigation } from '@hooks/use-post-drag-navigation';
import { PostInteractionChangeHandler, usePostInteractionState } from '@hooks/use-post-interactions';
import { PostNavigationDirection } from '@hooks/use-post-navigation-wheel';
import { usePostRoom } from '@hooks/use-post-room';
import { usePostStatsSync } from '@hooks/use-post-stats-sync';
import { usePostViewTracking } from '@hooks/use-post-view-tracking';
import { usePostViewerStateHydration } from '@hooks/use-post-viewer-state';
import { useRecommendationDetailTracking } from '@hooks/use-recommendation-detail-tracking';
import { useRecommendationPhotoDwell } from '@hooks/use-recommendation-photo-dwell';
import { useRecommendationWatchTracking } from '@hooks/use-recommendation-watch-tracking';
import { IPost } from '@interfaces/post';
import { GRAPHIC_SLIDE_DURATION_MS } from '@lib/post-graphic';
import { useMessageWorkspace } from '@providers/message-workspace.provider';
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { CopyIcon, PauseIcon, PlayIcon } from 'src/icons';

import { getPostImages, isGraphicPost } from './home-feed-media';
import PostDetailBackButton, { usePostDetailBackControl, usePostDetailBackOrigin } from './post-detail-back-control';
import PostDetailDescription from './post-detail-description';
import PostFeedDragViewport from './post-feed-drag-viewport';
import PostNavigationControls from './post-navigation-controls';
import PostVideoDetailPanel, { PostVideoDetailTab } from './post-video-detail-panel';
import PostVideoStage, { PostVideoActionRail, VIDEO_DETAIL_PANEL_WIDTH } from './post-video-stage';

interface PostDetailModalProps {
  post: IPost;
  posts: IPost[];
  /**
   * Where the modal was opened from, which decides what next/previous move
   * through. Named by the caller rather than inferred: a post carries no record
   * of which list the viewer was looking at, and guessing from its shape is how
   * a photo ended up navigating the home feed while a creator's grid was on
   * screen beside it. Omitted means "whatever `posts` holds", the old
   * behaviour, which is right for the feeds.
   */
  source?: PostDetailSource;
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
  /**
   * The recommendation session this open belongs to — the Post Detail
   * recommendation session for `home-feed`/`direct-link`
   * (`useRecommendationDetailFeed`'s `sessionId`), or the For You feed
   * session for `source="for-you"`. Omitted for callers that are not a
   * recommendation surface (creator profile, search) — every recommendation
   * event below is a no-op without it.
   */
  recommendationSessionId?: string | null;
  /**
   * The recommendation sequence still has posts to hand out beyond what
   * `posts` currently holds. Without it "next" can only report what is already
   * loaded, so a refill in flight looks exactly like the end of the feed.
   */
  hasMoreAhead?: boolean;
  /** Reports which list owns next/previous, so the surface can freeze its own session. */
  onNavigationModeChange?: (mode: PostDetailMode) => void;
}

/** The side panel is owned by the modal, not by either layout. */
interface PanelTabControl {
  detailPanelTab: PostVideoDetailTab | null;
  onDetailPanelTabChange: (tab: PostVideoDetailTab | null) => void;
}

/**
 * The navigation mode and its captured creator, decided once above the layout
 * swap. Neither layout may re-derive these: doing so is how the two came to
 * disagree about what "next" meant.
 */
interface SequenceControl {
  mode: PostDetailMode;
  creatorId: string | null;
  hasMoreAhead: boolean;
}

/**
 * Where Back returns to, decided once above the layout swap.
 *
 * Like the panel tab and the navigation mode, this must outlive the photo/video
 * component swap — it is destroyed exactly when the viewer crosses a media-type
 * boundary, which is the one moment it matters.
 */
interface BackOriginControl {
  originPost: IPost;
}

interface DetailActionRailProps {
  post: IPost;
  mediaVariant: 'video' | 'graphic';
  previousPost?: IPost;
  /** Whether "next" is available — a loaded neighbour or one still arriving. */
  canNext: boolean;
  onNavigate: (direction: PostNavigationDirection) => void;
  detailPanelOpen?: boolean;
  isLiked?: boolean;
  totalLike?: number;
  totalComment?: number;
  totalShare?: number;
  onLikeChange?: (isLiked: boolean, totalLikes: number) => void;
  onShared?: () => void;
  onFollow?: (creatorId: string) => void;
  onOpenPanel?: (tab: PostVideoDetailTab) => void;
  onAvatarClick?: () => void;
}

/**
 * Touch navigation for the popup, expressed entirely in terms of the sequence
 * the popup already navigates by.
 *
 * ## What this deliberately does not do
 *
 * It computes no index, reads no creator list, holds no cursor and knows no
 * post id. It is handed `previousPost`, `nextPost` and `navigate` straight out
 * of `usePostDetailSequence` — the same three values the Next and Previous
 * buttons and the arrow keys use — so "swipe up" and "press Next" cannot
 * disagree about which post comes next. Creator scope, pinned ordering, image
 * and video inclusion, pagination, the tab rules and the edges are all decided
 * upstream and inherited whole.
 *
 * The gesture engine is the one the feeds use (`usePostDragNavigation` and
 * `PostFeedDragViewport`); this only chooses *what it wraps*. The feeds wrap
 * the whole stage, panel included. The popup wraps the media alone, so the
 * close button, the message button and the tab panel stay anchored while the
 * post travels.
 */
function usePopupDrag({
  stageRef, previousPost, nextPost, canNext, navigate, enabled
}: {
  stageRef: { current: HTMLElement | null };
  previousPost: IPost | null;
  nextPost: IPost | null;
  canNext: boolean;
  navigate: (direction: 'previous' | 'next') => void;
  enabled: boolean;
}) {
  const itemHeight = useElementHeight(stageRef);
  const drag = usePostDragNavigation({
    canPrevious: Boolean(previousPost),
    canNext,
    onNavigate: navigate,
    itemHeight,
    enabled
  });

  const wrap = useCallback((stage: ReactNode, currentClassName = '') => (
    <PostFeedDragViewport
      itemHeight={itemHeight}
      dragDeltaY={drag.dragDeltaY}
      transitionMs={drag.transitionMs}
      previewDirection={drag.previewDirection}
      previousPost={previousPost}
      nextPost={nextPost}
      currentClassName={currentClassName}
    >
      {stage}
    </PostFeedDragViewport>
  ), [drag.dragDeltaY, drag.previewDirection, drag.transitionMs, itemHeight, nextPost, previousPost]);

  return { handlers: drag.handlers, wrap, itemHeight };
}

function DetailActionRail({
  post,
  mediaVariant,
  previousPost,
  canNext,
  onNavigate,
  detailPanelOpen,
  isLiked,
  totalLike,
  totalComment,
  totalShare,
  onLikeChange,
  onShared,
  onFollow,
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
      onFollow={onFollow}
      onOpenPanel={onOpenPanel}
      onAvatarClick={onAvatarClick}
      /*
        The capsule is a desktop affordance. On a compact viewport the gesture
        *is* the navigation, and a floating pair of arrows over the media is
        both redundant and in the way — `hidden` rather than transparent, so it
        keeps no hit target and stays out of the tab order.
      */
      topSlot={(
        <div className="max-lg:hidden">
          <PostNavigationControls
            canPrevious={Boolean(previousPost)}
            canNext={canNext}
            onNavigate={onNavigate}
          />
        </div>
      )}
    />
  );
}

function GraphicPostDetail({
  post,
  posts,
  source,
  onClose,
  onNavigate,
  detailPanelTab,
  onDetailPanelTabChange,
  mode,
  creatorId,
  hasMoreAhead,
  originPost,
  targetCommentId = null,
  targetCommentFallbackId = null,
  onInteractionChange,
  recommendationSessionId,
  // The graphic layout needs this for the same reason the video one does: a
  // popup opened straight into the creator grid has nowhere to go Back to.
  closeOnVideoModeBack = false
}: Pick<PostDetailModalProps, 'post' | 'posts' | 'source' | 'onClose' | 'onNavigate' | 'targetCommentId' | 'targetCommentFallbackId' | 'onInteractionChange' | 'recommendationSessionId' | 'closeOnVideoModeBack'> & PanelTabControl & SequenceControl & BackOriginControl) {
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const setDetailPanelTab = onDetailPanelTabChange;
  const interaction = usePostInteractionState(post, onInteractionChange);
  const {
    trackLikeChange, trackShared, trackFollow, trackCommentCreate
  } = useRecommendationDetailTracking({
    post, source, sessionId: recommendationSessionId
  });
  // For photo posts, dwell IS the watch-quality signal — the modal is up for
  // as long as this image is being looked at (Home/direct-link/for-you all
  // route through this one open, so a single mount-duration timer here is
  // correct for every source, unlike the Home grid's IntersectionObserver
  // variant, which has to account for cards that stay mounted off-screen).
  useRecommendationPhotoDwell({
    enabled: Boolean(recommendationSessionId),
    postId: post._id,
    sessionId: recommendationSessionId,
    source: source === 'for-you' ? 'for-you' : 'post-detail'
  });
  // Live detail events only while this post is actually open on screen.
  usePostRoom(post._id);
  // Shared counters reconcile to the server; `isLiked` stays this viewer's own.
  usePostStatsSync(post._id, interaction.applyStatsSnapshot);
  /*
   * The viewer's own state, asked for once per open.
   *
   * A listing that answers without the viewer returns `isLiked: false` beside a
   * correct `totalLike` — Summary search did exactly that, so an already-liked
   * post opened with a white heart. Correcting it here means every source
   * agrees no matter which one opened the modal.
   */
  usePostViewerStateHydration(post._id);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const images = useMemo(() => getPostImages(post), [post]);
  const activeImage = images[Math.min(activeImageIndex, Math.max(images.length - 1, 0))];
  const slideshowPlaying = images.length > 1 && isPlaying;
  const description = post.text || post.tagline;
  const creatorName = post.user?.name || post.user?.username || 'Creator';
  const timeText = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const handlePostNavigate = useCallback((target: IPost) => {
    setActiveImageIndex(0);
    setIsPlaying(true);
    onNavigate(target);
  }, [onNavigate]);

  /*
   * The mode is decided once, above both layouts, and handed down. Neither
   * layout re-derives it: doing that is what let the photo layout draw a
   * creator's grid while navigating the feed behind the modal.
   */
  const {
    creatorPosts,
    previousPost,
    nextPost,
    canNext,
    navigate,
    handleWheel
  } = usePostDetailSequence({
    post,
    feedPosts: posts,
    mode,
    creatorId,
    hasMoreAhead,
    onNavigate: handlePostNavigate
  });
  const stageRef = useRef<HTMLElement>(null);
  const drag = usePopupDrag({
    stageRef, previousPost, nextPost, canNext, navigate, enabled: mode !== 'disabled'
  });
  const handleOpenPanel = useCallback((tab: PostVideoDetailTab) => {
    setDetailPanelTab(detailPanelTab === tab ? null : tab);
  }, [detailPanelTab, setDetailPanelTab]);

  /*
    The same top-left control the video layout uses, driven by the same mode.
    An image post with the Videos tab open must say Back and behave as Back.
  */
  const backControl = usePostDetailBackControl({
    mode,
    detailPanelTab,
    onDetailPanelTabChange: setDetailPanelTab,
    post,
    originPost,
    onNavigate,
    onClose,
    closeOnVideoModeBack
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      // Escape leaves the Videos tab first; a second Escape closes the popup.
      if (event.key === 'Escape') backControl.activate();
      if (event.key === 'ArrowUp') navigate('previous');
      if (event.key === 'ArrowDown') navigate('next');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [backControl, navigate]);

  if (!images.length) return null;

  return (
    <div
      className="fixed inset-y-0 left-0 z-120 touch-pan-x overflow-hidden bg-black text-white transition-[right] duration-200 ease-out motion-reduce:transition-none"
      data-post-detail-popup="graphic"
      role="dialog"
      aria-modal="true"
      aria-label="Graphic post details"
      onWheel={handleWheel}
      {...drag.handlers}
      /*
       * Inset from the right by whatever the message workspace is taking,
       * rather than `inset-0`. The two surfaces coexist: opening messages from
       * here narrows the detail view instead of covering it or closing it. Same
       * variable the shell's content column reads, so the two stay in step.
       */
      style={{
        // Same responsive split the video layout uses, so a photo and a video
        // give the panel the same share of the stage at every viewport.
        '--post-video-detail-panel-width': 'calc(100% * var(--post-detail-panel-ratio, 0.285714))',
        right: 'var(--message-workspace-width, 0px)'
      } as CSSProperties}
    >
      <img
        src={activeImage?.url}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -inset-10 h-[calc(100%+80px)] w-[calc(100%+80px)] scale-110 object-cover opacity-55 blur-[42px]"
      />
      <div className="pointer-events-none absolute inset-0 bg-black/35" />

      <PostDetailBackButton
        control={backControl}
        buttonRef={closeButtonRef}
        className="absolute left-8 max-lg:left-2 top-9 max-lg:top-2 z-50 flex h-16 w-16 max-lg:h-9 max-lg:w-9 cursor-pointer items-center justify-center rounded-full border border-white/15 text-2xl max-lg:text-base bg-black/25 text-white/80 backdrop-blur-md transition hover:bg-white/12 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      />

      <div className="absolute left-32 top-11 z-50 hidden h-10 w-72 items-center rounded-xl border border-white/25 bg-black/15 px-4 text-sm text-white/75 backdrop-blur-md lg:flex">
        <span className="truncate">{description || `@${creatorName}`}</span>
        <span className="ml-auto text-white/55">Search</span>
      </div>

      {/*
        Message action, kept clear of the detail panel.

        `right` is offset by the panel's width whenever it is open, exactly as
        the action rail is. Positioning from the overlay's right edge alone put
        the button *underneath* the panel — the panel is `z-70`, this is `z-50` —
        so it vanished the moment comments were open. The overlay itself already
        ends where the message workspace begins, so this stays inside the visible
        post-detail area in both states.
      */}
      <div
        className="pointer-events-none absolute top-9 max-lg:top-2 z-80 flex items-center transition-[right] duration-200 ease-out motion-reduce:transition-none"
        style={{ right: detailPanelTab ? `calc(${VIDEO_DETAIL_PANEL_WIDTH} + var(--post-detail-message-inset, 1.5rem))` : 'var(--post-detail-message-inset, 1.5rem)' }}
      >
        <PostDetailMessageButton />
      </div>

      <main
        ref={stageRef}
        className="absolute inset-0 right-24 touch-pan-x"
        /*
          The gutter that keeps the media clear of the action rail. 6rem is the
          desktop reference; the rail itself is 4.25rem, so a narrow stage gives
          it exactly what it occupies rather than a sixth of 384px.
        */
        style={{ right: detailPanelTab ? VIDEO_DETAIL_PANEL_WIDTH : 'var(--post-detail-rail-gutter, 6rem)' }}
        onClick={() => {
          if (images.length > 1) setIsPlaying(current => !current);
        }}
      >
        {drag.wrap((
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
              <div key={image._id || `${post._id}-${index}`} className="flex h-full w-full items-center justify-center px-24 max-lg:px-3 py-8 max-lg:py-4">
                <img
                  src={image.url}
                  alt={`${description || 'Graphic post'} ${index + 1} of ${images.length}`}
                  className="h-full w-full object-contain drop-shadow-[0_20px_60px_rgba(0,0,0,0.32)]"
                  draggable={false}
                />
              </div>
          ))}
          </Carousel>
        ), 'flex items-center justify-center')}
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
        <div className="absolute bottom-24 max-lg:bottom-12 left-4 max-lg:left-2 z-40 max-w-[min(620px,55vw)] max-lg:max-w-[calc(100%-58px)] text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.75)]">
          <div className="flex flex-wrap items-center gap-2 max-lg:gap-1 text-xl max-lg:text-[10px] max-lg:leading-[14px] font-bold">
            <span>@{post.user?.username || creatorName}</span>
            {timeText ? <span className="text-sm max-lg:text-[9px] font-semibold text-white/80">· {timeText}</span> : null}
            <span className="flex items-center gap-1 max-lg:gap-0.5 rounded bg-white/20 px-2 max-lg:px-1 py-1 max-lg:py-0 text-xs max-lg:text-[8px] font-semibold backdrop-blur-sm">
              <CopyIcon className="text-[14px] max-lg:text-[9px]" />
              Text and images
            </span>
          </div>
          {description ? (
            <PostDetailDescription
              key={post._id}
              text={description}
              onOpenDetails={() => setDetailPanelTab('details')}
              className="mt-2 max-lg:mt-0.5"
            />
          ) : null}
        </div>
      ) : null}

      <DetailActionRail
        post={post}
        mediaVariant="graphic"
        previousPost={previousPost}
        canNext={canNext}
        onNavigate={navigate}
        detailPanelOpen={Boolean(detailPanelTab)}
        isLiked={interaction.isLiked}
        totalLike={interaction.totalLike}
        totalComment={interaction.totalComment}
        totalShare={interaction.totalShare}
        onShared={trackShared(interaction.handleShared)}
        onLikeChange={trackLikeChange(interaction.handleLikeChange)}
        onFollow={trackFollow}
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
          onCommentCreate={trackCommentCreate}
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
  source,
  initialTime = 0,
  onPlaybackTimeChange = () => undefined,
  onClose,
  onNavigate,
  detailPanelTab,
  onDetailPanelTabChange,
  mode,
  creatorId,
  hasMoreAhead,
  originPost,
  targetCommentId = null,
  targetCommentFallbackId = null,
  closeOnVideoModeBack = false,
  closeOnAvatarClick = false,
  onInteractionChange,
  recommendationSessionId
}: PostDetailModalProps & PanelTabControl & SequenceControl & BackOriginControl) {
  const videoRef = useRef<VideoPlayerRef>(null);
  const videoModeOriginPostRef = useRef(post);
  const setDetailPanelTab = onDetailPanelTabChange;
  // "Video mode" is simply creator mode as the video layout names it. Read from
  // the one owner rather than tracked here: a second boolean beside `mode` is
  // exactly the arrangement that let the two disagree.
  const videoModeActive = mode === 'creator';
  const interaction = usePostInteractionState(post, onInteractionChange);
  const {
    trackLikeChange, trackShared, trackFollow, trackCommentCreate
  } = useRecommendationDetailTracking({
    post, source, sessionId: recommendationSessionId
  });
  const watchTracking = useRecommendationWatchTracking({
    enabled: Boolean(recommendationSessionId),
    postId: post._id,
    sessionId: recommendationSessionId,
    source: source === 'for-you' ? 'for-you' : 'post-detail'
  });
  // Live detail events only while this post is actually open on screen.
  usePostRoom(post._id);
  // Shared counters reconcile to the server; `isLiked` stays this viewer's own.
  usePostStatsSync(post._id, interaction.applyStatsSnapshot);
  /*
   * The viewer's own state, asked for once per open.
   *
   * A listing that answers without the viewer returns `isLiked: false` beside a
   * correct `totalLike` — Summary search did exactly that, so an already-liked
   * post opened with a white heart. Correcting it here means every source
   * agrees no matter which one opened the modal.
   */
  usePostViewerStateHydration(post._id);
  const description = post.text || post.tagline;
  const {
    creatorPosts: creatorVideos,
    previousPost,
    nextPost,
    canNext,
    navigate,
    handleWheel
  } = usePostDetailSequence({
    post,
    feedPosts: posts,
    mode,
    creatorId,
    hasMoreAhead,
    onNavigate
  });
  const stageRef = useRef<HTMLElement>(null);
  const drag = usePopupDrag({
    stageRef, previousPost, nextPost, canNext, navigate, enabled: mode !== 'disabled'
  });

  const closeDetail = useCallback(() => {
    const currentTime = videoRef.current?.getVideoElement()?.currentTime;
    if (Number.isFinite(currentTime)) onPlaybackTimeChange(currentTime as number);
    onClose();
  }, [onClose, onPlaybackTimeChange]);

  /*
    The same control the graphic layout uses. It used to live only here, which
    is why an image post never got a Back button.
  */
  const backControl = usePostDetailBackControl({
    mode,
    detailPanelTab,
    onDetailPanelTabChange: setDetailPanelTab,
    post,
    originPost,
    onNavigate,
    onClose: closeDetail,
    closeOnVideoModeBack
  });
  const backOrCloseDetail = backControl.activate;

  const handleVideoModeActiveChange = useCallback((active: boolean) => {
    if (active && !videoModeActive) videoModeOriginPostRef.current = post;
    if (active) setDetailPanelTab('videos');
    else if (detailPanelTab === 'videos') setDetailPanelTab(null);
  }, [detailPanelTab, post, setDetailPanelTab, videoModeActive]);
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
    <div
      data-post-detail-popup="video"
      onWheel={handleWheel}
      {...drag.handlers}
      style={{
        /*
          Declared on the overlay root, not only inside `PostVideoStage`.
          Anything positioned against the panel edge — the message action, the
          action rail's offset — is a sibling of the stage, so reading the
          variable from the stage silently fell back to 28.5714% and put those
          controls underneath a panel that is actually 38% wide.
        */
        '--post-video-detail-panel-width': 'calc(100% * var(--post-detail-panel-ratio, 0.285714))',
        right: 'var(--message-workspace-width, 0px)'
      } as CSSProperties}
      /*
        `touch-pan-x` is not decoration: the drag handlers are on this root, and
        with the default `touch-action: auto` the browser claims a vertical
        touch for scrolling and cancels the pointer stream before a single
        `pointermove` is delivered. Measured — the video popup accepted no
        upward drag at all until this was declared, while the graphic layout
        (which already had it) worked.
      */
      className="fixed inset-y-0 left-0 z-120 touch-pan-x overflow-hidden bg-black text-white transition-[right] duration-200 ease-out motion-reduce:transition-none"
    >
      <PostDetailBackButton
        control={backControl}
        className="absolute left-8 max-lg:left-2 top-9 max-lg:top-2 z-50 flex h-16 w-16 max-lg:h-9 max-lg:w-9 cursor-pointer items-center justify-center rounded-full border border-white/15 text-2xl max-lg:text-base bg-black/20 text-white/75 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      />

      <div className="absolute left-32 top-11 z-50 hidden h-10 w-72 items-center rounded-xl border border-white/25 bg-white/5 px-4 text-sm text-white/70 backdrop-blur-md lg:flex">
        <span className="truncate">{description}</span>
        <span className="ml-auto text-white/50">Search</span>
      </div>

      {/*
        Message action, kept clear of the detail panel.

        `right` is offset by the panel's width whenever it is open, exactly as
        the action rail is. Positioning from the overlay's right edge alone put
        the button *underneath* the panel — the panel is `z-70`, this is `z-50` —
        so it vanished the moment comments were open. The overlay itself already
        ends where the message workspace begins, so this stays inside the visible
        post-detail area in both states.
      */}
      <div
        className="pointer-events-none absolute top-9 max-lg:top-2 z-80 flex items-center transition-[right] duration-200 ease-out motion-reduce:transition-none"
        style={{ right: detailPanelTab ? `calc(${VIDEO_DETAIL_PANEL_WIDTH} + var(--post-detail-message-inset, 1.5rem))` : 'var(--post-detail-message-inset, 1.5rem)' }}
      >
        <PostDetailMessageButton />
      </div>

      <PostVideoStage
        key={post._id}
        post={post}
        /*
          Only the player card and the action rail travel with the drag; the tab
          panel `PostVideoStage` renders below them stays anchored, which is why
          the popup wraps from inside the stage and the feeds wrap from outside.
        */
        stageRef={stageRef}
        wrapStage={drag.wrap}
        playerId={`post-detail-${post._id}`}
        playerRef={videoRef}
        initialTime={initialTime}
        onPictureInPictureOpen={closeDetail}
        onTimeUpdate={(currentTime, duration) => {
          onPlaybackTimeChange(currentTime);
          watchTracking.handleTimeUpdate(currentTime, duration);
        }}
        onPause={watchTracking.handlePause}
        onEnded={watchTracking.handleEnded}
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
        onCommentCreate={trackCommentCreate}
        disableRounding
      >
        <DetailActionRail
          post={post}
          mediaVariant="video"
          previousPost={previousPost}
          canNext={canNext}
          onNavigate={navigate}
          isLiked={interaction.isLiked}
          totalLike={interaction.totalLike}
          totalComment={interaction.totalComment}
          totalShare={interaction.totalShare}
          onShared={trackShared(interaction.handleShared)}
          onLikeChange={trackLikeChange(interaction.handleLikeChange)}
          onFollow={trackFollow}
          onAvatarClick={closeOnAvatarClick ? closeDetail : undefined}
        />
      </PostVideoStage>
    </div>
  );
}

/**
 * Tells the message workspace it is sitting beside a fullscreen surface for as
 * long as post detail is open.
 *
 * Declared by the surface rather than detected by the panel: post detail knows
 * it covers the application header, and the panel would otherwise have to guess
 * from the DOM.
 */
function useFullscreenMessagePlacement() {
  const { claimFullscreenPlacement } = useMessageWorkspace();
  useEffect(() => claimFullscreenPlacement(), [claimFullscreenPlacement]);
}

export default function PostDetailModal(props: PostDetailModalProps) {
  usePostViewTracking(props.post._id, props.onInteractionChange);
  useFullscreenMessagePlacement();

  /*
   * Which side panel is open lives here, above the two layouts.
   *
   * A photo and a video are drawn by different components, so moving between
   * them unmounts one and mounts the other -- and anything either of them held
   * in state is gone. That is fine for playback, and wrong for the panel: with
   * the creator grid open, stepping from a photo to a video closed the grid,
   * and closing the grid dropped the creator scope that next/previous depends
   * on. One step stayed with the creator; the next fell back to the feed.
   *
   * Held above the swap, the grid stays open and the sequence stays the
   * creator's, whichever kind of post is showing.
   */
  const [detailPanelTab, setDetailPanelTab] = useState<PostVideoDetailTab | null>(
    props.initialDetailPanelTab ?? null
  );
  // Re-apply only when the *caller* asks for a different tab -- a notification
  // deep link, say -- never merely because the open post changed.
  useEffect(() => {
    setDetailPanelTab(props.initialDetailPanelTab ?? null);
  }, [props.initialDetailPanelTab]);

  /*
   * The navigation mode, and the creator it captured, live here for the same
   * reason the panel tab does: they must survive the photo/video layout swap.
   * Held inside a layout, the captured creator was destroyed exactly when the
   * viewer stepped across a media-type boundary — the one moment it matters.
   */
  /*
   * Typing a comment or scrubbing the seek bar disables navigation, in the
   * popup exactly as on the inline stage: both use the arrow keys or a
   * vertical-ish drag over the media, and losing the post mid-gesture loses
   * what the viewer was doing.
   */
  const inputActive = useNavigationInputActive();
  const { mode, creatorId } = usePostDetailMode({
    post: props.post,
    panelTab: detailPanelTab,
    source: props.source,
    inputActive
  });

  /*
    Tell the surface which list currently owns navigation.

    The surface mounts the detail recommendation session, and that session must
    freeze while the Videos tab is driving — otherwise a creator post looks to
    it like a brand-new open and it reseeds, discarding the history the viewer
    built before entering the tab.
  */
  const onModeChange = props.onNavigationModeChange;
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  /*
    Where Back returns to, remembered here for the same reason the panel tab is:
    it has to survive the photo/video layout swap. Held inside a layout it was
    re-seeded with the creator post the viewer had just opened, so Back left
    them exactly where they already were — but only when the media type changed,
    which is what made it look like a photo-only defect.
  */
  const originPost = usePostDetailBackOrigin(mode, props.post);

  const sequenceControl = {
    mode,
    creatorId,
    hasMoreAhead: Boolean(props.hasMoreAhead)
  };

  if (isGraphicPost(props.post)) {
    return (
      <GraphicPostDetail
        post={props.post}
        posts={props.posts}
        source={props.source}
        onClose={props.onClose}
        onNavigate={props.onNavigate}
        detailPanelTab={detailPanelTab}
        onDetailPanelTabChange={setDetailPanelTab}
        {...sequenceControl}
        originPost={originPost}
        targetCommentId={props.targetCommentId}
        targetCommentFallbackId={props.targetCommentFallbackId}
        onInteractionChange={props.onInteractionChange}
        recommendationSessionId={props.recommendationSessionId}
        closeOnVideoModeBack={props.closeOnVideoModeBack}
      />
    );
  }

  return (
    <VideoPostDetail
      {...props}
      detailPanelTab={detailPanelTab}
      onDetailPanelTabChange={setDetailPanelTab}
      {...sequenceControl}
      originPost={originPost}
    />
  );
}
