'use client';

import Button from '@components/ui/button';
import Spin from '@components/ui/spin';
import VideoPlayer from '@components/ui/video-player';
import useVideoManager from '@hooks/use-video-manager';
import { videoDuration } from '@lib/duration';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AiOutlineEye,
  AiOutlineFileImage,
  AiOutlineLock,
  AiOutlineUnlock,
  AiOutlineVideoCamera
} from 'react-icons/ai';
import { FiPlay } from 'react-icons/fi';
import { IPost, IUser } from 'src/interfaces';

import MediaLightbox from './media-lightbox';

interface MediaFile {
  _id: string;
  url: string;
  type: string;
  thumbnails?: string[];
}

interface PostMediaDisplayProps {
  post: IPost;
  user?: IUser | null;
  creator?: any;
  previewThumbnail?: string | null;
  actionsDisabled?: boolean;
  onClickViewPost?: () => void;
  onViewTeaser?: () => void;
  className?: string;
  variant?: 'card' | 'slider' | 'preview';
}

/**
 * PostMediaDisplay - Shared component for displaying post media content
 *
 * A versatile media display component that handles both images and videos in a carousel format.
 * Supports locked/unlocked content states and provides comprehensive video management.
 *
 * Features:
 * - Mixed media carousel (images and videos) with smooth transitions
 * - Locked preview mode with purchase buttons for premium content
 * - Unlocked slider mode with full media access
 * - Automatic video pause when out of viewport for performance
 * - Video pause when switching slides to prevent audio conflicts
 * - Proper video lifecycle management with cleanup
 * - Video autoplay on active slides with Safari compatibility
 * - Processing state handling for media being encoded
 * - Responsive design for mobile and desktop
 * - Reusable across post card, post slider, and other components
 * - Thumbnail fallback for failed media loads
 *
 * Video Management:
 * - Uses useVideoManager hook for centralized video control
 * - Registers/unregisters videos automatically
 * - Handles viewport intersection for performance optimization
 * - Supports muted autoplay for better UX
 *
 * Usage:
 * ```tsx
 * // Locked preview mode
 * <PostMediaDisplay
 *   post={postData}
 *   user={currentUser}
 *   creator={postCreator}
 *   variant="card"
 *   onClickViewPost={handleViewPost}
 * />
 *
 * // Unlocked slider mode
 * <PostMediaDisplay
 *   post={postData}
 *   variant="slider"
 * />
 * ```
 */
