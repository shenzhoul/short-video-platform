'use client';

import VideoPlayer from '@components/ui/video-player';
import { usePostVideoHoverPlayback } from '@hooks/use-post-video-hover-playback';
import { IPost } from '@interfaces/post';
import { videoDuration } from '@lib/duration';
import { PopupPipState, PopupPipVideo } from '@lib/popup-pip';
import { toast } from 'react-toastify';
import { AddToWatchLaterIcon, HeartOutlineIcon, MuteIcon, PauseIcon, PiPIcon, PlayIcon, PlayOutlinedIcon, VolumeIcon } from 'src/icons';

import HomeFeedCoverImage from './home-feed-cover-image';
import HomeFeedGraphicCarousel from './home-feed-graphic-carousel';
import {
  formatCompactCount,
  isGraphicPost
} from './home-feed-media';

interface HomeFeedCardProps {
  post: IPost;
  featured?: boolean;
  variant?: 'default' | 'profile';
  popupPipState: PopupPipState | null;
  popupPlaylist: PopupPipVideo[];
  compactHoverActive?: boolean;
  featuredResumeTime?: number;
  onCompactHoverChange?: (postId: string | null) => void;
  onFeaturedTimeUpdate?: (currentTime: number) => void;
  onOpenDetail?: (post: IPost, currentTime: number) => void;
}

