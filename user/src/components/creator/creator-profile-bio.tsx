'use client';

import HoverRevealPanel from '@components/ui/hover-reveal-panel';
import { useEffect, useRef, useState } from 'react';

export default function CreatorProfileBio({ bio, className = '' }: { bio?: string; className?: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const normalizedBio = (bio || '').trim();

  useEffect(() => {
    const textElement = textRef.current;
    if (!textElement || !normalizedBio) {
      setIsOverflowing(false);
      return undefined;
    }

    // One line on desktop overflows sideways; two clamped lines on a compact
    // viewport overflow downwards. Either means there is more to reveal.
    const checkOverflow = () => {
      setIsOverflowing(
        textElement.scrollWidth > textElement.clientWidth + 1
        || textElement.scrollHeight > textElement.clientHeight + 1
      );
    };

    checkOverflow();

    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(textElement);
    if (textElement.parentElement) {
      resizeObserver.observe(textElement.parentElement);
    }

    return () => resizeObserver.disconnect();
  }, [normalizedBio]);

  if (!normalizedBio) return null;

  return (
    <HoverRevealPanel
      className={`pointer-events-auto mt-1 max-lg:mt-0 flex h-5 max-lg:h-auto w-full max-w-[760px] items-center text-(--text-muted) ${className}`}
      disabled={!isOverflowing}
      panel={(
        <div className="w-max max-w-[430px] max-lg:max-w-[calc(100vw-var(--app-shell-nav-width)-5rem)] rounded-[2px] bg-(--surface-raised) px-2 py-1.5 text-[12px] max-lg:text-[10px] leading-5 max-lg:leading-4 text-(--text) shadow-xl">
          <p className="m-0 whitespace-pre-line">{normalizedBio}</p>
        </div>
      )}
      /*
        Compact: anchored under the bio itself and capped to the viewport. At
        `left-[250px]` with up to 430px of width, the panel — hidden, but still
        laid out — ran ~300px past the right edge of a 440px viewport, and the
        profile's scroll container could be dragged sideways into the gap.
      */
      panelPositionClassName="left-[250px] top-6 max-lg:left-0 max-lg:top-full max-lg:pt-1"
    >
      <div className="flex w-full min-w-0 max-w-full items-center">
        <span
          ref={textRef}
          // One line at every width, as in the reference's collapsed state;
          // "More" appears beside it when the text is cut.
          className="block min-w-0 flex-1 truncate text-[12px] max-lg:text-[9px] font-medium leading-5 max-lg:leading-3.5 text-(--text)"
        >
          {normalizedBio}
        </span>
        {isOverflowing ? (
          <span className="ml-2 max-lg:ml-1 shrink-0 cursor-default text-[12px] max-lg:text-[9px] leading-5 max-lg:leading-3.5 text-(--text-faint) transition group-hover/hover-reveal:text-(--text-strong)">
            More
          </span>
        ) : null}
      </div>
    </HoverRevealPanel>
  );
}
