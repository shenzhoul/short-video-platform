'use client';

import HoverRevealPanel from '@components/ui/hover-reveal-panel';
import { useEffect, useRef, useState } from 'react';

export default function CreatorProfileBio({ bio }: { bio?: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const normalizedBio = (bio || '').trim();

  useEffect(() => {
    const textElement = textRef.current;
    if (!textElement || !normalizedBio) {
      setIsOverflowing(false);
      return undefined;
    }

    const checkOverflow = () => {
      setIsOverflowing(textElement.scrollWidth > textElement.clientWidth + 1);
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
      className="pointer-events-auto mt-1 flex h-5 w-full max-w-[760px] items-center text-(--text-muted)"
      disabled={!isOverflowing}
      panel={(
        <div className="w-max max-w-[430px] rounded-[2px] bg-(--surface-raised) px-2 py-1.5 text-[12px] leading-5 text-(--text) shadow-xl">
          <p className="m-0 whitespace-pre-line">{normalizedBio}</p>
        </div>
      )}
      panelPositionClassName="left-[250px] top-6"
    >
      <div className="flex w-full min-w-0 max-w-full items-center">
        <span
          ref={textRef}
          className="block min-w-0 flex-1 truncate text-[12px] font-medium leading-5 text-(--text)"
        >
          {normalizedBio}
        </span>
        {isOverflowing ? (
          <span className="ml-2 shrink-0 cursor-default text-[12px] leading-5 text-(--text-faint) transition group-hover/hover-reveal:text-(--text-strong)">
            More
          </span>
        ) : null}
      </div>
    </HoverRevealPanel>
  );
}
