'use client';

import {
  formatCompactCount,
  getPostImages,
  getPostMedia,
  isGraphicPost
} from '@components/content/post/home-feed-media';
import PostPinnedBadge from '@components/content/post/post-pinned-badge';
import VideoPlayer from '@components/ui/video-player';
import { usePostVideoHoverPlayback } from '@hooks/use-post-video-hover-playback';
import { IPost } from '@interfaces/post';
import { videoDuration } from '@lib/duration';
import { PopupPipState, PopupPipVideo } from '@lib/popup-pip';
import { FiCheck } from 'react-icons/fi';
import { CopyIcon, HeartOutlineIcon, MuteIcon, PauseIcon, PlayIcon, PlayOutlinedIcon, VolumeIcon } from 'src/icons';

interface CreatorProfileWorkItemProps {
  post: IPost;
  metricVariant: 'views' | 'likes';
  popupPipState: PopupPipState | null;
  popupPlaylist: PopupPipVideo[];
  onCompactHoverChange: (postId: string | null) => void;
  onOpenDetail: (post: IPost, currentTime?: number) => void;
  batchMode: boolean;
  selected: boolean;
  onToggleSelection: (postId: string) => void;
}

export default function CreatorProfileWorkItem({
  post,
  metricVariant,
  popupPipState,
  popupPlaylist,
  onCompactHoverChange,
  onOpenDetail,
  batchMode,
  selected,
  onToggleSelection
}: CreatorProfileWorkItemProps) {
  const graphicPost = isGraphicPost(post);
  const graphicImages = getPostImages(post);
  const playback = usePostVideoHoverPlayback({
    post,
    popupPipState,
    popupPlaylist,
    onCompactHoverChange,
    onOpenDetail
  });

  return (
    <li
      className="mb-4 mr-4 inline-block w-[calc(16.66%-13.34px)] list-none select-none overflow-hidden rounded-t-[12px] leading-0 nth-[6n]:mr-0"
    >
      <a
        className="relative block w-full cursor-pointer overflow-hidden rounded-t-[12px] transition-[transform,box-shadow,background-color] duration-350"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input')) return;
          if (batchMode) {
            onToggleSelection(post._id);
            return;
          }
          if (graphicPost) onOpenDetail(post);
          else playback.handleOpenDetail();
        }}
        onMouseEnter={graphicPost || batchMode ? undefined : playback.handleMouseEnter}
        onMouseMove={graphicPost || batchMode ? undefined : playback.handleMouseMove}
        onMouseLeave={graphicPost || batchMode ? undefined : playback.handleMouseLeave}
        aria-label={batchMode
          ? `${selected ? 'Deselect' : 'Select'} post: ${post.text || post.tagline || 'Untitled post'}`
          : `Open ${graphicPost ? 'graphic' : 'video'} post: ${post.text || post.tagline || 'Untitled post'}`}
      >
        <div className="relative overflow-hidden rounded-t-[12px] pb-[133%] shadow-[0_0_0.5px_0_#363741] transition-[border-radius] delay-500 duration-350">
          <div className="absolute w-full overflow-hidden pb-[133%]">
            <div className="absolute flex h-full w-full items-center justify-center overflow-hidden">
              {!graphicPost && playback.showVideo && !batchMode ? (
                <VideoPlayer
                  ref={playback.videoRef}
                  id={`creator-profile-${post._id}`}
                  src={playback.videoUrl}
                  poster={playback.mediaUrl}
                  muted
                  controls={false}
                  preload="auto"
                  autoplayOnActive={!playback.isPopupActive && !playback.isCurrentPopup}
                  showFullscreenControl={false}
                  forceBackgroundBlur
                  objectFit="portrait-cover"
                  pictureInPicturePayload={playback.popupPayload || undefined}
                  pictureInPicturePlaylist={popupPlaylist}
                  onReady={playback.handleReady}
                  onPlay={playback.handlePlay}
                  onPause={playback.handlePause}
                  onEnded={playback.handleEnded}
                  onTimeUpdate={playback.handleTimeUpdate}
                  className="min-h-0! h-full rounded-none"
                  classVideo="rounded-none"
                />
              ) : (
                <img
                  src={graphicPost ? getPostMedia(post) : playback.mediaUrl}
                  alt={playback.description}
                  className="relative h-full max-h-full w-full max-w-full object-cover text-[#161722] transition-all duration-100 ease-linear"
                />
              )}
            </div>
          </div>
          {graphicImages.length > 1 && !batchMode ? (
            // <span className="absolute right-2.5 top-2.5 z-20 flex h-7 w-7 items-center justify-center rounded-md bg-black/35 text-xl text-white backdrop-blur-sm" aria-label={`${graphicImages.length} images`}>
            //   <CopyIcon className='text-[12px]' />
            // </span>
            <div className='absolute flex flex-wrap top-2 right-2'>
              <div className='bg-[rgba(0,0,0,.4)] border border-solid border-[rgba(255,255,255,.16)] rounded-md w-5 h-5 flex items-center justify-center'>
                <CopyIcon className='text-[12px]' />
              </div>
            </div>
          ) : null}
          {batchMode ? (
            <button
              type='button'
              aria-label={selected ? 'Deselect post' : 'Select post'}
              aria-pressed={selected}
              onClick={() => onToggleSelection(post._id)}
              className={`absolute right-2 top-2 z-40 flex h-5 w-5 cursor-pointer items-center justify-center rounded border text-white transition ${selected ? 'border-[#ff2c55] bg-[#ff2c55]' : 'border-white/70 bg-black/25 hover:bg-black/45'}`}
            >
              {selected ? <FiCheck className='text-[12px]' /> : null}
            </button>
          ) : null}
          <div className="absolute bottom-0 h-12 w-full bg-[linear-gradient(transparent_0%,rgba(0,0,0,0.5)_100%)] opacity-100" />
          {post.isPinned ? (
            <PostPinnedBadge className="absolute left-2 top-2 z-40" />
          ) : null}
          <span className={`absolute bottom-1 left-2.5 flex flex-row items-center justify-center text-[14px] font-medium leading-[22px] text-white transition-opacity ${playback.showVideo ? 'opacity-0' : 'opacity-100'}`}>
            {metricVariant === 'views' ? (
              <PlayOutlinedIcon className="text-xl" />
            ) : (
              <HeartOutlineIcon className="text-2xl" />
            )}
            <span className="ml-[5px] inline-block">
              {formatCompactCount(metricVariant === 'views' ? post.totalView || 0 : post.totalLike)}
            </span>
          </span>
          {!graphicPost && playback.showVideo && !batchMode ? (
            <div className="absolute inset-x-0 bottom-0 z-30 bg-linear-to-t from-black/88 via-black/40 to-transparent px-2.5 pb-2.5 pt-5 text-white">
              <div className="absolute bottom-1 left-2.5 right-2.5 h-0.5 overflow-hidden rounded-full bg-white/25">
                <div className="h-full rounded-full bg-white" style={{ width: `${playback.compactProgress}%` }} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={playback.togglePlay}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/25 text-white transition hover:bg-white/15"
                    aria-label={playback.isPlaying ? 'Pause' : 'Play'}
                  >
                    {playback.isPlaying ? <PauseIcon className="text-3xl" /> : <PlayIcon className="text-3xl" />}
                  </button>
                  <span className="text-[12px] font-semibold leading-none">
                    {videoDuration(playback.hoverTime)}/{playback.hoverDuration ? videoDuration(playback.hoverDuration) : playback.duration || '00:00'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={playback.toggleMute}
                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/25 text-white transition hover:bg-white/15"
                  aria-label={playback.isMuted ? 'Unmute' : 'Mute'}
                >
                  {playback.isMuted ? <MuteIcon className="text-3xl" /> : <VolumeIcon className="text-3xl" />}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </a>
      <p className="mt-2 h-[22px] overflow-hidden text-sm font-medium leading-[22px] text-(--text) line-clamp-1 transition-[margin] duration-350">
        {post.text}
      </p>
    </li>
  );
}
