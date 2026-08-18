'use client';

import type { GraphicFileItem } from '@hooks/use-post-graphic-create';
import { type DragEvent, useRef, useState } from 'react';
import { FiCheck, FiImage, FiX } from 'react-icons/fi';

import PostGraphicImageViewer from './post-graphic-image-viewer';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.raw';

interface GraphicImageThumbnailProps {
  item: GraphicFileItem;
  index: number;
  selected: boolean;
  removable: boolean;
  disabled: boolean;
  dragging: boolean;
  dragTarget: boolean;
  onCoverSelect: () => void;
  onRemove: () => void;
  onReplace: (file: File) => void;
  onView: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function GraphicImageThumbnail({
  item,
  index,
  selected,
  removable,
  disabled,
  dragging,
  dragTarget,
  onCoverSelect,
  onRemove,
  onReplace,
  onView,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: GraphicImageThumbnailProps) {
  const replaceInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      draggable={!disabled}
      className={`group relative h-[104px] w-[80px] cursor-move overflow-hidden rounded-sm border-2 transition active:cursor-grabbing ${selected ? 'border-[#fe2c55]' : 'border-transparent'} ${dragging ? 'opacity-35' : ''} ${dragTarget ? 'ring-2 ring-[#fe2c55] ring-offset-2 ring-offset-(--surface-raised)' : ''}`}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={`Use image ${index + 1} as cover`}
        className="block h-full w-full cursor-move focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#fe2c55] active:cursor-grabbing"
        onClick={onCoverSelect}
      >
        {item.previewUrl ? (
          <img draggable={false} src={item.previewUrl} alt={`Graphic ${index + 1}`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-(--surface-hover) text-[10px] text-(--text-muted)">
            <FiImage className="text-xl" /> Replace image
          </span>
        )}
      </button>
      {selected ? (
        <span className="pointer-events-none absolute bottom-1 right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-[#fe2c55] text-white group-hover:hidden">
          <FiCheck />
        </span>
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition group-hover:bg-black/45 group-focus-within:bg-black/45" />
      {removable ? (
        <button
          type="button"
          disabled={disabled}
          aria-label={`Remove image ${index + 1}`}
          className="absolute right-0.5 top-0.5 z-10 hidden h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-black/55 text-lg text-white transition hover:bg-black/85 group-hover:flex group-focus-within:flex"
          onClick={event => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <FiX />
        </button>
      ) : null}
      <div className='bg-[rgba(28,31,35,.8)] text-white absolute bottom-0 hidden group-hover:flex group-focus-within:flex h-[26px] justify-around left-0 py-1 w-full'>
        <button
          className='cursor-pointer flex-1 text-[12px] leading-[18px] opacity-80 text-center hover:opacity-100'
          onClick={onView}
        >
          view
        </button>
        <span className='bg-[hsla(0,0%,100%,.4)] absolute h-2.5 left-1/2 w-px top-2' />
        <button
          className='cursor-pointer flex-1 text-[12px] leading-[18px] opacity-80 text-center hover:opacity-100'
          disabled={disabled}
          onClick={() => replaceInputRef.current?.click()}
        >
          replace
        </button>
      </div>
      <input
        ref={replaceInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onReplace(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}

interface PostGraphicImageEditorProps {
  items: GraphicFileItem[];
  selectedCoverId: string;
  isSubmitting: boolean;
  onCoverSelect: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onReplaceItem: (id: string, file: File) => void;
  onReorderItems: (sourceId: string, targetId: string) => void;
}

export default function PostGraphicImageEditor({
  items,
  selectedCoverId,
  isSubmitting,
  onCoverSelect,
  onRemoveItem,
  onReplaceItem,
  onReorderItems
}: PostGraphicImageEditorProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const [viewedItemId, setViewedItemId] = useState<string | null>(null);

  const clearDragState = () => {
    setDraggedId(null);
    setDragTargetId(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-start gap-2">
        {items.map((item, index) => (
          <GraphicImageThumbnail
            key={item.id}
            item={item}
            index={index}
            selected={item.id === selectedCoverId}
            removable={items.length > 1}
            disabled={isSubmitting}
            dragging={draggedId === item.id}
            dragTarget={dragTargetId === item.id && draggedId !== item.id}
            onCoverSelect={() => onCoverSelect(item.id)}
            onRemove={() => onRemoveItem(item.id)}
            onReplace={file => onReplaceItem(item.id, file)}
            onView={() => setViewedItemId(item.id)}
            onDragStart={event => {
              setDraggedId(item.id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', item.id);
            }}
            onDragOver={event => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragTargetId(item.id);
            }}
            onDrop={event => {
              event.preventDefault();
              const sourceId = draggedId || event.dataTransfer.getData('text/plain');
              if (sourceId) onReorderItems(sourceId, item.id);
              clearDragState();
            }}
            onDragEnd={clearDragState}
          />
        ))}
      </div>
      <PostGraphicImageViewer items={items} initialItemId={viewedItemId} onClose={() => setViewedItemId(null)} />
    </>
  );
}
