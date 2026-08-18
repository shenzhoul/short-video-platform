'use client';

import { LikeButton } from '@components/interactions';
import SharePanel from '@components/interactions/share-panel';
import VideoPlayer, { VideoPlayerRef } from '@components/ui/video-player';
import { useFollowCreator } from '@hooks/use-follow-creator';
import { IPost } from '@interfaces/post';
import {
  closePopupPip,
  closePopupPipWindow,
  PopupPipState,
  PopupPipVideo,
  readPopupPipState,
  subscribePopupPipState
} from '@lib/popup-pip';
import { recordShare } from '@services/reaction.service';
import { createContext, type CSSProperties, ReactNode, Ref, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AiEntryIcon,
  CommentLottieIcon,
  FavoriteLottieIcon,
  HeadphoneIcon,
  LikeActiveIcon,
  LikeLottieIcon,
  MoreIcon,
  ShareLottieIcon,
  YoutubeIcon
} from 'src/icons';

import { formatCompactCount, getPopupVideo, getPostMedia, getPostVideo } from './home-feed-media';
import PostDetailDescription from './post-detail-description';
import PostVideoDetailPanel, { PostVideoDetailTab } from './post-video-detail-panel';

const POST_VIDEO_PLAYER_RATIO = 0.714286;
const POST_VIDEO_PANEL_RATIO = 0.285714;
export const VIDEO_DETAIL_PANEL_WIDTH = 'var(--post-video-detail-panel-width, 28.5714%)';

interface PostVideoDetailContextValue {
  isOpen: boolean;
  openPanel: (tab?: PostVideoDetailTab) => void;
  totalComment: number;
  setTotalComment: (total: number) => void;
}

const PostVideoDetailContext = createContext<PostVideoDetailContextValue>({
  isOpen: false,
  openPanel: () => undefined,
  totalComment: 0,
  setTotalComment: () => undefined
});

interface PostVideoActionRailProps {
  footer?: ReactNode;
  topSlot?: ReactNode;
  className?: string;
  post: IPost;
  mediaVariant?: 'video' | 'graphic';
  detailPanelOpenOverride?: boolean;
  isLikedOverride?: boolean;
  totalLikeOverride?: number;
  totalCommentOverride?: number;
  totalShareOverride?: number;
  onLikeChange?: (isLiked: boolean, totalLikes: number) => void;
  /** Called after a share actually completes, so the rail count can move. */
  onShared?: () => void;
  onOpenPanel?: (tab: PostVideoDetailTab) => void;
  onAvatarClick?: () => void;
  onFollow?: (creatorId: string) => void;
}

