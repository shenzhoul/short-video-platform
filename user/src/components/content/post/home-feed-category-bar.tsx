'use client';

import type { IPostTopic } from '@services/search.service';
import { useRef, useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

interface HomeFeedCategoryBarProps {
  /**
   * The active catalogue, owned by HomeFeed.
   *
   * Passed in rather than fetched here so one screen makes one request: HomeFeed already needs the
   * list to notice a selected category being retired, and two components calling the hook meant two
   * requests on every mount and every focus refresh.
   */
  topics: IPostTopic[];
  /** Selected topic key; empty string means "All of them". */
  activeTopicKey?: string;
  onTopicChange?: (topicKey: string) => void;
}

export default function HomeFeedCategoryBar({
  topics,
  activeTopicKey = '',
  onTopicChange
}: HomeFeedCategoryBarProps) {
  const categoryRef = useRef<HTMLDivElement>(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);
  // Sourced from the API so the labels shown always map to keys the server accepts.
  const categories = [{ key: '', label: 'All of them' }, ...topics];

  const updateButtons = () => {
    const element = categoryRef.current;
    if (!element) return;
    setCanScrollBack(element.scrollLeft > 2);
    setCanScrollNext(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
  };

  const scroll = (direction: 'back' | 'next') => {
    const element = categoryRef.current;
    if (!element) return;
    element.scrollBy({ left: direction === 'next' ? 260 : -260, behavior: 'smooth' });
    window.setTimeout(updateButtons, 320);
  };

  return (
    <div className="relative z-40 bg-(--header-bg) px-4 max-lg:px-2">
      <div className="flex h-12 max-lg:h-8 items-center gap-2 max-lg:gap-1">
        <div ref={categoryRef} onScroll={updateButtons} className="flex h-full min-w-0 flex-1 items-center gap-7 max-lg:gap-3.5 max-lg:text-[11px] category-scroller overflow-x-auto whitespace-nowrap text-base font-medium text-(--text-soft)">
          {categories.map((category) => {
            const isActive = category.key === activeTopicKey;
            return (
              <button
                key={category.key || 'all'}
                type="button"
                onClick={() => onTopicChange?.(category.key)}
                className={`relative h-full shrink-0 cursor-pointer transition hover:text-(--text-strong) ${isActive ? 'text-(--text-strong)' : ''}`}
              >
                {category.label}
                {isActive ? <span className="absolute bottom-1.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-[#ff2f5f]" /> : null}
              </button>
            );
          })}
        </div>
        <button type="button" disabled={!canScrollBack} onClick={() => scroll('back')} className="flex h-7 w-7 max-lg:h-5 max-lg:w-5 max-lg:text-[10px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-(--hover-bg) text-(--text-strong) transition disabled:cursor-default disabled:opacity-35" aria-label="Previous categories">
          <FiChevronLeft size={16} />
        </button>
        <button type="button" disabled={!canScrollNext} onClick={() => scroll('next')} className="flex h-7 w-7 max-lg:h-5 max-lg:w-5 max-lg:text-[10px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-(--hover-bg) text-(--text-strong) transition disabled:cursor-default disabled:opacity-35" aria-label="Next categories">
          <FiChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
