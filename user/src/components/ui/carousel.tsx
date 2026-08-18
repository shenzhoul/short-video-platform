'use client';

import 'slick-carousel/slick/slick.css';
import 'slick-carousel/slick/slick-theme.css';

import {
  Children,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState
} from 'react';
import Slider from 'react-slick';

import styles from './carousel.module.css';

export interface CarouselControlState {
  activeIndex: number;
  count: number;
  interval: number;
  playing: boolean;
  previous: () => void;
  next: () => void;
  goTo: (index: number) => void;
}

interface CarouselProps {
  children: ReactNode;
  className?: string;
  interval?: number;
  playing?: boolean;
  resetKey?: string;
  slideClassName?: string;
  timelineAutoplay?: boolean;
  control?: ReactNode;
  onIndexChange?: (index: number) => void;
}

interface CarouselProgressControlProps {
  className?: string;
}

interface CarouselTimelineControlProps {
  className?: string;
}

interface CarouselNavigationButtonProps {
  children: ReactNode;
  className?: string;
  direction: 'previous' | 'next';
}

const CarouselContext = createContext<CarouselControlState | null>(null);

export function CarouselNavigationButton({
  children,
  className = '',
  direction
}: CarouselNavigationButtonProps) {
  const carousel = useContext(CarouselContext);
  if (!carousel) throw new Error('CarouselNavigationButton must be rendered inside Carousel.');
  if (carousel.count <= 1) return null;

  return (
    <button
      type="button"
      aria-label={`${direction === 'previous' ? 'Show previous' : 'Show next'} image`}
      className={className}
      onClick={event => {
        event.stopPropagation();
        carousel[direction]();
      }}
    >
      {children}
    </button>
  );
}

export function CarouselProgressControl({
  className = ''
}: CarouselProgressControlProps) {
  const carousel = useContext(CarouselContext);
  if (!carousel) throw new Error('CarouselProgressControl must be rendered inside Carousel.');
  const { activeIndex, count, next } = carousel;
  if (count <= 1) return null;
  const segments = Array.from({ length: count }, (_, segmentIndex) => segmentIndex + 1);

  return (
    <button
      type="button"
      aria-label={`Show next image. Image ${activeIndex + 1} of ${count} is active.`}
      className={`group absolute inset-x-0 px-2 flex h-2.5 w-full items-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white ${className}`}
      onClick={event => {
        event.stopPropagation();
        next();
      }}
    >
      <span className="flex h-[2px] w-full gap-[3px]">
        {segments.map(segmentNumber => (
          <span
            key={segmentNumber}
            className={`h-full min-w-0 flex-1 transition-colors duration-300 motion-reduce:transition-none ${segmentNumber - 1 === activeIndex ? 'bg-white' : 'bg-white/30'}`}
          />
        ))}
      </span>
    </button>
  );
}