export function PostVideoActionRail({
  footer,
  topSlot,
  className,
  post,
  mediaVariant = 'video',
  detailPanelOpenOverride,
  isLikedOverride,
  totalLikeOverride,
  totalCommentOverride,
  totalShareOverride,
  onLikeChange,
  onShared,
  onOpenPanel,
  onAvatarClick,
  onFollow
}: PostVideoActionRailProps) {
  const { isOpen: isDetailPanelOpen, openPanel, totalComment } = useContext(PostVideoDetailContext);
  const detailPanelOpen = detailPanelOpenOverride ?? isDetailPanelOpen;
  const handleOpenPanel = onOpenPanel || openPanel;
  const resolvedTotalComment = totalCommentOverride ?? totalComment;
  const isGraphic = mediaVariant === 'graphic';
  const followState = useFollowCreator(post.user?._id, Boolean(post.user?.isFollowed), onFollow);
  const [sharePanelOpen, setSharePanelOpen] = useState(false);
  const resolvedTotalShare = totalShareOverride ?? post.totalShare ?? 0;

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL('/', window.location.origin);
    url.searchParams.set('modal_id', post._id);
    return url.toString();
  }, [post._id]);

  /**
   * Reports a completed share. Opening the panel does not reach here, so the
   * counter and the owner's notification only move for shares that happened.
   *
   * The rail count advances only when the backend reports a newly recorded
   * sharer: `totalShare` counts distinct users, so sharing the same post twice
   * must not move it.
   */
  const handleShared = useCallback(async () => {
    try {
      const response = await recordShare('post', post._id);
      if (response?.data?.created) onShared?.();
    } catch {
      // Nothing to correct on screen: the counter was never moved.
    }
  }, [onShared, post._id]);

  const actionItems = [
    {
      icon: <CommentLottieIcon className="text-5xl" />,
      label: formatCompactCount(resolvedTotalComment),
      title: 'Comment',
      onClick: () => handleOpenPanel('comments')
    },
    { icon: <FavoriteLottieIcon className='text-5xl' />, label: '2022', title: 'Collect' },
    {
      icon: <ShareLottieIcon className='text-5xl' />,
      label: formatCompactCount(resolvedTotalShare),
      title: 'Share',
      onClick: () => setSharePanelOpen(true)
    },
    isGraphic
      ? {
        icon: <YoutubeIcon className='text-2xl' />,
        label: 'Related',
        title: 'Related',
        onClick: () => handleOpenPanel('related')
      }
      : { icon: <HeadphoneIcon className='text-4xl' />, label: 'Listen Video', title: 'Listen video' },
    { icon: <MoreIcon className='text-5xl' />, label: '', title: 'More actions' }
  ];

  return (
    <aside
      className={`absolute z-40 flex w-17 flex-col items-center gap-2 origin-right-bottom scale-[1.07647] pr-4 bottom-20 justify-end ${className}`}
      style={{ marginRight: detailPanelOpen ? VIDEO_DETAIL_PANEL_WIDTH : 0 }}
    >
      {sharePanelOpen ? (
        <SharePanel
          open={sharePanelOpen}
          onClose={() => setSharePanelOpen(false)}
          shareUrl={shareUrl}
          shareTitle={post.text || post.tagline || 'Post'}
          onShared={handleShared}
        />
      ) : null}

      {/* Nav pill or other top content (modal only) */}
      {topSlot ? <div className="mb-1 shrink-0">{topSlot}</div> : null}

      {!isGraphic ? (
        <button
          type="button"
          className="my-2 cursor-pointer w-11 h-11 border border-solid border-[rgba(255,255,255,.12)] rounded-xl flex justify-center items-center"
        >
          <AiEntryIcon className='text-3xl' />
        </button>
      ) : <div className='h-8 w-8' />}

      <div className="group/avatar relative my-1.5 transition hover:scale-105">
        <span className="pointer-events-none absolute right-full top-1/2 z-60 mr-3 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-xl bg-[#33343f]/95 px-3 py-2 text-xs font-semibold text-white opacity-0 shadow-xl backdrop-blur-md transition-opacity group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100">
          {isGraphic ? 'View author and post details' : 'View author and video details'}
          <kbd className="flex h-5 min-w-5 items-center justify-center rounded-md bg-white px-1.5 text-[11px] font-bold text-[#252631]">F</kbd>
        </span>
        <button
          type="button"
          onClick={onAvatarClick || (() => handleOpenPanel('videos'))}
          className="block cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-white"
          aria-label={`Open ${post.user.name || post.user.username}'s details`}
        >
          <img
            src={post.user.avatar || '/no_avatar.jpeg'}
            alt={post.user.name}
            className="h-12 w-12 rounded-full object-cover ring-2 ring-white/80"
          />
        </button>
        {!followState.isOwner && !followState.isFollowed ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void followState.follow();
            }}
            disabled={followState.following}
            className="absolute -bottom-1.5 left-1/2 z-10 flex h-4.5 w-4.5 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full bg-[#ff2f5f] text-xs font-bold text-white shadow-sm ring-1 ring-white/20 transition hover:scale-110 disabled:cursor-wait disabled:opacity-60"
            aria-label={`Follow ${post.user.name || post.user.username}`}
          >
            +
          </button>
        ) : null}
      </div>

      <LikeButton
        contentType="post"
        contentId={post._id}
        initialIsLiked={isLikedOverride ?? Boolean(post.isLiked)}
        initialTotalLikes={totalLikeOverride ?? post.totalLike ?? 0}
        onSuccess={onLikeChange}
        unstyled
        tooltip={false}
        showCount
        animateOnLike
        className="group/action flex cursor-pointer flex-col items-center text-white/92 hover:text-white"
        renderIcon={({ isLiked, animating }) => (
          <span className="douyin-action-icon flex h-11 w-11 items-center justify-center text-[34px] drop-shadow-[0_2px_5px_rgba(0,0,0,0.5)]">
            {isLiked ? (
              <LikeActiveIcon className="text-5xl" animate={animating} />
            ) : (
              <LikeLottieIcon className="text-5xl" />
            )}
          </span>
        )}
        renderCount={(totalLikes) => (
          <span className="mt-1 max-w-16 select-none text-center text-xs font-bold text-white/90">
            {formatCompactCount(totalLikes)}
          </span>
        )}
      />
      {actionItems.map((item) => {
        return (
          <button
            key={item.title}
            type="button"
            onClick={item.onClick}
            className="group/action flex cursor-pointer flex-col items-center text-white/92 hover:text-white"
            aria-label={item.title}
          >
            <span className="douyin-action-icon flex h-11 w-11 items-center justify-center text-[34px] drop-shadow-[0_2px_5px_rgba(0,0,0,0.5)]">
              {item.icon}
            </span>
            {item.label !== undefined ? (
              <span
                className='text-center select-none max-w-16 text-xs font-bold text-white/90 mt-1'
              >
                {item.label}
              </span>
            ) : null}
          </button>
        );
      })}
      {footer}
    </aside>
  );
}