export default function HomeFeedCard({
  post,
  featured = false,
  variant = 'default',
  popupPipState,
  popupPlaylist,
  compactHoverActive = false,
  featuredResumeTime = 0,
  onCompactHoverChange,
  onFeaturedTimeUpdate,
  onOpenDetail
}: HomeFeedCardProps) {
  const isProfileVariant = variant === 'profile';
  const graphicPost = isGraphicPost(post);
  const viewCount = post.totalView || 0;
  const metaName = post.user?.name || post.user?.username || 'Unknown';
  const timeText = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const playback = usePostVideoHoverPlayback({
    post,
    featured,
    popupPipState,
    popupPlaylist,
    onCompactHoverChange,
    onFeaturedTimeUpdate,
    onOpenDetail
  });

  const image = (
    <HomeFeedCoverImage
      key={playback.mediaUrl}
      src={playback.mediaUrl}
      alt={playback.description || 'Post cover'}
    />
  );

  return (
    <article
      className={`group min-w-0 ${playback.hasVideo || graphicPost ? 'cursor-pointer' : ''}`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a, input')) return;
        if (graphicPost) {
          onOpenDetail?.(post, 0);
          return;
        }
        playback.handleOpenDetail();
      }}
    >
      <div
        className={`home-feed-card-media group/media relative isolate h-0 overflow-hidden rounded-xl border border-white/10 bg-black [clip-path:inset(0_round_0.75rem)] ${featured ? 'home-feed-featured-media' : ''}`}
        onMouseEnter={playback.handleMouseEnter}
        onMouseMove={playback.handleMouseMove}
        onMouseLeave={playback.handleMouseLeave}
      >
        <div className="absolute inset-0">
          {graphicPost ? (
            <HomeFeedGraphicCarousel
              post={post}
              alt={playback.description || 'Graphic post'}
            />
          ) : playback.showVideo ? (
            <VideoPlayer
              ref={playback.videoRef}
              id={`home-feed-${post._id}`}
              src={playback.videoUrl}
              poster={playback.mediaUrl}
              muted
              controls={featured}
              preload={featured ? 'metadata' : 'auto'}
              autoplayOnActive={!playback.isPopupActive && !playback.isCurrentPopup && !(featured && compactHoverActive)}
              alwaysShowControls={featured}
              initialTime={featured ? featuredResumeTime : 0}
              showFullscreenControl={false}
              forceBackgroundBlur={featured || isProfileVariant}
              objectFit={isProfileVariant ? 'portrait-cover' : 'auto'}
              pictureInPicturePayload={playback.popupPayload || undefined}
              pictureInPicturePlaylist={popupPlaylist}
              onReady={playback.handleReady}
              onPlay={playback.handlePlay}
              onPause={playback.handlePause}
              onEnded={playback.handleEnded}
              onTimeUpdate={playback.handleTimeUpdate}
              className={`${featured ? '' : 'min-h-0!'} h-full rounded-none`}
              classVideo="rounded-none"
            />
          ) : <div className="h-full w-full">{image}</div>}
        </div>

        <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-15 h-2/3 bg-linear-to-t from-black/82 via-black/20 to-transparent transition-opacity ${!featured && playback.isHovered && !playback.showCompactChrome ? 'opacity-0' : 'opacity-100'}`} />

        {(!featured || playback.showFeaturedThumbnail) && !playback.isHovered ? (
          <div className={`pointer-events-none absolute bottom-2 left-2 z-20 flex items-center gap-1 text-xs font-medium text-white transition-opacity ${playback.isHovered && !playback.showCompactChrome ? 'opacity-0' : 'opacity-100'}`}>
            {isProfileVariant ? (
              <PlayOutlinedIcon className="text-lg" />
            ) : (
              <HeartOutlineIcon className="text-xl" />
            )}
            <span>{formatCompactCount(isProfileVariant ? viewCount : post.totalLike)}</span>
          </div>
        ) : null}

        {!isProfileVariant && (!featured || playback.showFeaturedThumbnail) && playback.duration && !playback.isHovered ? (
          <div className={`pointer-events-none absolute bottom-2 right-2 z-20 text-xs font-medium text-white transition ${playback.isHovered && playback.hasVideo ? 'opacity-0' : 'opacity-100'}`}>
            {playback.duration}
          </div>
        ) : null}

        {!isProfileVariant && !featured && !playback.isPopupActive ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toast.info('Watch later is coming soon');
            }}
            className="absolute right-2 top-2 z-30 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/35 text-white opacity-0 transition hover:bg-black/55 group-hover:opacity-100"
            aria-label="Add to watch later"
          >
            <AddToWatchLaterIcon className="text-3xl" />
          </button>
        ) : null}

        {!featured && playback.hasVideo && playback.isHovered && !playback.isPopupActive && playback.showCompactChrome ? (
          <div className="absolute inset-x-0 bottom-0 z-30 bg-linear-to-t from-black/90 via-black/55 to-transparent px-2.5 pb-2.5 pt-4 text-white">
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={playback.compactProgress}
              onChange={playback.seek}
              aria-label="Seek video"
              style={{ background: `linear-gradient(to right, rgba(255,255,255,.95) 0%, rgba(255,255,255,.95) ${playback.compactProgress}%, rgba(255,255,255,.26) ${playback.compactProgress}%, rgba(255,255,255,.26) 100%)` }}
              className="video-player-range absolute bottom-1 left-2.5 right-2.5 h-0.5 cursor-pointer appearance-none rounded-full"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1 text-[11px] font-semibold leading-none">
                <button type="button" onClick={playback.togglePlay} className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-sm hover:bg-white/15" aria-label={playback.isPlaying ? 'Pause' : 'Play'}>
                  {playback.isPlaying ? <PauseIcon className="text-3xl" /> : <PlayIcon className="text-3xl" />}
                </button>
                <span className="shrink-0">{videoDuration(playback.hoverTime)} / {playback.hoverDuration ? videoDuration(playback.hoverDuration) : playback.duration || '00:00'}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!isProfileVariant ? (
                  <button type="button" onClick={playback.openPip} className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/25 text-sm text-white transition hover:bg-white/15" aria-label="Picture in picture">
                    <PiPIcon className="text-3xl" />
                  </button>
                ) : null}
                <button type="button" onClick={playback.toggleMute} className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/25 text-sm text-white transition hover:bg-white/15" aria-label={playback.isMuted ? 'Unmute' : 'Mute'}>
                  {playback.isMuted ? <MuteIcon className="text-3xl" /> : <VolumeIcon className="text-3xl" />}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {featured && !playback.isCurrentPopup && !playback.showFeaturedThumbnail ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-15 z-30 max-w-[56%] px-4 text-white">
            <div className="mb-1 text-sm font-semibold">@{metaName}{timeText ? ` · ${timeText}` : ''}</div>
            {playback.description ? <p className="mt-1 line-clamp-2 text-sm font-medium leading-5 text-white/95">{playback.description}</p> : null}
          </div>
        ) : null}
      </div>

      {!featured ? (
        <div className="home-feed-card-info mt-2 min-w-0 overflow-hidden">
          <button
            type="button"
            onClick={() => onOpenDetail?.(post, 0)}
            className="block w-full cursor-pointer text-left"
          >
            <h3 className={`${isProfileVariant ? 'line-clamp-1' : 'line-clamp-2'} text-sm font-medium leading-5 text-(--text-strong) transition hover:text-(--text-strong)`}>{playback.description}</h3>
          </button>
          {!isProfileVariant ? (
            <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-(--text-soft)">
              <span className="truncate">@{metaName}</span>
              {timeText ? <span className="shrink-0">· {timeText}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
