'use client';

import { useState } from 'react';

interface HomeFeedCoverImageProps {
  src: string;
  alt: string;
  loading?: 'eager' | 'lazy';
  /**
   * A small pre-blurred placeholder to fill the letterbox behind media that does
   * not match the card's shape.
   *
   * Optional, and the fallback is the previous behaviour: a scaled-up copy of
   * `src` itself. That fallback is correct but expensive — compositing a second
   * full-resolution layer per card is what made a portrait-heavy feed janky —
   * so a caller that can supply the placeholder should.
   */
  backdropSrc?: string | null;
}

/**
 * `loading` defaults to `lazy` and decoding to `async`.
 *
 * Every card in a feed grid used to fetch and decode its cover the moment it
 * mounted, whether or not it was anywhere near the viewport — 212 images on a
 * 112-post feed, all eager. Windowing already keeps most of them unmounted;
 * this makes the ones inside the window that are still below the fold wait
 * their turn as well, and keeps decoding off the main thread.
 *
 * A caller that genuinely needs the image immediately — the featured card, an
 * above-the-fold hero — passes `loading="eager"`.
 */
export default function HomeFeedCoverImage({
  src,
  alt,
  loading = 'lazy',
  backdropSrc = null
}: HomeFeedCoverImageProps) {
  const [isPortrait, setIsPortrait] = useState(false);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {isPortrait ? (
        <img
          src={backdropSrc || src}
          alt=""
          aria-hidden
          // Always lazy, whatever the foreground does: the backdrop is
          // decoration and must never delay the image somebody came to see.
          loading="lazy"
          decoding="async"
          // A placeholder is already blurred and only needs softening; the
          // full-size fallback needs the whole 40px radius to read as a
          // backdrop rather than a duplicate of the picture in front of it.
          className={`pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-70 ${backdropSrc ? 'blur-md' : 'blur-2xl'}`}
        />
      ) : null}
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        onLoad={event => {
          const image = event.currentTarget;
          setIsPortrait(image.naturalHeight > image.naturalWidth);
        }}
        className={`relative z-10 h-full w-full transition duration-300 group-hover:scale-[1.025] ${isPortrait ? 'object-contain' : 'object-cover'}`}
      />
    </div>
  );
}