interface PostVideoStageProps {
  post: IPost;
  playerId: string;
  popupPlaylist: PopupPipVideo[];
  playerRef?: Ref<VideoPlayerRef>;
  initialTime?: number;
  isActiveSlide?: boolean;
  onPictureInPictureOpen?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  collectionLabel?: ReactNode;
  children?: ReactNode;
  className?: string;
  rightGutter?: string;
  detailPanelTab?: PostVideoDetailTab | null;
  /** Comment a notification deep-linked to; forwarded to the comments tab. */
  targetCommentId?: string | null;
  /** Aggregate fallback: the comment that opened the group. */
  targetCommentFallbackId?: string | null;
  onDetailPanelTabChange?: (tab: PostVideoDetailTab | null) => void;
  videoModeActive?: boolean;
  onVideoModeActiveChange?: (active: boolean) => void;
  creatorVideos?: IPost[];
  creatorVideosLoading?: boolean;
  creatorVideosHasMore?: boolean;
  creatorVideosError?: string | null;
  onLoadMoreCreatorVideos?: () => void;
  onSelectCreatorVideo?: (post: IPost) => void;
  onTotalCommentChange?: (total: number) => void;
  /** Remove rounded corners — use for full-screen modal mode */
  disableRounding?: boolean;
  /** Controlled PiP state from a parent feed's usePipFeedSync. Omit to have this stage track it on its own (read-only). */
  popupPipState?: PopupPipState | null;
}

