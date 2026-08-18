'use client';

import { Carousel, CarouselNavigationButton } from '@components/ui/carousel';
import { IPost } from '@interfaces/post';
import { useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { CopyIcon } from 'src/icons';

import HomeFeedCoverImage from './home-feed-cover-image';
import { getPostImages } from './home-feed-media';

interface HomeFeedGraphicCarouselProps {
  post: IPost;
  alt: string;
}

export default function HomeFeedGraphicCarousel({
  post,
  alt
}: HomeFeedGraphicCarouselProps) {
  const images = getPostImages(post);
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <Carousel
      className="h-full w-full"
      resetKey={`${post._id}:${images.map(image => image.url).join('|')}`}
      slideClassName="h-full"
      onIndexChange={setActiveIndex}
      control={(
        <>
          <div className="pointer-events-none absolute left-2 top-2 z-20 inline-flex items-center gap-1 rounded bg-[rgba(0,0,0,.4)] px-1.5 py-1 text-[11px] font-semibold leading-none text-white shadow-sm backdrop-blur-sm transition-opacity group-hover/media:opacity-0">
            <CopyIcon className="text-[10px]" />
            <span>Text and images</span>
          </div>

          {images.length > 1 ? (
            <>
              <CarouselNavigationButton
                direction="previous"
                className="absolute left-2 top-1/2 z-30 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 text-xl text-white opacity-0 shadow-sm transition hover:bg-black/75 focus-visible:opacity-100 group-hover/media:opacity-100"
              >
                <FiChevronLeft />
              </CarouselNavigationButton>
              <CarouselNavigationButton
                direction="next"
                className="absolute right-2 top-1/2 z-30 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 text-xl text-white opacity-0 shadow-sm transition hover:bg-black/75 focus-visible:opacity-100 group-hover/media:opacity-100"
              >
                <FiChevronRight />
              </CarouselNavigationButton>
              <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white opacity-0 transition group-hover/media:opacity-100">
                {activeIndex + 1}/{images.length}
              </div>
            </>
          ) : null}
        </>
      )}
    >
      {images.map((image, index) => (
        <HomeFeedCoverImage
          key={image._id || image.url}
          src={image.url}
          alt={`${alt} - image ${index + 1}`}
          loading={index === 0 ? 'eager' : 'lazy'}
        />
      ))}
    </Carousel>
  );
}
