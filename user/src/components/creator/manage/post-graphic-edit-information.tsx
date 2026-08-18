'use client';

import Dropdown from '@components/ui/dropdown-menu';
import type { GraphicFileItem } from '@hooks/use-post-graphic-create';
import type { IUser } from '@interfaces/user';
import type { RefObject } from 'react';
import { FiCheck, FiEdit2 } from 'react-icons/fi';

import {
  PostCreateCollectionFields,
  PostCreateDescriptionEditor,
  PostCreateIncentiveActivityField
} from '../../post/post-create-basic-information';
import {
  postCreateDropdownMenuClassName,
  PostCreateField,
  PostCreateSection
} from '../../post/post-create-layout';

interface PostGraphicEditInformationProps {
  title: string;
  description: string;
  descriptionEditorRef: RefObject<HTMLDivElement | null>;
  items: GraphicFileItem[];
  selectedCoverId: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onMentionsChange: (users: IUser[]) => void;
  onCoverSelect: (id: string) => void;
}

export default function PostGraphicEditInformation({
  title,
  description,
  descriptionEditorRef,
  items,
  selectedCoverId,
  onTitleChange,
  onDescriptionChange,
  onMentionsChange,
  onCoverSelect
}: PostGraphicEditInformationProps) {
  const selectedCover = items.find(item => item.id === selectedCoverId) || items[0];

  return (
    <PostCreateSection title="Basic information">
      <PostCreateDescriptionEditor
        title={title}
        description={description}
        descriptionEditorRef={descriptionEditorRef}
        mediaLabel="graphics"
        titleMaxLength={20}
        onTitleChange={onTitleChange}
        onDescriptionChange={onDescriptionChange}
        onMentionsChange={onMentionsChange}
      />
      <PostCreateIncentiveActivityField />
      <PostCreateField className="mt-6" label="Cover Settings">
        <Dropdown
          triggerMode="click"
          position="left"
          width={300}
          menuClassName={postCreateDropdownMenuClassName}
          trigger={(
            <button type="button" className="flex h-16 w-full cursor-pointer items-center rounded-sm bg-(--action-card-bg) px-2 text-left transition hover:bg-(--action-card-hover-bg)">
              {selectedCover?.previewUrl ? (
                <img src={selectedCover.previewUrl} alt="Selected graphic cover" className="h-12 w-10 rounded-sm object-cover" />
              ) : <span className="h-12 w-10 rounded-sm bg-(--surface-hover)" />}
              <span className="ml-3 flex-1 text-sm font-semibold">Select an image as the cover</span>
              <span className="inline-flex items-center text-sm font-medium text-(--text-soft)">
                <FiEdit2 className="mr-2" /> Edit cover
              </span>
            </button>
          )}
        >
          <div className="grid grid-cols-4 gap-2 p-2">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Use image ${index + 1} as cover`}
                onClick={() => onCoverSelect(item.id)}
                className={`relative aspect-3/4 cursor-pointer overflow-hidden rounded-sm border-2 transition ${item.id === selectedCoverId ? 'border-[#fe2c55]' : 'border-transparent hover:border-[#fe2c55]/60'}`}
              >
                <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                {item.id === selectedCoverId ? (
                  <span className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-full bg-[#fe2c55] text-white">
                    <FiCheck className="text-[10px]" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </Dropdown>
        <p className="mt-1 text-xs text-(--text-muted)">Tip: A high-quality cover will greatly increase exposure.</p>
      </PostCreateField>
      <PostCreateCollectionFields showCollection={false} />
    </PostCreateSection>
  );
}
