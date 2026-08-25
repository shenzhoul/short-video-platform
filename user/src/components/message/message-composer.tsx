'use client';

import { toast } from '@douyin-clone/shared-toast';
import {
  acceptAttributeFor,
  describeRejectedUpload,
  MESSAGE_PHOTO_UPLOAD_TYPE,
  MESSAGE_VIDEO_UPLOAD_TYPE
} from '@lib/upload-policy';
import { useRef, useState } from 'react';
import { FiImage, FiX } from 'react-icons/fi';
import { RiSendPlane2Fill } from 'react-icons/ri';

interface MessageComposerProps {
  /**
   * Whether the server would accept a send right now.
   *
   * The single input: an unanswered request, a block and a restriction all
   * arrive as `false`, and the notice above the composer explains which. The
   * composer itself has no business knowing the difference.
   */
  canSend: boolean;
  sending: boolean;
  onSend: (input: { text: string; file?: File | null }) => Promise<boolean>;
}

/**
 * Accepted attachment types, from the two policies this composer can produce.
 *
 * A message carries either a picture or a clip, and the API has a separate
 * upload type for each — so the picker offers the union of what those two
 * policies allow. `image/*,video/*` used to stand in for it, which invited SVG
 * (a document, not a picture), TIFF (never decodable here) and every container
 * FFmpeg has heard of. A hint either way: `accept` is bypassed by choosing "All
 * files", and the server decides from the bytes regardless.
 */
const ACCEPTED_MEDIA = [
  acceptAttributeFor(MESSAGE_PHOTO_UPLOAD_TYPE),
  acceptAttributeFor(MESSAGE_VIDEO_UPLOAD_TYPE)
].filter(Boolean).join(',');

/**
 * Which upload type a picked attachment will become.
 *
 * Decided from the browser's `type` only because this is the *client's* guess at
 * which of two policies to warn against; the durable type is chosen by
 * `MessageThread` when it calls the API, and the file server reads that. Getting
 * this wrong costs a slightly wrong early message, never a wrong limit.
 */
const uploadTypeFor = (file: File): string => (
  file.type?.startsWith('video') ? MESSAGE_VIDEO_UPLOAD_TYPE : MESSAGE_PHOTO_UPLOAD_TYPE
);

/**
 * Message input, attachment picker and send control.
 *
 * One surface: the text area grows, the action group keeps its natural size,
 * and both sit on the same rounded background. The text area is `min-w-0` so it
 * can shrink past its intrinsic width instead of pushing the actions out of
 * that background, and the actions are `shrink-0` so they never compress.
 *
 * While the sender is waiting for a reply the controls are disabled in place
 * rather than swapped for a message. Replacing them produced a second, detached
 * box at the bottom of the panel that duplicated the notice already shown above
 * the composer; disabling keeps one composer, in one position, at all times.
 */
export default function MessageComposer({
  canSend,
  sending,
  onSend
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Any refusal disables the composer, not only an unanswered request: being
  // blocked or restricted also means `canSend` is false, and keying this on
  // `awaitingReplyFrom` left the input live for exactly those two cases.
  const blocked = !canSend;
  const hasContent = Boolean(text.trim() || file);
  const disabled = blocked || sending;

  const clearAttachment = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    if (!picked) return;

    // Refused here so an oversized clip never costs the transfer, and — more to
    // the point — so a rejected pick never replaces an attachment that was
    // already valid. The input is cleared either way so choosing the same file
    // again re-fires `change`.
    const rejection = await describeRejectedUpload(picked, uploadTypeFor(picked));
    if (rejection) {
      toast.error(rejection);
      event.target.value = '';
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  };

  const submit = async () => {
    if (!hasContent || disabled) return;

    const payload = { text, file };
    // Cleared optimistically so the input is immediately ready for the next
    // message. A failure keeps its own bubble in the thread, so nothing typed
    // is lost by clearing here.
    setText('');
    clearAttachment();
    await onSend(payload);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter is a newline — the convention every chat uses.
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void submit();
  };

  return (
    <div className="shrink-0 border-t border-(--border-faint) p-3 @min-[36rem]:px-8 @min-[36rem]:py-4">
      {file && previewUrl && !blocked ? (
        <div className="relative mb-2 inline-block">
          {file.type.startsWith('video') ? (
            <video src={previewUrl} className="h-16 w-16 rounded-lg object-cover" />
          ) : (
            <img src={previewUrl} alt="" className="h-16 w-16 rounded-lg object-cover" />
          )}
          <button
            type="button"
            onClick={clearAttachment}
            aria-label="Remove attachment"
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-(--bg-inverse) text-[11px] text-(--text-inverse)"
          >
            <FiX aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div
        data-testid="message-composer-surface"
        className={`flex items-end gap-2 rounded-xl bg-(--field-bg) px-2.5 py-1.5 ${
          blocked ? 'opacity-60' : ''
        }`}
      >
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={blocked}
          placeholder="Send a message"
          aria-label="Message"
          className="max-h-24 min-h-7 min-w-0 flex-1 resize-none bg-transparent py-1 text-[14px] leading-5 text-(--text-strong) outline-none placeholder:text-(--text-faint) disabled:cursor-not-allowed"
        />

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_MEDIA}
          onChange={handlePick}
          className="hidden"
        />
        <div data-testid="message-composer-actions" className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={blocked}
            aria-label="Attach photo or video"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[17px] text-(--text-muted) cursor-pointer transition hover:bg-(--hover-bg) hover:text-(--text-strong) disabled:cursor-not-allowed"
          >
            <FiImage aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!hasContent || disabled}
            aria-label="Send message"
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] transition ${
              hasContent && !disabled
                ? 'cursor-pointer bg-[#fe2c55] text-white hover:bg-[#e02950]'
                : 'cursor-not-allowed bg-(--btn-bg) text-(--text-faint)'
            }`}
          >
            <RiSendPlane2Fill aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
