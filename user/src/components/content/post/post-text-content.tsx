'use client';

import Link from 'next/link';
import { Fragment, useMemo } from 'react';

// Mirrors the server-side parser in api/src/common/utils/hashtag.util.ts so what renders as a link
// is exactly what gets indexed into Post.tags.
const HASHTAG_PATTERN = /#[\wÀ-ſЀ-ӿ一-鿿]+/g;

interface PostTextContentProps {
  text?: string;
  className?: string;
  hashtagClassName?: string;
  hashtagsInteractive?: boolean;
  /** Stops the click bubbling into a parent card that opens a detail modal. */
  stopPropagation?: boolean;
}

/**
 * Renders post text with hashtags as links into search, closing the
 * post -> hashtag -> search loop.
 */
export default function PostTextContent({
  text,
  className = '',
  hashtagClassName = 'text-[#7cb3ff] transition hover:underline',
  hashtagsInteractive = true,
  stopPropagation = true
}: PostTextContentProps) {
  const segments = useMemo(() => {
    if (!text) return [];

    const parts: Array<{ value: string; tag: string | null }> = [];
    let lastIndex = 0;

    for (const match of text.matchAll(HASHTAG_PATTERN)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        parts.push({ value: text.slice(lastIndex, index), tag: null });
      }
      parts.push({ value: match[0], tag: match[0].slice(1).toLowerCase() });
      lastIndex = index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ value: text.slice(lastIndex), tag: null });
    }
    return parts;
  }, [text]);

  if (!text) return null;

  return (
    <span className={className}>
      {segments.map((segment, index) => (segment.tag ? (
        hashtagsInteractive ? (
          <Link
            // Segments are positional, so the index is the only stable identity here.
            // eslint-disable-next-line react/no-array-index-key
            key={`${segment.tag}-${index}`}
            href={`/search?q=${encodeURIComponent(segment.value)}`}
            onClick={(event) => {
              if (stopPropagation) event.stopPropagation();
            }}
            className={hashtagClassName}
          >
            {segment.value}
          </Link>
        ) : (
          <span
            // eslint-disable-next-line react/no-array-index-key
            key={`${segment.tag}-${index}`}
            className={hashtagClassName}
          >
            {segment.value}
          </span>
        )
      ) : (
        // eslint-disable-next-line react/no-array-index-key
        <Fragment key={index}>{segment.value}</Fragment>
      )))}
    </span>
  );
}