export function CarouselTimelineControl({
  className = ''
}: CarouselTimelineControlProps) {
  const carousel = useContext(CarouselContext);
  if (!carousel) throw new Error('CarouselTimelineControl must be rendered inside Carousel.');
  const { activeIndex, count, interval, next, playing } = carousel;
  const segments = Array.from({ length: count }, (_, segmentIndex) => segmentIndex + 1);
  const fillRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const elapsedRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const previousTimestampRef = useRef<number | null>(null);

  useEffect(() => {
    elapsedRef.current = 0;
    previousTimestampRef.current = null;
    fillRefs.current.forEach((element, index) => {
      if (element) element.style.transform = `scaleX(${index < activeIndex ? 1 : 0})`;
    });
  }, [activeIndex, count]);

  useEffect(() => {
    if (!playing || count <= 1) {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      previousTimestampRef.current = null;
      return undefined;
    }

    const tick = (timestamp: number) => {
      if (previousTimestampRef.current === null) previousTimestampRef.current = timestamp;
      const delta = timestamp - previousTimestampRef.current;
      previousTimestampRef.current = timestamp;
      elapsedRef.current = Math.min(elapsedRef.current + delta, interval);
      const progress = elapsedRef.current / interval;
      const activeFill = fillRefs.current[activeIndex];
      if (activeFill) activeFill.style.transform = `scaleX(${progress})`;

      if (progress >= 1) {
        frameRef.current = null;
        previousTimestampRef.current = null;
        next();
        return;
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      previousTimestampRef.current = null;
    };
  }, [activeIndex, count, interval, next, playing]);

  if (count <= 1) return null;

  return (
    <div
      role="progressbar"
      aria-label={`Image ${activeIndex + 1} of ${count}`}
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={activeIndex + 1}
      className={`flex h-1 w-full gap-1 ${className}`}
    >
      {segments.map(segmentNumber => {
        const index = segmentNumber - 1;
        return (
          <span key={segmentNumber} className="relative h-full min-w-0 flex-1 overflow-hidden bg-white/28">
            <span
              ref={element => {
                fillRefs.current[index] = element;
              }}
              className="absolute inset-y-0 left-0 w-full origin-left bg-white will-change-transform"
              style={{ transform: `scaleX(${index < activeIndex ? 1 : 0})` }}
            />
          </span>
        );
      })}
    </div>
  );
}

export function Carousel({
  children,
  className = '',
  interval = 3000,
  playing = false,
  resetKey = '',
  slideClassName = '',
  timelineAutoplay = false,
  control,
  onIndexChange
}: CarouselProps) {
  const sliderRef = useRef<Slider>(null);
  const restartFrameRef = useRef<number | null>(null);
  const slides = useMemo(() => Children.toArray(children), [children]);
  const count = slides.length;
  const [activeIndex, setActiveIndex] = useState(0);
  const notifyIndexChange = useEffectEvent((index: number) => onIndexChange?.(index));

  const restartAutoplay = useCallback(() => {
    if (!playing || count <= 1 || timelineAutoplay) return;
    sliderRef.current?.slickPause();
    if (restartFrameRef.current !== null) window.cancelAnimationFrame(restartFrameRef.current);
    restartFrameRef.current = window.requestAnimationFrame(() => {
      sliderRef.current?.slickPlay();
      restartFrameRef.current = null;
    });
  }, [count, playing, timelineAutoplay]);

  const next = useCallback(() => {
    sliderRef.current?.slickNext();
    restartAutoplay();
  }, [restartAutoplay]);

  const previous = useCallback(() => {
    sliderRef.current?.slickPrev();
    restartAutoplay();
  }, [restartAutoplay]);

  const goTo = useCallback((index: number) => {
    if (!count) return;
    sliderRef.current?.slickGoTo(Math.min(Math.max(index, 0), count - 1));
    restartAutoplay();
  }, [count, restartAutoplay]);

  useEffect(() => {
    setActiveIndex(0);
    sliderRef.current?.slickGoTo(0, true);
  }, [count, resetKey]);

  useEffect(() => {
    if (playing && count > 1 && !timelineAutoplay) sliderRef.current?.slickPlay();
    else sliderRef.current?.slickPause();
  }, [count, playing, timelineAutoplay]);

  useEffect(() => () => {
    if (restartFrameRef.current !== null) window.cancelAnimationFrame(restartFrameRef.current);
  }, []);

  useEffect(() => {
    notifyIndexChange(activeIndex);
    // Effect Events intentionally stay outside dependency arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  if (!count) return null;

  const controlState: CarouselControlState = {
    activeIndex,
    count,
    interval: Math.max(interval, 600),
    playing,
    previous,
    next,
    goTo
  };
  const settings = {
    arrows: false,
    dots: false,
    infinite: count > 1,
    speed: 500,
    slidesToShow: 1,
    slidesToScroll: 1,
    autoplay: playing && count > 1 && !timelineAutoplay,
    autoplaySpeed: Math.max(interval, 600),
    pauseOnHover: false,
    pauseOnFocus: false,
    swipeToSlide: true,
    touchThreshold: 10,
    cssEase: 'ease-in-out',
    adaptiveHeight: false,
    beforeChange: (_currentIndex: number, nextIndex: number) => setActiveIndex(nextIndex)
  };

  return (
    <CarouselContext.Provider value={controlState}>
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label="Image carousel"
        className={`${styles.carousel} relative overflow-hidden ${className}`}
      >
        <Slider key={resetKey} ref={sliderRef} {...settings}>
          {Children.map(slides, slide => (
            <div className={`h-full outline-none ${slideClassName}`}>
              {slide}
            </div>
          ))}
        </Slider>
        {control}
      </div>
    </CarouselContext.Provider>
  );
}

export default Carousel;
