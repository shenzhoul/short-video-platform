'use client';

import type { GraphicFileItem } from '@hooks/use-post-graphic-create';
import { type RefObject, useRef } from 'react';
import { FiEdit2, FiPlus } from 'react-icons/fi';

import {
  PostCreateCollectionFields,
  PostCreateDescriptionEditor,
  PostCreateIncentiveActivityField
} from './post-create-basic-information';
import { PostCreateField, PostCreateSection } from './post-create-layout';
import PostGraphicImageEditor from './post-graphic-image-editor';

interface PostGraphicBasicInformationProps {
  title: string;
  description: string;
  topicKey: string;
  descriptionEditorRef: RefObject<HTMLDivElement | null>;
  items: GraphicFileItem[];
  selectedCoverId: string;
  isSubmitting: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTopicChange: (topicKey: string) => void;
  onCoverSelect: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveItem: (id: string) => void;
  onReplaceItem: (id: string, file: File) => void;
  onReorderItems: (sourceId: string, targetId: string) => void;
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.raw';

export default function PostGraphicBasicInformation({
  title,
  description,
  topicKey,
  descriptionEditorRef,
  items,
  selectedCoverId,
  isSubmitting,
  onTitleChange,
  onDescriptionChange,
  onTopicChange,
  onCoverSelect,
  onAddFiles,
  onRemoveItem,
  onReplaceItem,
  onReorderItems
}: PostGraphicBasicInformationProps) {
  const addImagesInputRef = useRef<HTMLInputElement>(null);
  const selectedCover = items.find(item => item.id === selectedCoverId) || items[0];

  return (
    <PostCreateSection title="Basic information">
      <button type="button" className="absolute right-8 top-6 rounded-[40px] bg-(--action-card-bg) px-3 py-1 text-sm font-semibold leading-5 transition hover:bg-(--surface-hover)">
        Fill in quickly
      </button>
      <PostCreateDescriptionEditor
        title={title}
        description={description}
        descriptionEditorRef={descriptionEditorRef}
        mediaLabel="graphics"
        titleMaxLength={20}
        topicKey={topicKey}
        onTitleChange={onTitleChange}
        onDescriptionChange={onDescriptionChange}
        onTopicChange={onTopicChange}
      />
      <PostCreateIncentiveActivityField />
      <PostCreateField className="mt-6" label="Cover Settings">
        <div className="flex h-16 items-center rounded-sm bg-(--action-card-bg) px-2">
          {selectedCover?.previewUrl ? (
            <img src={selectedCover.previewUrl} alt="Selected graphic cover" className="h-12 w-10 rounded-sm object-cover" />
          ) : <span className="h-12 w-10 rounded-sm bg-(--surface-hover)" />}
          <span className="ml-3 flex-1 text-sm font-semibold">Select an image as the cover</span>
          <span className="inline-flex items-center text-sm font-semibold text-(--text-soft)">
            <FiEdit2 className="mr-2" /> Edit cover
          </span>
        </div>
        <p className="mt-1 text-xs text-(--text-muted)">Tip: A high-quality cover will greatly increase exposure.</p>
      </PostCreateField>
      <PostCreateField className="mt-6" label="Edit image">
        <PostGraphicImageEditor
          items={items}
          selectedCoverId={selectedCoverId}
          isSubmitting={isSubmitting}
          onCoverSelect={onCoverSelect}
          onRemoveItem={onRemoveItem}
          onReplaceItem={onReplaceItem}
          onReorderItems={onReorderItems}
        />
        <div className="mt-2 flex items-center text-xs text-(--text-muted)">
          <span>{items.length} image{items.length === 1 ? '' : 's'} added</span>
          {items.length < 12 ? (
            <button
              type="button"
              disabled={isSubmitting}
              className="ml-3 inline-flex h-8 cursor-pointer items-center justify-center rounded-sm bg-(--action-card-bg) px-3 font-medium text-(--text-soft) transition hover:bg-(--surface-hover) hover:text-[#fe2c55] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => addImagesInputRef.current?.click()}
            >
              <FiPlus className="mr-1 text-sm" /> Keep adding
            </button>
          ) : null}
          <input
            ref={addImagesInputRef}
            type="file"
            multiple
            accept={IMAGE_ACCEPT}
            className="sr-only"
            onChange={event => {
              onAddFiles(Array.from(event.target.files || []));
              event.target.value = '';
            }}
          />
        </div>
      </PostCreateField>
      <PostCreateCollectionFields />
    </PostCreateSection>
  );
}
