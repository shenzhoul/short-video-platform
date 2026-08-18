'use client';

import { VIDEO_PLAYER_EVENT } from '@constants/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiX } from 'react-icons/fi';

interface MediaFile {
  _id: string;
  url: string;
  type: string;
  thumbnails?: string[];
}

interface MediaLightboxProps {
  files: MediaFile[];
  startIndex: number;
  initialVideoTime?: number;
  onClose: () => void;
}

export default function MediaLightbox({ files, startIndex, initialVideoTime = 0, onClose }: MediaLightboxProps) {
  const [index, setIndex] = useState(startIndex || 0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % (files?.length || 1));
  }, [files?.length]);

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + (files?.length || 1)) % (files?.length || 1));
  }, [files?.length]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [next, prev, onClose]);

  // Lock scroll when lightbox is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Set initial video time when video is loaded and it's a video file
  useEffect(() => {
    // const currentFile = files[index];
    if (videoRef.current && initialVideoTime > 0) {
      const videoElement = videoRef.current;
      const handleLoadedMetadata = () => {
        if (videoElement) {
          videoElement.currentTime = initialVideoTime;
        }
      };

      // If metadata is already loaded, set time immediately
      if (videoElement.readyState >= 1) {
        videoElement.currentTime = initialVideoTime;
      } else {
        videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
        return () => {
          videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
        };
      }
    }
  }, [index, initialVideoTime, files]);

  if (!files || files.length === 0) return null;

  const safeIndex = Math.max(0, Math.min(index, files.length - 1));
  const file = files[safeIndex];
  if (!file) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-1000">
      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white hover:text-gray-300 transition"
      >
        <FiX size={28} />
      </button>

      {/* Prev / Next */}
      {files.length > 1 && (
        <>
          <button
            type="button"
            onClick={prev}
            className="absolute z-10 left-4 text-white hover:text-gray-300 transition"
          >
            <FiChevronLeft size={40} />
          </button>
          <button
            type="button"
            onClick={next}
            className="absolute z-10 right-4 text-white hover:text-gray-300 transition"
          >
            <FiChevronRight size={40} />
          </button>
        </>
      )}

      {/* Media */}
      <div className="max-w-[90vw] max-h-[90vh] flex items-center justify-center w-full h-full">
        {file.type.includes('photo') ? (
          <img
            src={file.url}
            alt="Full view"
            className="max-w-full max-h-[90vh] object-contain"
            onError={(e) => (e.currentTarget.src = '/no-image.jpg')}
          />
        ) : file.type.includes('video') ? (
          <video
            ref={videoRef}
            key={file._id}
            src={file.url}
            poster={file.thumbnails?.[0]}
            className="max-w-full max-h-[90vh] object-contain"
            controls
            autoPlay
            preload="metadata"
            onPlay={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent(VIDEO_PLAYER_EVENT, { detail: { videoId: file._id } }));
              }
            }}
          />
        ) : (
          <audio
            ref={videoRef}
            id={file._id}
            src={file.url}
            autoPlay
            onPlay={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent(VIDEO_PLAYER_EVENT, { detail: { videoId: file._id } }));
              }
            }}
            controls
            preload="metadata"
            className="w-full max-w-md"
          />
        )}
      </div>
    </div>
  );
}
