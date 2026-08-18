'use client';

import { Tooltip } from '@components/ui/tooltip';
import type { PostCoverRatio } from '@hooks/use-post-create';
import { usePostVideoUpload } from '@hooks/use-post-video-upload';
import { useState } from 'react';
import { MusicIcon, QuestionOutlinedIcon } from 'src/icons';

import PostCreatePhoneCoverPreview from './post-create-phone-cover-preview';
import PostCreatePhonePreview from './post-create-phone-preview';
import PostCreateSendAssistant from './post-create-send-assistant';
import PostCreateUploadProgress from './post-create-upload-progress';

type PreviewTab = 'preview' | 'cover';

interface PostCreatePreviewPanelProps {
  caption: string;
  cover4x3Url?: string;
  cover3x4Url?: string;
  coverDisplayRatio: PostCoverRatio;
  hasSelectedCover: boolean;
  initialPreviewUrl?: string;
  initialUploadFile?: File | null;
  onUploadStart: (fileName: string) => void;
  onUploadPrepared: (fileId: string, fileName: string) => void;
  onUploadComplete: (fileId: string) => void;
  onUploadInterrupted: (state: 'interrupted' | 'failed') => void;
  onUploadStateChange: (isUploading: boolean) => void;
  onPreviewUrlChange?: (previewUrl: string) => void;
  onCoverDisplayRatioChange: (ratio: PostCoverRatio) => void;
  /**
   * Show the existing media without offering to replace it.
   *
   * Used by the edit composer: the video of a published post is fixed, so the re-upload control is
   * removed rather than left to fail. Defaults to `false`, leaving the publish flow unchanged.
   */
  readOnlyMedia?: boolean;
}

export default function PostCreatePreviewPanel({
  caption,
  cover4x3Url = '',
  cover3x4Url = '',
  coverDisplayRatio,
  hasSelectedCover,
  initialPreviewUrl = '',
  initialUploadFile = null,
  onUploadStart,
  onUploadPrepared,
  onUploadComplete,
  onUploadInterrupted,
  onUploadStateChange,
  onPreviewUrlChange,
  onCoverDisplayRatioChange,
  readOnlyMedia = false
}: PostCreatePreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<PreviewTab>('preview');
  const {
    upload,
    previewUrl,
    fileInputRef,
    handleFileChange,
    cancelUpload
  } = usePostVideoUpload({
    initialPreviewUrl,
    initialUploadFile,
    onUploadStart,
    onUploadPrepared,
    onUploadComplete,
    onUploadInterrupted,
    onUploadStateChange,
    onPreviewUrlChange
  });

  if (upload) {
    return (
      <aside className="w-[243px] shrink-0">
        <PostCreateUploadProgress upload={upload} onCancel={cancelUpload} />
      </aside>
    );
  }

  const tabClassName = (tab: PreviewTab) => (
    `flex h-8 cursor-pointer items-center justify-center whitespace-nowrap rounded-sm px-3 text-sm transition ${activeTab === tab
      ? 'text-[#fe2c55] hover:bg-(--surface-hover) font-bold'
      : 'text-(--text-muted) hover:bg-(--action-card-bg)'
    }`
  );

  return (
    <aside className="w-[243px] shrink-0">
      <div className="mb-3 flex h-8 w-[242px] justify-center">
        <button
          type="button"
          aria-pressed={activeTab === 'preview'}
          className={tabClassName('preview')}
          onClick={() => setActiveTab('preview')}
        >
          Preview
          <Tooltip
            title="The video has been uploaded at the original resolution. The preview may be compressed."
            className="bg-[#3b3b48] px-3 py-3 text-sm leading-[18px] text-white"
            width="w-[200px]"
            wrap
            placement='right'
          >
            <span className="ml-2 inline-flex items-center">
              <QuestionOutlinedIcon className="text-sm" />
            </span>
          </Tooltip>
        </button>
        <button
          type="button"
          aria-pressed={activeTab === 'cover'}
          className={tabClassName('cover')}
          onClick={() => setActiveTab('cover')}
        >
          Cover/Title
        </button>
      </div>

      {activeTab === 'preview' && <PostCreatePhonePreview previewUrl={previewUrl} caption={caption} />}

      {activeTab === 'cover' && (
        <PostCreatePhoneCoverPreview
          caption={caption}
          cover4x3Url={cover4x3Url}
          cover3x4Url={cover3x4Url}
          ratio={coverDisplayRatio}
          onRatioChange={onCoverDisplayRatioChange}
        />
      )}

      {readOnlyMedia ? null : (
        <>
          <div className="mt-[31px] flex w-[235px] flex-1 overflow-hidden rounded-xl">
            <button
              type="button"
              className="group flex-1 cursor-pointer text-center text-sm leading-[21px]"
            >
              <span className="flex h-9 w-full items-center justify-center rounded-l-xl border-y border-l border-(--border-soft) bg-(--surface-raised) group-hover:bg-(--surface-hover)">
                <MusicIcon className="text-[25px] text-(--text-muted) group-hover:text-[#fe2c55]" />
              </span>
              <span className="group-hover:text-[#fe2c55]">Add music</span>
            </button>
            <div className="group flex-1 text-center text-sm leading-[21px]">
              <input
                className="hidden"
                ref={fileInputRef}
                type="file"
                accept="video/*,.hevc,.mov"
                onChange={handleFileChange}
              />
              <button
                type="button"
                aria-label="Re-upload video"
                className="flex h-9 w-full cursor-pointer items-center justify-center rounded-r-xl border-y border-r border-(--border-soft) bg-(--surface-raised) group-hover:bg-(--surface-hover)"
                onClick={() => fileInputRef.current?.click()}
              >
                <span
                  aria-hidden
                  className="block h-6 w-6 bg-(--text-muted) group-hover:bg-[#fe2c55] [mask:url('/upload_icon.svg')_center/contain_no-repeat] [-webkit-mask:url('/upload_icon.svg')_center/contain_no-repeat]"
                />
              </button>
              <div className="group-hover:text-[#fe2c55]">Re-upload</div>
            </div>
          </div>
          <PostCreateSendAssistant hasSelectedCover={hasSelectedCover} />
        </>
      )}
    </aside>
  );
}
