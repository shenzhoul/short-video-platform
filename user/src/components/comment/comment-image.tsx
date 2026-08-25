'use client';

import { useState } from 'react';

interface CommentImageProps {
  image?: {
    id: string;
    url: string;
    width: number;
    height: number;
    mimeType: string;
  };
}

/** Widest the picture may draw inside the comments panel. */
const MAX_WIDTH = 220;
/** Tallest, so a very tall image cannot push the rest of the thread off screen. */
const MAX_HEIGHT = 280;

/**
 * The one image a comment may carry, drawn under its text.
 *
 * ## Why the size is computed rather than left to CSS
 *
 * The server reports the intrinsic dimensions, so the box can be reserved before
 * a single byte of the picture arrives. Without that the comment grows the
 * moment it loads and everything below it jumps — worst exactly where it is most
 * annoying, in a list somebody is reading.
 *
 * The aspect ratio is preserved by fitting inside the box rather than cropping:
 * a comment image is content, and cropping it would hide part of what somebody
 * chose to say.
 *
 * Dimensions can legitimately be missing on an older or unprocessed file. Then
 * the box is left to the image, which is the honest fallback — a guessed
 * placeholder that turns out wrong shifts the layout twice instead of once.
 */
export default function CommentImage({ image }: CommentImageProps) {
  const [failed, setFailed] = useState(false);

  // Nothing to draw, and a withdrawn file is deliberately silent rather than a
  // broken frame.
  if (!image?.url || failed) return null;

  const hasIntrinsicSize = image.width > 0 && image.height > 0;
  const scale = hasIntrinsicSize
    ? Math.min(1, MAX_WIDTH / image.width, MAX_HEIGHT / image.height)
    : 1;
  const width = hasIntrinsicSize ? Math.round(image.width * scale) : undefined;
  const height = hasIntrinsicSize ? Math.round(image.height * scale) : undefined;

  return (
    <div className="mt-2" data-testid={`comment-image-${image.id}`}>
      <img
        src={image.url}
        alt=""
        // Intrinsic dimensions on the element itself, so the browser reserves
        // the right box from the first layout pass.
        width={image.width || undefined}
        height={image.height || undefined}
        // Off screen until it is nearly needed: a long thread of comments must
        // not fetch every picture in it at once.
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={width && height ? { width, height } : undefined}
        className="max-w-full rounded-lg object-contain"
      />
    </div>
  );
}
