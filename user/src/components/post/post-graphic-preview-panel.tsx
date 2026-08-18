'use client';

import type { GraphicFileItem } from '@hooks/use-post-graphic-create';
import { useRef } from 'react';

import PostCreateSendAssistant from './post-create-send-assistant';
import PostGraphicPhonePreview from './post-graphic-phone-preview';

interface PostGraphicPreviewPanelProps {
  items: GraphicFileItem[];
  caption: string;
  onReplaceFiles?: (files: File[]) => void;
  readOnlyMedia?: boolean;
}

export default function PostGraphicPreviewPanel({
  items,
  caption,
  onReplaceFiles,
  readOnlyMedia = false
}: PostGraphicPreviewPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="w-[243px] shrink-0">
      <div className="mb-3 flex h-8 items-center justify-center text-sm font-bold text-[#fe2c55]">Preview graphic</div>
      <PostGraphicPhonePreview items={items} caption={caption} />
      {!readOnlyMedia ? (
        <div className="mt-[31px] w-[235px]">
          <button
            type="button"
            className="group gap-1 flex h-10 w-full items-center justify-center rounded-xl border border-(--border-soft) bg-(--surface-raised) text-sm font-medium transition hover:bg-(--surface-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55]"
            onClick={() => inputRef.current?.click()}
          >
            <span
              aria-hidden
              className="block h-5 w-5 bg-(--text-muted) group-hover:bg-[#fe2c55] [mask:url('/upload_icon.svg')_center/contain_no-repeat] [-webkit-mask:url('/upload_icon.svg')_center/contain_no-repeat]"
            />
            <span className="group-hover:text-[#fe2c55]">Clear and re-upload</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff"
            className="hidden"
            onChange={event => {
            onReplaceFiles?.(Array.from(event.target.files || []));
            event.target.value = '';
          }}
          />
        </div>
) : null}
      {!readOnlyMedia ? <PostCreateSendAssistant hasSelectedCover={Boolean(items.length)} /> : null}
    </aside>
  );
}