export default function PostVideoStage({
  post,
  playerId,
  popupPlaylist,
  playerRef,
  initialTime = 0,
  isActiveSlide = true,
  onPictureInPictureOpen,
  onTimeUpdate,
  collectionLabel = 'For You',
  children,
  className,
  rightGutter = '0px',
  detailPanelTab: controlledDetailPanelTab,
  targetCommentId = null,
  targetCommentFallbackId = null,
  onDetailPanelTabChange,
  videoModeActive: controlledVideoModeActive,
  onVideoModeActiveChange,
  creatorVideos = [post],
  creatorVideosLoading = false,
  creatorVideosHasMore = false,
  creatorVideosError = null,
  onLoadMoreCreatorVideos = () => undefined,
  onSelectCreatorVideo = () => undefined,
  onTotalCommentChange,
  disableRounding = false,
  popupPipState: controlledPopupPipState
}: PostVideoStageProps) {
  const [internalDetailPanelTab, setInternalDetailPanelTab] = useState<PostVideoDetailTab | null>(null);
  const [internalVideoModeActive, setInternalVideoModeActive] = useState(false);
  const [totalComment, setTotalComment] = useState(post.totalComment || 0);

  const detailPanelTab = onDetailPanelTabChange
    ? controlledDetailPanelTab || null
    : internalDetailPanelTab;

  const videoModeActive = onVideoModeActiveChange
    ? Boolean(controlledVideoModeActive)
    : internalVideoModeActive;

  const creatorName = post.user?.name || post.user?.username || 'Unknown';
  const description = post.text || post.tagline || '';
  const mediaUrl = getPostMedia(post);
  const popupPayload = getPopupVideo(post);
  const timeText = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  const roundedClass = disableRounding ? 'rounded-none' : 'rounded-2xl';

  const isControlledPopupPipState = controlledPopupPipState !== undefined;
  const [internalPopupPipState, setInternalPopupPipState] = useState<PopupPipState | null>(() => readPopupPipState());
  useEffect(() => {
    if (isControlledPopupPipState) return;
    return subscribePopupPipState(setInternalPopupPipState);
  }, [isControlledPopupPipState]);
  const popupPipState = isControlledPopupPipState ? controlledPopupPipState : internalPopupPipState;

  // When a parent feed drives the PiP state (for-you / following), any active PiP session must keep
  // this stage covered — matching on videoId would briefly uncover the video on the intermediate
  // render where the PiP has advanced to the next post but the feed has not caught up yet.
  const isCurrentPopup = Boolean(
    popupPipState?.active
    && (isControlledPopupPipState
      || (popupPayload && popupPipState.video.videoId === popupPayload.videoId))
  );

  const resumeInlinePlayback = useCallback(() => {
    closePopupPipWindow();
    closePopupPip(popupPipState?.video.currentTime, true);
  }, [popupPipState?.video.currentTime]);

  const setDetailPanelTab = useCallback((tab: PostVideoDetailTab | null) => {
    if (onDetailPanelTabChange) {
      onDetailPanelTabChange(tab);
      return;
    }
    setInternalDetailPanelTab(tab);
  }, [onDetailPanelTabChange]);

  const setVideoModeActive = useCallback((active: boolean) => {
    if (onVideoModeActiveChange) {
      onVideoModeActiveChange(active);
      return;
    }
    setInternalVideoModeActive(active);
  }, [onVideoModeActiveChange]);

  const togglePanel = useCallback((tab: PostVideoDetailTab) => {
    if (tab === 'videos' && !videoModeActive) setVideoModeActive(true);
    setDetailPanelTab(detailPanelTab === tab ? null : tab);
  }, [detailPanelTab, setDetailPanelTab, setVideoModeActive, videoModeActive]);

  const handleTotalCommentChange = useCallback((total: number) => {
    setTotalComment((current) => current === total ? current : total);
    onTotalCommentChange?.(total);
  }, [onTotalCommentChange]);

  const detailContext = useMemo<PostVideoDetailContextValue>(() => ({
    isOpen: Boolean(detailPanelTab),
    openPanel: (tab = 'details') => togglePanel(tab),
    totalComment,
    setTotalComment
  }), [detailPanelTab, togglePanel, totalComment]);

  const layoutStyle = useMemo(() => {
    const contentWidth = rightGutter === '0px' ? '100%' : `calc(100% - ${rightGutter})`;
    return {
      '--post-video-right-gutter': rightGutter,
      '--post-video-player-width': detailPanelTab
        ? `calc(${contentWidth} * ${POST_VIDEO_PLAYER_RATIO})`
        : contentWidth,
      '--post-video-detail-panel-width': `calc(${contentWidth} * ${POST_VIDEO_PANEL_RATIO})`
    } as CSSProperties;
  }, [detailPanelTab, rightGutter]);

  useEffect(() => {
    setTotalComment(post.totalComment || 0);
  }, [post._id, post.totalComment]);

  return (
    <PostVideoDetailContext.Provider value={detailContext}>
      <section
        className={`relative h-full min-h-0 w-full overflow-hidden ${className}`}
        style={layoutStyle}
      >
        <div
          className={`relative h-full min-h-0 overflow-hidden transition-[width] duration-300 ${roundedClass} bg-black shadow-[0_24px_70px_rgba(0,0,0,.32)]`}
          style={{ width: 'var(--post-video-player-width)' }}
        >
          <div
            className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center opacity-70 blur-3xl"
            style={{ backgroundImage: `url(${mediaUrl})` }}
            aria-hidden
          />

          <div className="pointer-events-none absolute inset-0 bg-black/35" aria-hidden />

          <VideoPlayer
            ref={playerRef}
            id={playerId}
            src={getPostVideo(post)}
            poster={mediaUrl}
            muted
            controls
            preload="auto"
            isActiveSlide={isActiveSlide}
            autoplayOnActive={!isCurrentPopup}
            alwaysShowControls
            initialTime={initialTime}
            showFullscreenControl
            showVolumeSlider
            showCenterPlayButton
            forceBackgroundBlur
            objectFit="auto"
            pictureInPicturePayload={popupPayload || undefined}
            pictureInPicturePlaylist={popupPlaylist}
            onPictureInPictureOpen={onPictureInPictureOpen}
            onTimeUpdate={onTimeUpdate}
            className={`h-full min-h-0! ${roundedClass}`}
            classVideo=""
            suppressPictureInPictureOverlay
          />
          {detailPanelTab !== 'details' ? (
            <div className="pointer-events-none absolute bottom-16 left-4 z-40 max-w-[min(760px,calc(100%-112px))] pr-8 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,.75)]">
              <div className="mb-2 text-lg font-bold">
                @{creatorName}{timeText ? <span className="ml-2 text-base font-semibold text-white/85">· {timeText}</span> : null}
              </div>
              {description ? (
                <PostDetailDescription
                  key={post._id}
                  text={description}
                  onOpenDetails={() => setDetailPanelTab('details')}
                  className="pointer-events-auto"
                />
              ) : null}
              <button type="button" className="pointer-events-auto mt-3 inline-flex cursor-pointer items-center rounded-lg bg-white/16 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/24">
                Collection · {collectionLabel}
              </button>
            </div>
          ) : null}
        </div>
        {children}
        {isCurrentPopup ? (
          <div className="absolute inset-0 z-60 flex flex-col items-center justify-center gap-5 bg-black text-center text-white w-[calc(100%-68px)]">
            <p className="text-base font-medium text-white/70">Playing in Picture-in-Picture</p>
            <button
              type="button"
              onClick={resumeInlinePlayback}
              className="cursor-pointer rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white/90 backdrop-blur-sm transition hover:bg-white/20"
            >
              Click to resume playback here
            </button>
          </div>
        ) : null}
        {detailPanelTab ? (
          <PostVideoDetailPanel
            targetCommentId={targetCommentId}
            targetCommentFallbackId={targetCommentFallbackId}
            post={post}
            activeTab={detailPanelTab}
            creatorVideos={creatorVideos}
            creatorVideosLoading={creatorVideosLoading}
            creatorVideosHasMore={creatorVideosHasMore}
            creatorVideosError={creatorVideosError}
            onLoadMoreCreatorVideos={onLoadMoreCreatorVideos}
            onSelectVideo={onSelectCreatorVideo}
            onTabChange={togglePanel}
            onClose={() => setDetailPanelTab(null)}
            rightOffset={rightGutter}
            totalComment={totalComment}
            onTotalCommentChange={handleTotalCommentChange}
          />
        ) : null}
      </section>
    </PostVideoDetailContext.Provider>
  );
}
