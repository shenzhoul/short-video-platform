'use client';

import Button from '@components/ui/button';
import Modal from '@components/ui/modal';
import type { PostCoverRatio } from '@hooks/use-post-create';
import { FILE_VALIDATION_PRESETS, validateFileSize } from '@utils/file-validation';
import { ChangeEvent, useRef, useState } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { ImageIcon, SuccessIcon } from 'src/icons';

interface PostCoverSelectorProps {
  mode?: 'create' | 'edit';
  generatedCoverUrls: string[];
  selectedCoverIndex: number | null;
  customCoverUrls: Partial<Record<PostCoverRatio, string>>;
  existingCoverUrls?: Partial<Record<PostCoverRatio, string>>;
  disabled?: boolean;
  onCoverSelect: (ratio: PostCoverRatio, file: File) => void;
  onAiCoverSelect: (index: number) => void;
}

function CoverCard({
  label,
  widthClassName,
  imageUrl,
  isApplied,
  disabled,
  onClick
}: {
  label: string;
  widthClassName: string;
  imageUrl?: string;
  isApplied: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className={`${widthClassName} mr-2 shrink-0`}>
      <button
        type="button"
        disabled={disabled}
        className="group relative h-[120px] w-full overflow-hidden rounded-sm bg-[#606064] text-white transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55] disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onClick}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${label} preview`}
            className={`absolute inset-0 h-full w-full object-cover transition ${isApplied ? 'group-hover:scale-110 group-hover:blur-[4px] group-hover:brightness-75' : 'scale-110 blur-[4px] brightness-75'}`}
          />
        ) : null}
        <span className={`absolute inset-0 flex flex-wrap content-center items-center justify-center bg-black/35 transition group-hover:bg-black/50 ${isApplied ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
          <ImageIcon className="text-2xl text-white" />
          <span className="mt-2.5 w-full text-center text-sm font-semibold leading-5">
            {isApplied ? 'Edit cover' : 'Select cover'}
          </span>
        </span>
      </button>
      <div className="mt-1.5 text-sm text-(--text-muted)">{label}</div>
    </div>
  );
}

export default function PostCoverSelector({
  mode = 'create',
  generatedCoverUrls,
  selectedCoverIndex,
  customCoverUrls,
  existingCoverUrls = {},
  disabled = false,
  onCoverSelect,
  onAiCoverSelect
}: PostCoverSelectorProps) {
  const isEdit = mode === 'edit';
  const inputRefs = useRef<Partial<Record<PostCoverRatio, HTMLInputElement | null>>>({});
  const pendingRatioRef = useRef<PostCoverRatio>('4:3');
  const [hoveredAiCoverIndex, setHoveredAiCoverIndex] = useState<number | null>(null);
  const [pendingAiCoverIndex, setPendingAiCoverIndex] = useState<number | null>(null);
  const generatedCoverUrl = generatedCoverUrls[selectedCoverIndex ?? 0] || generatedCoverUrls[0];
  const hasConfirmedAiCover = selectedCoverIndex !== null;
  const coverRatios: PostCoverRatio[] = isEdit ? ['3:4', '4:3'] : ['4:3', '3:4'];

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const sizeValidation = validateFileSize(file, FILE_VALIDATION_PRESETS.IMAGE.maxSizeMB);
    if (!sizeValidation.isValid) {
      toast.error(sizeValidation.error || 'The selected cover is too large.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Please select a supported image file.');
      return;
    }

    const ratio = pendingRatioRef.current;
    onCoverSelect(ratio, file);
  };

  const selectCustomCover = (ratio: PostCoverRatio) => {
    pendingRatioRef.current = ratio;
    inputRefs.current[ratio]?.click();
  };

  const confirmAiCover = () => {
    if (pendingAiCoverIndex === null) return;
    onAiCoverSelect(pendingAiCoverIndex);
    setHoveredAiCoverIndex(null);
    setPendingAiCoverIndex(null);
  };

  return (
    <>
      {(['4:3', '3:4'] as PostCoverRatio[]).map(ratio => (
        <input
          key={ratio}
          ref={node => {
            inputRefs.current[ratio] = node;
          }}
          type="file"
          accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif"
          className="sr-only"
          aria-label={`Upload a custom ${ratio} cover`}
          onChange={handleFileChange}
        />
      ))}
      <div className="flex flex-row">
        {coverRatios.map(ratio => (
          <CoverCard
            key={ratio}
            label={ratio === '4:3' ? 'Horizontal Cover 4:3' : 'Vertical Cover 3:4'}
            widthClassName={ratio === '4:3' ? 'w-[160px]' : 'w-[90px]'}
            imageUrl={customCoverUrls[ratio] || existingCoverUrls[ratio] || generatedCoverUrl}
            isApplied={Boolean(customCoverUrls[ratio] || existingCoverUrls[ratio]) || hasConfirmedAiCover}
            disabled={disabled}
            onClick={() => selectCustomCover(ratio)}
          />
        ))}
        {isEdit ? null : (
          <div className="relative w-full">
            {selectedCoverIndex !== null ? (
              <span className="absolute -top-6 right-2 inline-flex items-center gap-1 text-xs text-(--text-muted)">
                <SuccessIcon className="text-[14px] text-[rgb(19,193,90)]" />
                Cover effect inspection passed
              </span>
          ) : null}
            {hoveredAiCoverIndex !== null && generatedCoverUrls[hoveredAiCoverIndex] ? (
              <div className="pointer-events-none absolute bottom-[88px] left-1/2 z-30 w-[240px] -translate-x-1/2 rounded-md bg-(--surface-raised) p-1 shadow-[0_8px_28px_rgba(0,0,0,.35)]">
                <img
                  src={generatedCoverUrls[hoveredAiCoverIndex]}
                  alt={`AI cover recommendation ${hoveredAiCoverIndex + 1} enlarged preview`}
                  className="aspect-[4/3] w-full rounded-sm object-cover"
                />
              </div>
          ) : null}
            <div className="relative flex h-[120px] min-w-[286px] flex-col justify-center rounded-sm bg-(--action-card-bg) px-4">
              <span className="mb-3 text-sm text-(--text-muted)">
                {generatedCoverUrls.length ? 'AI intelligent recommendation cover' : 'AI cover recommendations are being generated...'}
              </span>
              <div className="grid grid-cols-3 gap-2" aria-live="polite">
                {[0, 1, 2].map(index => {
                const url = generatedCoverUrls[index];
                if (!url) {
                  return (
                    <div key={index} className="relative h-[60px] overflow-hidden rounded-sm bg-[#55b7d0]" aria-label="Generating cover">
                      <span className="absolute inset-0 animate-pulse bg-[url('/ai_bg.png')] bg-cover bg-center opacity-70" />
                      <span className="absolute inset-0 flex flex-col items-center justify-center text-[9px] font-medium text-white">
                        <span className="mb-1 h-5 w-5 bg-[url('/icons/ai_generate.png')] bg-contain bg-center bg-no-repeat" />
                        Generating
                      </span>
                    </div>
                  );
                }
                const isSelected = index === selectedCoverIndex && !Object.keys(customCoverUrls).length;
                return (
                  <button
                    key={url}
                    type="button"
                    disabled={disabled}
                    aria-label={`Use AI cover ${index + 1}`}
                    aria-pressed={isSelected}
                    onMouseEnter={() => setHoveredAiCoverIndex(index)}
                    onMouseLeave={() => setHoveredAiCoverIndex(null)}
                    onFocus={() => setHoveredAiCoverIndex(index)}
                    onBlur={() => setHoveredAiCoverIndex(null)}
                    onClick={() => setPendingAiCoverIndex(index)}
                    className={`relative h-[60px] overflow-hidden rounded-sm border-2 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55] ${isSelected ? 'border-[#fe2c55]' : 'border-transparent hover:border-white/50'}`}
                  >
                    <img src={url} alt={`AI cover recommendation ${index + 1}`} className="h-full w-full object-cover" />
                    {isSelected ? (
                      <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full text-white">
                        <SuccessIcon className="text-xs text-[rgb(255,44,85)]" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
              </div>
            </div>
            <div className="mt-1.5 relative text-right text-sm">
              <span className='text-(--text-muted)'>A good cover will attract more people to view</span>
              <span className='ml-1 text-[#0077fa] cursor-pointer'>Example of a high-quality cover</span>
            </div>
          </div>
)}
      </div>
      {isEdit ? null : (
        <Modal
          open={pendingAiCoverIndex !== null}
          width={448}
          className="bg-white text-[#161823]"
          onCancel={() => setPendingAiCoverIndex(null)}
          title={(
            <span className="flex items-start gap-3 pr-8">
              <FiAlertTriangle className="mt-0.5 shrink-0 text-2xl text-[#ff9f00]" />
              <span>Are you sure you want to apply this cover?</span>
            </span>
        )}
          footer={(
            <>
              <Button
                variant="grey-light"
                size="sm"
                className="rounded-sm px-3 text-[#6f7078]"
                onClick={() => setPendingAiCoverIndex(null)}
              >
                Cancelled
              </Button>
              <Button size="sm" className="rounded-sm bg-[#fe2c55] px-3" onClick={confirmAiCover}>
                Confirm
              </Button>
            </>
        )}
        />
)}
    </>
  );
}
