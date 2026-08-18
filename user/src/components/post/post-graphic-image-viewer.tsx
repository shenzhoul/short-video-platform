'use client';

import Modal from '@components/ui/modal';
import type { GraphicFileItem } from '@hooks/use-post-graphic-create';
import { useEffect, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiX } from 'react-icons/fi';

interface PostGraphicImageViewerProps {
  items: GraphicFileItem[];
  initialItemId: string | null;
  onClose: () => void;
}

export default function PostGraphicImageViewer({
  items,
  initialItemId,
  onClose
}: PostGraphicImageViewerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const open = initialItemId !== null;

  useEffect(() => {
    if (!initialItemId) return;
    const nextIndex = items.findIndex(item => item.id === initialItemId);
    setActiveIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [initialItemId, items]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setActiveIndex(index => Math.max(index - 1, 0));
      if (event.key === 'ArrowRight') setActiveIndex(index => Math.min(index + 1, items.length - 1));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items.length, onClose, open]);

  const activeItem = items[activeIndex];

  return (
    <Modal
      open={open}
      width={960}
      footer={false}
      closable={false}
      noPadding
      maskClosable
      className="overflow-hidden rounded-none bg-[#222] text-white"
      onCancel={onClose}
    >
      <div className="relative flex h-[min(540px,80dvh)] items-center justify-center bg-[#222]">
        {activeItem?.previewUrl ? (
          <img
            src={activeItem.previewUrl}
            alt={`Graphic ${activeIndex + 1} of ${items.length}`}
            className="h-full max-w-full object-contain"
          />
        ) : null}
        <button
          type="button"
          aria-label="Close image viewer"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-2xl transition hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-white"
          onClick={onClose}
        >
          <FiX />
        </button>
        {activeIndex > 0 ? (
          <button
            type="button"
            aria-label="View previous image"
            className="absolute left-5 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-2xl transition hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"
            onClick={() => setActiveIndex(index => Math.max(index - 1, 0))}
          >
            <FiChevronLeft />
          </button>
        ) : null}
        {activeIndex < items.length - 1 ? (
          <button
            type="button"
            aria-label="View next image"
            className="absolute right-5 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-2xl transition hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"
            onClick={() => setActiveIndex(index => Math.min(index + 1, items.length - 1))}
          >
            <FiChevronRight />
          </button>
        ) : null}
        <span className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2 py-0.5 text-xs">
          {activeIndex + 1}/{items.length}
        </span>
      </div>
    </Modal>
  );
}
