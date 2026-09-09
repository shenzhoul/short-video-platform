'use client';

import PostFeedDragViewport from '@components/content/post/post-feed-drag-viewport';
import Carousel, {
  CarouselNavigationButton,
  CarouselTimelineControl
} from '@components/ui/carousel';
import { VideoPlayerRef } from '@components/ui/video-player';
import { useElementHeight } from '@hooks/use-element-height';
import { FollowingFeedPage, FollowingFeedSource, useFollowingFeed } from '@hooks/use-following-feed';
import { useNavigationInputActive } from '@hooks/use-navigation-input-active';
import { usePipFeedSync } from '@hooks/use-pip-feed-sync';
import { usePostDetailMode } from '@hooks/use-post-detail-mode';
import { usePostDetailSequence } from '@hooks/use-post-detail-sequence';
import { usePostDragNavigation } from '@hooks/use-post-drag-navigation';
import { usePostInteractionState } from '@hooks/use-post-interactions';
import { usePostNavigationWheel } from '@hooks/use-post-navigation-wheel';
import { useVideoPlaybackContinuity } from '@hooks/use-video-playback-continuity';
import { IPost } from '@interfaces/post';
import { IUser } from '@interfaces/user';
import { GRAPHIC_SLIDE_DURATION_MS } from '@lib/post-graphic';
import { useMessageWorkspace } from '@providers/message-workspace.provider';

/**
 * Viewport below which opening Messages collapses the creator rail.
 *
 * The same 600px band `globals.css` tunes the Following panel allocation for,
 * and the band the Douyin references were captured in.
 */
const FOLLOWING_MESSAGES_COLLAPSE_MAX_WIDTH = 600;
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { CopyIcon, PauseIcon, PlayIcon } from 'src/icons';

import HomeFeedCoverImage from '../content/post/home-feed-cover-image';
import { getPostImages, isGraphicPost } from '../content/post/home-feed-media';
import PostDetailModal from '../content/post/post-detail-modal';
import PostNavigationControls from '../content/post/post-navigation-controls';
import { PostVideoDetailTab } from '../content/post/post-video-detail-panel';
import PostVideoStage, { PostVideoActionRail } from '../content/post/post-video-stage';
import FollowingCreatorsRail from './following-creators-rail';

interface FollowingFeedProps {
  initialData?: FollowingFeedPage | null;
  initialCreators?: IUser[];
  /**
   * Which relationship scopes the feed.
   *
   * The Friends page is this same component with `source="friends"` — same
   * layout, same rail, same loading and empty behaviour, same interaction
   * handling. A second feed implementation would be two places for the same
   * bugs.
   */
  source?: FollowingFeedSource;
  /** Heading for the creator rail, which is "my friends" on the Friends page. */
  railTitle?: string;
}

