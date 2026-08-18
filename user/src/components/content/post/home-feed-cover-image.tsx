'use client';

import { useState } from 'react';

interface HomeFeedCoverImageProps {
  src: string;
  alt: string;
  loading?: 'eager' | 'lazy';
}

export default function HomeFeedCoverImage({
  src,
  alt,
  loading
}: HomeFeedCoverImageProps) {
  const [isPortrait, setIsPortrait] = useState(false);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {isPortrait ? (
        <img
          src={src}
          alt=""
          aria-hidden
          loading={loading}
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl"
        />
      ) : null}
      <img
        src={src}
        alt={alt}
        loading={loading}
        onLoad={event => {
          const image = event.currentTarget;
          setIsPortrait(image.naturalHeight > image.naturalWidth);
        }}
        className={`relative z-10 h-full w-full transition duration-300 group-hover:scale-[1.025] ${isPortrait ? 'object-contain' : 'object-cover'}`}
      />
    </div>
  );
}
