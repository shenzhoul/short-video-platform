'use client';

import Modal from '@components/ui/modal';
import VideoPlayer from '@components/ui/video-player';
import { useEffect, useRef } from 'react';

interface TeaserVideoModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Function to close the modal */
  onClose: () => void;
  /** Teaser video data */
  teaser?: {
    _id: string;
    url: string;
    title?: string;
  };
  /** Modal title */
  title?: string;
}

/**
 * TeaserVideoModal - A reusable modal component for displaying teaser videos
 *
 * This component handles:
 * - Video player integration with proper cleanup
 * - Modal state management
 * - Pause video when modal closes
 * - Responsive video player
 *
 * @example
 * <TeaserVideoModal
 *   open={showTeaser}
 *   onClose={() => setShowTeaser(false)}
 *   teaser={post.teaser}
 *   title="Teaser Video"
 * />
 */
export default function TeaserVideoModal({
  open,
  onClose,
  teaser,
  title = 'Teaser Video'
}: TeaserVideoModalProps) {
  const videoRef = useRef<any>(null);

  // Pause video when modal closes
  const handleClose = () => {
    if (videoRef.current?.pause) {
      videoRef.current.pause();
    }
    onClose();
  };

  // Cleanup video when component unmounts or teaser changes
  useEffect(() => {
    const videoRefCurrent = videoRef.current;
    return () => {
      if (videoRefCurrent?.pause) {
        videoRefCurrent.pause();
      }
    };
  }, [teaser?._id]);

  if (!teaser?.url) {
    return null;
  }

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={title}
      footer={false}
      className="teaser-video-modal"
      width="90%"
      style={{ maxWidth: '800px' }}
    >
      <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
        <VideoPlayer
          key={teaser._id}
          id={teaser._id}
          ref={videoRef}
          src={teaser.url}
          controls
          muted={false}
          className="w-full h-full rounded"
        />
      </div>
    </Modal>
  );
}
