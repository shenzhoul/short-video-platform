import type { PostVideoUploadState } from '@hooks/use-post-video-upload';
import { DouyinFavicon } from 'src/icons';

import PostCreateSendAssistant from './post-create-send-assistant';

const formatMegabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
const formatUploadSpeed = (bytesPerSecond: number) => (
  bytesPerSecond > 0 ? `${(bytesPerSecond / (1024 * 1024)).toFixed(1)}MB/s` : '--'
);

interface PostCreateUploadProgressProps {
  upload: PostVideoUploadState;
  onCancel: () => void;
}

export default function PostCreateUploadProgress({
  upload,
  onCancel
}: PostCreateUploadProgressProps) {
  return (
    <>
      <div className="flex h-[515px] w-[243px] flex-col items-center justify-center rounded-sm border border-(--border-soft) bg-(--surface-raised) px-5 text-center">
        <DouyinFavicon className="mb-5 text-[54px] text-(--text-muted)" />
        <div className="w-full truncate text-sm font-semibold text-(--text-strong)" title={upload.fileName}>
          {upload.fileName}
        </div>
        <p className="mt-1.5 text-xs font-semibold leading-5 text-[#fe2c55]">
          Please do not delete or move files during upload
        </p>
        <div className="mt-3 flex w-full items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-(--surface-soft)">
            <div
              className="h-full rounded-full bg-[#38b86a] transition-[width] duration-200"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
          <span className="text-xs text-(--text-muted)">{upload.progress}%</span>
        </div>
        <div className="mt-3 text-left text-xs leading-[18px] text-(--text-muted)">
          <div>Uploaded: {formatMegabytes(upload.loaded)}/{formatMegabytes(upload.fileSize)}</div>
          <div>Current speed: {formatUploadSpeed(upload.speed)}</div>
          <div>Remaining time: {upload.timeRemaining > 0 ? `${Math.ceil(upload.timeRemaining)}s` : '--'}</div>
        </div>
        <button
          type="button"
          className="mt-6 text-xs leading-4 text-(--text-muted) transition hover:text-[#fe2c55]"
          onClick={onCancel}
        >
          Cancel<br />upload
        </button>
      </div>
      <PostCreateSendAssistant />
    </>
  );
}
