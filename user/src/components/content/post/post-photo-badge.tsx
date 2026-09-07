import { ImageIcon } from 'src/icons';

interface PostPhotoBadgeProps {
  /** How many images the post carries; only shown when there is more than one. */
  imageCount?: number;
  className?: string;
}

/**
 * Marks a tile in a creator grid as a photo post rather than a video.
 *
 * Placed top-**right** by its callers, because the two things that can sit in
 * the same corners are already spoken for: the pinned tag is top-left and the
 * like count runs along the bottom. All three can be on one tile at once.
 *
 * The count is shown only when there really is more than one image. A single
 * photo gets the plain photo mark -- a stack or a "1" would both suggest a
 * gallery that is not there.
 *
 * Contrast comes from the pill's own dark, blurred backing rather than from the
 * thumbnail, so it stays readable over a blown-out sky as well as a night shot,
 * and over the dimmed-and-blurred treatment the current tile gets.
 */
export default function PostPhotoBadge({ imageCount = 1, className = '' }: PostPhotoBadgeProps) {
  const multiple = imageCount > 1;
  const label = multiple ? `Photo post, ${imageCount} images` : 'Photo post';

  return (
    <span
      className={`pointer-events-none inline-flex h-5 max-lg:h-4 items-center gap-1 rounded bg-black/55 px-1.5 max-lg:px-1 text-[11px] max-lg:text-[9px] font-semibold leading-5 max-lg:leading-4 text-white shadow-sm backdrop-blur-sm ${className}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <ImageIcon className="text-[13px]" />
      {multiple ? <span aria-hidden>{imageCount}</span> : null}
    </span>
  );
}