export function PostMediaDisplay({
  post,
  previewThumbnail,
  actionsDisabled = false,
  className = '',
  variant = 'card',
  onViewTeaser = () => { }
}: PostMediaDisplayProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [videoPlaybackTime, setVideoPlaybackTime] = useState<number>(0);
  const videoRefs = useRef<Record<string, HTMLVideoElement | HTMLAudioElement | null>>({});

  // Use video manager hook for proper video lifecycle management
  const {
    containerRef,
    registerVideo,
    unregisterVideo,
    isInViewport,
    notifyVideoPlay
  } = useVideoManager({
    pauseOnOutOfView: true,
    pauseOnSlideChange: true,
    viewportThreshold: 0.8
  });

  const allFiles = useMemo(() => post.files || [], [post.files]);
  const images = allFiles.filter((f) => f.type?.includes?.('photo'));
  const videos = allFiles.filter((f) => f.type?.includes?.('video'));
  const isProcessing = videos.some((f) => f.processingStatus !== 'completed');
  const isError = videos.some((f) => f.processingStatus === 'failed' || f.status === 'error');
  const hasMedia = allFiles.length > 0;
  const postType = post.type || 'text';
  const openLightbox = useCallback((index: number) => {
    // Get the file at the index
    const file = allFiles[index];

    // If it's a video, capture current playback time before pausing
    if (file && file.type.includes('video')) {
      const videoEl = videoRefs.current[file._id];
      if (videoEl) {
        setVideoPlaybackTime(videoEl.currentTime || 0);
      }
    }

    // Pause all currently playing videos in the mini-player
    Object.values(videoRefs.current).forEach((videoEl) => {
      if (videoEl && !videoEl.paused) {
        videoEl.pause();
      }
    });

    setCurrentIndex(index);
    setLightboxOpen(true);
  }, [allFiles, videoRefs]);

  const renderMedia = useCallback((file: MediaFile, i?: number) => {
    if (file.type?.includes?.('photo')) {
      return (
        <img
          src={file.url}
          alt="Post content"
          key={file._id}
          onClick={() => openLightbox(i ?? 0)}
          className={`w-full h-full object-cover cursor-pointer ${allFiles.length === 1 ? 'max-h-[500px] m-auto w-auto! max-w-full' : 'absolute top-0 left-0'}`}
        />
      );
    }

    return (
      <>
        {allFiles.length === 1 && file.type?.includes?.('video') ? (
          <VideoPlayer
            id={file._id}
            src={file.url}
            poster={file.thumbnails?.[0]}
            onReady={(videoElement: HTMLVideoElement) => {
              videoRefs.current[file._id] = videoElement;
              registerVideo(file._id, videoElement);
            }}
            onPlay={() => notifyVideoPlay(file._id)}
            controls
            preload="metadata"
            classVideo="h-full w-auto max-w-full object-contain"
            className={`w-full cursor-pointer ${allFiles.length === 1 ? 'h-[500px] max-md:h-[70dvh]' : 'absolute top-0 left-0 h-full'}`}
          />
        ) : null}
        {allFiles.length !== 1 && (
          <div className='w-full h-full absolute top-0 left-0 cursor-pointer'>
            <img
              src={(file.type?.includes?.('video') ? file.thumbnails?.[0] : '/placeholder-audio.png') || '/no-image.png'}
              alt="Video thumbnail"
              className="w-full h-full object-cover absolute top-0 left-0"
              onClick={() => openLightbox(i)}
            />
            <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white w-12 h-12 flex justify-center items-center rounded-full bg-black/50 pl-1 pointer-events-none'>
              <FiPlay size={25} />
            </div>
          </div>
        )}
      </>
    );
  }, [allFiles, openLightbox, notifyVideoPlay, registerVideo, videoRefs]);

  // Auto re-play video when scrolls back into viewport. Audio should only play
  // after an explicit user action.
  useEffect(() => {
    if (!isInViewport) return;
    const activeFile = allFiles.find((f) => f.type.includes('video'));
    if (activeFile) {
      const videoEl = videoRefs.current[activeFile._id];
      if (videoEl) {
        const timer = setTimeout(() => {
          // First notify other videos to pause before we start playing
          notifyVideoPlay(activeFile._id);
          videoEl.play().catch(() => { });
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [isInViewport, allFiles, notifyVideoPlay]);

  // Cleanup video registrations when post changes
  useEffect(() => {
    return () => {
      videos.forEach((video: any) => {
        unregisterVideo(video._id);
      });
    };
  }, [post._id, videos, unregisterVideo]);

  // Processing state
  if (isProcessing && variant === 'slider') {
    return (
      <div className="bg-surface-muted flex flex-col items-center justify-center p-10 rounded-lg">
        <Spin />
        <p className="mt-3 opacity-60">{isError ? 'We’re having trouble loading this media.' : 'Your media is currently being processed.'}</p>
      </div>
    );
  }

  // No media for text-only posts
  if (postType === 'text' || !hasMedia) {
    return null;
  }

  // Slider variant (unlocked content)
  if (variant === 'slider') {
    return (
      <div ref={containerRef} className={`relative overflow-hidden ${className}`}>

        {/* ===== upload 1 ===== */}
        {allFiles.length === 1 && (
          <div className="w-full overflow-hidden relative flex items-center justify-center bg-black">
            <div className='absolute top-0 left-0 w-full h-full blur-lg scale-110' style={{ backgroundImage: `url(${allFiles[0].thumbnails[0]})` }} />
            <div className='relative z-1 w-full'>{renderMedia(allFiles[0])}</div>
          </div>
        )}

        {/* ===== upload 2 ===== */}
        {allFiles.length === 2 && (
          <div className="flex gap-0.5">
            {allFiles.map((file: any, i: number) => (
              <div key={file._id} className="w-1/2 pt-[50%] overflow-hidden relative">
                {renderMedia(file, i)}
              </div>
            ))}
          </div>
        )}

        {/* ===== upload 3 ===== */}
        {allFiles.length === 3 && (
          <div className="flex gap-0.5">
            <div className="relative pt-[80%] flex-1">{renderMedia(allFiles[0])}</div>
            <div className="flex flex-col gap-0.5 flex-1">
              {allFiles.slice(1, 3).map((file: any, i: number) => (
                <div key={file._id} className="w-full h-full overflow-hidden relative">
                  {renderMedia(file, i + 1)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== upload 4 ===== */}
        {allFiles.length === 4 && (
          <div className="grid grid-cols-2 gap-0.5">
            {allFiles.map((file: any, i: number) => (
              <div key={file._id} className="pt-[90%] overflow-hidden relative">
                {renderMedia(file, i)}
              </div>
            ))}
          </div>
        )}

        {/* ===== upload 5+ ===== */}
        {allFiles.length >= 5 && (
          <div className="flex flex-col gap-0.5">
            <div className="flex gap-0.5">
              {allFiles.slice(0, 2).map((file: any, i: number) => (
                <div key={file._id} className="w-1/2 pt-[50%] overflow-hidden relative">
                  {renderMedia(file, i)}
                </div>
              ))}
            </div>
            <div className="flex gap-0.5">
              {allFiles.slice(2, 5).map((file: any, i: number) => (
                <div key={file._id} onClick={() => openLightbox(i + 2)} className="w-1/3 pt-[33%] overflow-hidden relative">
                  {renderMedia(file, i)}
                  {i === 2 && allFiles.length > 5 && (
                    <div className="absolute cursor-pointer inset-0 bg-black/60 flex items-center justify-center text-white text-3xl max-md:text-xl font-semibold">
                      +{allFiles.length - 5}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {lightboxOpen ? (
          <MediaLightbox
            files={allFiles}
            startIndex={currentIndex}
            initialVideoTime={videoPlaybackTime}
            onClose={() => {
              setLightboxOpen(false);
              setVideoPlaybackTime(0);
            }}
          />
        ) : null}
      </div>
    );
  }
  // Check if we have a thumbnail (should NOT be blurred)
  const hasThumbnail = !!previewThumbnail;

  // Get blur image ONLY from file blurImage property (not thumbnails)
  const blurImageUrl = !hasThumbnail ? (() => {
    const fileWithBlur = allFiles.find((f) => f.blurImage);
    return fileWithBlur?.blurImage || null;
  })() : null;

  // Card/Preview variant (locked content with overlay)
  return (
    <div
      ref={containerRef}
      className={`relative flex items-center justify-center p-5 h-[400px] transition-all duration-500 overflow-hidden ${className}`}
    >
      {/* Background - either clear thumbnail or blurred image */}
      {hasThumbnail ? (
        // Show thumbnail clearly without blur
        <>
          <div
            className="absolute inset-0 bg-cover bg-no-repeat bg-center"
            style={{
              backgroundImage: `url(${previewThumbnail})`
            }}
          />
          <div className="absolute inset-0 bg-black/40" />
        </>
      ) : blurImageUrl ? (
        // Show blurred image for files without thumbnails
        <>
          <div
            className="absolute inset-0 bg-cover bg-no-repeat bg-center"
            style={{
              backgroundImage: `url(${blurImageUrl})`,
              filter: 'blur(20px)',
              transform: 'scale(1.1)' // Prevent blur edge artifacts
            }}
          />
          <div className="absolute inset-0 bg-black/40" />
        </>
      ) : (
        // Fallback: Gradient background when no thumbnail available
        <div className="absolute inset-0 bg-linear-to-br from-gray-800 via-gray-700 to-gray-900">
          {/* Decorative elements */}
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-surface/10 rounded-full blur-3xl" />
            <div className="absolute bottom-1/3 right-1/4 w-40 h-40 bg-surface/10 rounded-full blur-3xl" />
          </div>
        </div>
      )}
      {/* Overlay Content */}
      <div
        className="text-center relative z-10"
        style={{
          cursor: actionsDisabled ? 'not-allowed' : 'pointer',
          opacity: actionsDisabled ? 0.7 : 'unset'
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Lock/Unlock Icon */}
        <div className='bg-black/50 rounded-full inline-flex h-[40px] min-w-[40px] px-1 items-center justify-center mb-5'>
          {(!isHovered ? <AiOutlineLock className="text-2xl text-white" /> : <AiOutlineUnlock className="text-2xl text-white" />)}
        </div>

        {/* Teaser Button */}
        {post.teaser ? (
          <div className="text-center mt-2">
            <Button
              onClick={onViewTeaser}
              variant="primary"
              size="md"
            >
              <AiOutlineEye />
              <span className="ml-2">View teaser</span>
            </Button>
          </div>
        ) : null}
      </div>

      {/* Media Count Badge */}
      {hasMedia ? (
        <div className="absolute bottom-2 text-center text-white px-4 py-2 rounded-full bg-black/50  text-sm">
          <span className="flex items-center gap-2">
            {images.length > 0 && (
              <span className="flex items-center">
                {images.length > 1 && images.length} <AiOutlineFileImage className="ml-1" />
              </span>
            )}
            {videos.length > 0 && images.length > 0 && '|'}
            {videos.length > 0 && (
              <span className="flex items-center">
                {videos.length > 1 && videos.length} <AiOutlineVideoCamera className="ml-1" />
                {videos.length === 1 && videoDuration(videos[0]?.duration)}
              </span>
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default PostMediaDisplay;