export default function FollowingFeed({
  initialData,
  initialCreators = [],
  source = 'following',
  railTitle
}: FollowingFeedProps) {
  const playerRef = useRef<VideoPlayerRef>(null);
  const stageRef = useRef<HTMLElement>(null);
  const { posts, hasMore, loading, error, loadMore, updatePostInteraction, markCreatorFollowed, unfollowCreator } = useFollowingFeed(initialData, source);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [unfollowedCreatorIds, setUnfollowedCreatorIds] = useState<Set<string>>(() => new Set());
  /*
    The rail's expanded state belongs here, not inside the rail.

    It decides the column allocation for the whole row: the detail panel holds
    the width measured off the Douyin reference whatever the rail is doing, so
    the stage has to know which of the two splits applies. A boolean living
    inside the rail is invisible to its sibling.
  */
  const [creatorRailExpanded, setCreatorRailExpanded] = useState(false);
  /**
   * True only while *this* component collapsed the rail to make room for
   * Messages, so closing Messages restores exactly what it changed.
   *
   * A remembered boolean rather than a remembered *state*: if the viewer
   * expands the rail themselves while Messages is open, that is their choice
   * and closing Messages must not undo it. Repeated open/close cycles cannot
   * drift, because the flag is only ever set by the collapse and cleared by the
   * restore.
   */
  const collapsedForMessagesRef = useRef(false);
  const [detailPanelTab, setDetailPanelTab] = useState<PostVideoDetailTab | null>(null);
  const [detailModalPost, setDetailModalPost] = useState<IPost | null>(null);
  const [detailModalInitialTime, setDetailModalInitialTime] = useState(0);
  const [detailModalTab, setDetailModalTab] = useState<PostVideoDetailTab | null>(null);
  const [graphicPlaying, setGraphicPlaying] = useState(true);
  /** A creator-grid post the following feed itself does not hold — see For You. */
  const [creatorStagePost, setCreatorStagePost] = useState<IPost | null>(null);
  const activePost = creatorStagePost || posts[currentIndex];
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
  const creators = useMemo(() => {
    const creatorMap = new Map(initialCreators.map(creator => [creator._id, creator]));
    posts.forEach(post => {
      if (post.user?._id && !creatorMap.has(post.user._id)) creatorMap.set(post.user._id, post.user);
    });
    return [...creatorMap.values()].filter(creator => !unfollowedCreatorIds.has(creator._id));
  }, [initialCreators, posts, unfollowedCreatorIds]);
  /*
   * One navigation context, resolved by the shared function and driven by the
   * shared controller — the same pair the popup and the For You stage use.
   *
   * This surface used to have neither: the arrows walked the following feed
   * whatever panel was open, and `navigate` closed the panel on the way past to
   * hide the mismatch. So the Videos tab could not be stepped through here at
   * all, and opening a comment box left the arrow keys still changing the post
   * under the reply being typed.
   */
  const inputActive = useNavigationInputActive(stageRef);
  /*
    Following lays itself out in columns, so Messages belongs *beside* the post,
    not on top of it -- the same claim For You makes.

    This one missing call is the whole defect: without a column claim
    `columnClaims` stays 0, so `reflows` is false, so `inline` is false at any
    viewport under 1280px, and the workspace falls back to the generic mobile
    panel. That panel is 356px of overlay on a 440px viewport: it covered the
    post entirely and left a sliver of media at the edge.
  */
  const { open: messagesOpen, claimColumnPlacement } = useMessageWorkspace();
  useEffect(() => claimColumnPlacement(), [claimColumnPlacement]);
  const { mode, creatorId } = usePostDetailMode({
    post: activePost,
    panelTab: detailPanelTab,
    source: 'following-feed',
    inputActive,
    messagesOpen
  });
  /*
    On a narrow viewport the five columns do not all fit with a labelled rail:
    at 440px an expanded rail plus a detail panel plus Messages leaves the media
    50px. The Douyin Messages reference uses the compact avatar rail for exactly
    this reason.

    Bounded to the same narrow band the Following panel allocation is tuned for
    (`globals.css`, max-width 599px). At 768px and above every column already
    fits -- 768 - 48 - 88 - 150 leaves 482 for the stage -- so the rail is left
    alone rather than collapsed for no reason.
  */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const narrow = window.innerWidth < FOLLOWING_MESSAGES_COLLAPSE_MAX_WIDTH;
    if (messagesOpen && narrow && creatorRailExpanded && !collapsedForMessagesRef.current) {
      collapsedForMessagesRef.current = true;
      setCreatorRailExpanded(false);
      return;
    }
    if (!messagesOpen && collapsedForMessagesRef.current) {
      collapsedForMessagesRef.current = false;
      setCreatorRailExpanded(true);
    }
  }, [creatorRailExpanded, messagesOpen]);

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
    hasMoreAhead: hasMore,
    onNavigate: showPost
  });
  const creatorVideos = sequence.creatorPosts;
  const navigate = sequence.navigate;
  const canPrevious = Boolean(sequence.previousPost);
  const canNext = sequence.canNext;
  const wheel = usePostNavigationWheel({ canPrevious, canNext, onNavigate: navigate });
  // Touch drags the stage; see `usePostDragNavigation` and For You.
  const itemHeight = useElementHeight(stageRef);
  const drag = usePostDragNavigation({
    canPrevious, canNext, onNavigate: navigate, itemHeight, enabled: mode !== 'disabled'
  });
  const popupPipState = usePipFeedSync(posts, activePost, useCallback((index: number) => {
    setCreatorStagePost(null);
    setCurrentIndex(index);
  }, []));

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
    // An empty feed is a legitimate state of a working account — you follow
    // nobody yet, or none of your friends has posted. It is never an error and
    // never a missing page. A real failure keeps its own message and its retry.
    const emptyMessage = source === 'friends'
      ? 'Follow someone who follows you back to see your friends here.'
      : 'Follow creators to see their latest posts here.';
    const loadingMessage = source === 'friends' ? 'Loading posts from friends...' : 'Loading followed posts...';

    return (
      <div className="flex h-full min-h-0 w-full">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-(--page-bg) text-sm font-semibold text-(--text-muted)">
          <span>{loading ? loadingMessage : error || emptyMessage}</span>
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
        title={railTitle}
        expanded={creatorRailExpanded}
        onExpandedChange={setCreatorRailExpanded}
        activeCreatorId={activePost.user?._id}
        onSelectCreator={openCreatorVideos}
        onUnfollowCreator={handleUnfollowCreator}
      />
      <section
        ref={stageRef}
        /*
          Names the surface and the rail state for the column allocation in
          `globals.css`. Following is the only feed with a creator rail in
          front of the stage, so the panel is a larger share of what is left
          -- and the share differs by rail state precisely so the panel does
          NOT change width when the rail does.
        */
        data-feed-surface="following"
        data-creator-rail={creatorRailExpanded ? 'expanded' : 'collapsed'}
        className="relative min-w-0 flex-1 overflow-hidden text-white touch-pan-x"
        onWheel={wheel}
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
          {graphicPost ? (
            <div className="relative h-full w-full overflow-hidden">
              <div
                className="relative h-full overflow-hidden rounded-2xl bg-black shadow-[0_24px_70px_rgba(0,0,0,.32)]"
                style={{ width: 'calc(100% - var(--feed-nav-gutter, 68px))' }}
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
                className="right-18 max-lg:right-0 pr-4 max-lg:pr-1"
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
            onSelectCreatorVideo={(post) => openDetailModal(post, detailPanelTab)}
            onTotalCommentChange={activeInteraction.handleTotalCommentChange}
          >
            <PostVideoActionRail
              post={activePost}
              className="right-18 max-lg:right-0 pr-4 max-lg:pr-1"
              isLikedOverride={activeInteraction.isLiked}
              totalLikeOverride={activeInteraction.totalLike}
              totalCommentOverride={activeInteraction.totalComment}
              onLikeChange={activeInteraction.handleLikeChange}
              onFollow={markCreatorFollowed}
              onAvatarClick={() => openDetailModal(activePost, 'videos')}
            />
          </PostVideoStage>
        )}
        </PostFeedDragViewport>

        <aside className="absolute right-3 top-1/2 z-80 -translate-y-1/2 max-lg:hidden">
          <PostNavigationControls canPrevious={canPrevious} canNext={canNext} onNavigate={navigate} />
        </aside>
      </section>

      {detailModalPost ? (
        <PostDetailModal
          post={detailModalPost}
          posts={posts}
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
