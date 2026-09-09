'use client';

import Carousel, {
  CarouselNavigationButton,
  CarouselTimelineControl
} from '@components/ui/carousel';
import { IPost } from '@interfaces/post';
import { GRAPHIC_SLIDE_DURATION_MS } from '@lib/post-graphic';
import { useEffect, useState } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { PlayIcon } from 'src/icons';

import { getPostImages } from './home-feed-media';

interface PostGraphicStageMediaProps {
  post: IPost;
  /** Paused while the surface is off-screen or another layer owns the view. */
  active?: boolean;
}

/**
 * The media half of a full-bleed stage when the post is photos, not video.
 *
 * Why this exists: the For You surface drew *every* post with `PostVideoStage`,
 * which renders a `<video>` whose `src` comes from `getPostVideo(post)`. A photo
 * post has no video file, so that resolved to `''` — React refuses to set an
 * empty `src`, logs "An empty string was passed to the src attribute", and the
 * viewer is left looking at a black rectangle with playback controls over a post
 * whose images are never drawn at all. One in ten seeded posts is a photo, and
 * the ranked feed put one first, so this was the first thing a visitor saw.
 *
 * A `<video>` element is never rendered from here. Nothing is "fixed" by
 * passing `src={url || ''}`: an element that cannot play is the defect, not the
 * warning about it.
 */
export default function PostGraphicStageMedia({ post, active = true }: PostGraphicStageMediaProps) {
  const images = getPostImages(post);
  const [playing, setPlaying] = useState(true);

  // A new post starts its slideshow from the top rather than inheriting
  // whatever the previous one was doing.
  useEffect(() => setPlaying(true), [post._id]);

  if (!images.length) return null;

  const slideshowPlaying = images.length > 1 && playing && active;

  return (
    <div className="relative h-full w-full">
      <Carousel
        resetKey={post._id}
        className="h-full w-full"
        interval={GRAPHIC_SLIDE_DURATION_MS}
        playing={slideshowPlaying}
        slideClassName="h-full"
        timelineAutoplay
        control={images.length > 1 ? (
          <>
            <CarouselNavigationButton
              direction="previous"
              className="absolute left-4 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/35 text-lg text-white/85 backdrop-blur-md transition hover:bg-black/55 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            >
              <FaChevronLeft />
            </CarouselNavigationButton>
            <CarouselNavigationButton
              direction="next"
              className="absolute right-4 top-1/2 z-30 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/35 text-lg text-white/85 backdrop-blur-md transition hover:bg-black/55 hover:text-white focus-visible:outline-2 focus-visible:outline-white"
            >
              <FaChevronRight />
            </CarouselNavigationButton>
            <CarouselTimelineControl className="pointer-events-none absolute inset-x-0 bottom-4 z-30 px-6" />
          </>
        ) : null}
      >
        {images.map((image, index) => (
          <div key={image._id || `${post._id}-${index}`} className="flex h-full w-full items-center justify-center p-6">
            <img
              src={image.url}
              alt={`${post.text || post.tagline || 'Photo post'} ${index + 1} of ${images.length}`}
              className="h-full w-full object-contain"
              draggable={false}
            />
          </div>
        ))}
      </Carousel>

      {images.length > 1 ? (
        <button
          type="button"
          onClick={() => setPlaying((current) => !current)}
          data-swipe-passthrough
          className="absolute inset-0 z-20 cursor-pointer bg-transparent"
          aria-label={slideshowPlaying ? 'Pause image slideshow' : 'Play image slideshow'}
        >
          {!slideshowPlaying ? (
            <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-18 w-18 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white shadow-lg backdrop-blur-sm">
              <PlayIcon className="text-7xl" />
            </span>
          ) : null}
        </button>
      ) : null}
    </div>
  );
}
