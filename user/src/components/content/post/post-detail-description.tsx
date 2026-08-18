'use client';

import { useLayoutEffect, useRef, useState } from 'react';

import PostTextContent from './post-text-content';

interface PostDetailDescriptionProps {
  text: string;
  onOpenDetails: () => void;
  className?: string;
}

export default function PostDetailDescription({
  text,
  onOpenDetails,
  className = ''
}: PostDetailDescriptionProps) {
  const containerRef = useRef<HTMLButtonElement>(null);
  const measurementRef = useRef<HTMLDivElement>(null);
  const measurementTextRef = useRef<HTMLSpanElement>(null);
  const measurementMoreRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [visibleText, setVisibleText] = useState(text);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measurement = measurementRef.current;
    const measurementText = measurementTextRef.current;
    const measurementMore = measurementMoreRef.current;
    if (!container || !measurement || !measurementText || !measurementMore) return undefined;

    let active = true;
    const maxHeight = 72;
    const withSingleEllipsis = (value: string) => `${value.trimEnd().replace(/[.…]+$/u, '')}…`;
    const fits = (value: string, showMore: boolean) => {
      measurementText.textContent = value;
      measurementMore.style.display = showMore ? 'inline' : 'none';
      return measurement.scrollHeight <= maxHeight + 1;
    };
    const measure = () => {
      if (!active) return;
      measurement.style.width = `${container.clientWidth}px`;

      if (fits(text, false)) {
        setVisibleText(text);
        setOverflowing(false);
        return;
      }

      let low = 0;
      let high = text.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(withSingleEllipsis(text.slice(0, middle)), true)) low = middle;
        else high = middle - 1;
      }

      setVisibleText(withSingleEllipsis(text.slice(0, low)));
      setOverflowing(true);
    };

    measure();
    void document.fonts?.ready.then(measure);
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);

    return () => {
      active = false;
      resizeObserver.disconnect();
    };
  }, [text]);

  return (
    <button
      ref={containerRef}
      type="button"
      onClick={onOpenDetails}
      className={`relative block w-full cursor-pointer text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${className}`}
      aria-label="Open post details"
    >
      <span className="block max-h-[72px] overflow-hidden">
        <PostTextContent
          text={visibleText}
          className="whitespace-pre-wrap text-[15px] font-medium leading-6 text-white/95"
          hashtagClassName="text-[#f5d90a]"
          hashtagsInteractive={false}
        />
        {overflowing ? (
          <span className="pointer-events-none ml-1 inline rounded bg-white/20 px-2 py-0.5 text-sm font-semibold text-white/90 backdrop-blur-sm">
            more
          </span>
        ) : null}
      </span>

      <span
        ref={measurementRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 -z-10 block whitespace-pre-wrap text-[15px] font-medium leading-6"
      >
        <span ref={measurementTextRef} />
        <span ref={measurementMoreRef} className="ml-1 rounded px-2 py-0.5 text-sm font-semibold">more</span>
      </span>
    </button>
  );
}
