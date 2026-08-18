import type {
  ChangeEventHandler,
  DragEventHandler
} from 'react';
import { AddVideoIcon } from 'src/icons';

interface PostUploadDropzoneProps {
  accept: string;
  actionLabel: string;
  description: string;
  inputLabel: string;
  title: string;
  show4kBadge?: boolean;
  multiple?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  onDrop?: DragEventHandler<HTMLLabelElement>;
}

export default function PostUploadDropzone({
  accept,
  actionLabel,
  description,
  inputLabel,
  title,
  show4kBadge = false,
  multiple = false,
  onChange,
  onDrop
}: PostUploadDropzoneProps) {
  return (
    <label
      className="group flex h-97.25 w-full cursor-pointer items-center justify-center self-center rounded-lg bg-(--input-panel-bg) text-center transition-colors duration-200 hover:bg-(--surface-muted) focus-within:bg-(--surface-muted)"
      onDragOver={event => event.preventDefault()}
      onDrop={onDrop}
    >
      <div className="flex flex-col items-center justify-center gap-3.5">
        <img src="/upload_icon.svg" alt="" className="cursor-pointer" />
        <h2 className="m-0 text-lg font-semibold leading-5">{title}</h2>
        <p className="m-0 max-w-4xl text-xs leading-4 text-(--text-muted)">
          {description}
        </p>
        <span className="relative mt-5 h-10 w-78">
          <span className="inline-flex h-full w-full items-center justify-center rounded-sm border border-[#fe2c55] bg-[#fe2c55] px-3 py-1.5 text-sm font-semibold leading-5 text-white transition-colors hover:bg-[#e7274c]">
            <AddVideoIcon className="text-xl" />
            <span className="ml-2">{actionLabel}</span>
          </span>
          {show4kBadge ? (
            <img
              src="/4k_text.png"
              alt="Supports 4K uploads"
              className="absolute right-0 -top-3 h-[25.8px] w-[64.5px]"
            />
          ) : null}
        </span>
      </div>
      <input
        aria-label={inputLabel}
        accept={accept}
        type="file"
        multiple={multiple}
        className="sr-only"
        onChange={onChange}
      />
    </label>
  );
}
