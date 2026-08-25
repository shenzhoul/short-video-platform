'use client';

import Modal from '@components/ui/modal';
import type { PendingCommentImage } from '@hooks/use-comment-image';
import { FiX } from 'react-icons/fi';

interface CommentImagePreviewProps {
  image: PendingCommentImage;
  /** Drops the image and keeps the text. */
  onRemove: () => void;
}

/**
 * The image the composer is holding, with the control that lets it go.
 *
 * Sized and placed against the reference design: a 60px thumbnail with a small
 * dismiss control tucked into its corner, rather than a large badge overlapping
 * it. The control is revealed by hover *or* keyboard focus — hover alone would
 * be a control some people cannot reach — and carries a real label.
 */
export function CommentImagePreview({ image, onRemove }: CommentImagePreviewProps) {
  return (
    <div className="pb-2" data-testid="comment-image-preview">
      <div className="group/preview relative h-15 w-15">
        <img
          src={image.previewUrl}
          alt={image.name || 'Selected image'}
          // Cropped to fill, as the reference does: a thumbnail this small reads
          // better filled than letterboxed, and the full picture is still what
          // gets posted.
          className="h-full w-full rounded-md object-cover"
        />

        {image.uploading ? (
          <span
            className="absolute inset-0 flex items-center justify-center rounded-md bg-black/45 text-[10px] font-medium text-white"
            data-testid="comment-image-uploading"
          >
            Uploading…
          </span>
        ) : null}

        {image.error ? (
          <span
            className="absolute inset-0 flex items-center justify-center rounded-md bg-black/60 px-0.5 text-center text-[9px] leading-3 font-medium text-white"
            data-testid="comment-image-error"
          >
            {image.error}
          </span>
        ) : null}

        {/*
          A small control sitting on the corner of the thumbnail, not a badge
          hanging off it. The visible circle is 16px; the `before` pseudo-element
          widens the hit area to 24px without taking any more of the picture.

          `opacity` rather than conditional rendering: the button stays in the
          layout at all times, so revealing it cannot nudge the thumbnail.
        */}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove image"
          data-testid="comment-image-remove"
          className="
            absolute right-0.5 top-0.5 flex h-4 w-4 cursor-pointer items-center justify-center
            rounded-full bg-black/60 text-white transition-opacity
            before:absolute before:-inset-1 before:content-['']
            opacity-0 group-hover/preview:opacity-100 group-focus-within/preview:opacity-100
            focus-visible:opacity-100 hover:bg-black/80
            focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-white
          "
        >
          <FiX size={10} />
        </button>
      </div>
    </div>
  );
}

interface ReplaceImageDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** True while the replacement is being prepared, so it cannot be double-run. */
  busy?: boolean;
}

/**
 * Confirmation before a second image displaces the first.
 *
 * A comment carries one image, so choosing another is a destructive act on
 * something the author already picked. Asking costs one click; silently throwing
 * their first choice away costs them the choice.
 *
 * Uses the shared Modal — never `window.confirm` — so it is themed, focus-trapped
 * and dismissible the same way every other dialog in the product is. Escape and
 * a click outside both mean Cancel, which is the safe direction: they keep what
 * is already attached.
 */
export function ReplaceImageDialog({
  open, onCancel, onConfirm, busy = false
}: ReplaceImageDialogProps) {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      onOk={onConfirm}
      centered
      width={420}
      title="Replace the current image?"
      footer={(
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-(--text-soft) transition hover:bg-(--hover-bg)"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            // Guarded rather than merely styled: a second confirm while the
            // first is still preparing would discard the old image twice.
            disabled={busy}
            data-testid="comment-image-replace-confirm"
            className="cursor-pointer rounded-lg bg-[#fe2c55] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#e9274d] disabled:cursor-wait disabled:opacity-60"
          >
            Replace
          </button>
        </div>
      )}
    >
      <p className="text-sm leading-5 text-(--text-soft)">
        The newly selected image will replace the image already attached to this comment.
      </p>
    </Modal>
  );
}
