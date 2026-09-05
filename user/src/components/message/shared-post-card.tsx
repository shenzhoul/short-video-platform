'use client';

import type { ISharedPost } from '@interfaces/message';
import { resolveAvatarUrl } from '@lib/avatar';
import { FiImage, FiPlay, FiSlash } from 'react-icons/fi';

interface SharedPostCardProps {
  sharedPost: ISharedPost;
  /** Opens the post. Absent while the bubble is still pending. */
  onOpen?: (postId: string) => void;
}

/**
 * Portrait card, matching the shape a post already has in the feed. Fixed rather
 * than derived from the post's own dimensions: a conversation is a narrow
 * column, and letting a landscape video set the width would make one bubble
 * twice the size of every other.
 */
const CARD_WIDTH = 168;
const CARD_HEIGHT = 224;

/**
 * A post shared into a conversation.
 *
 * The card is built from what the server resolved *for this reader, now* — not
 * from anything stored when the post was shared. That is why `available` is a
 * state this component has to render properly rather than an edge case: a post
 * can be deleted, hidden, or its author blocked long after the message was sent,
 * and the bubble stays in history either way.
 *
 * Nothing here autoplays. A thread is not a feed, and a card that starts playing
 * as it scrolls past would fight whatever the person was actually watching.
 */
export default function SharedPostCard({ sharedPost, onOpen }: SharedPostCardProps) {
  const { available, thumbnailUrl, caption, author, isVideo, isMultiImage } = sharedPost;

  if (!available) {
    return (
      <div
        data-testid="shared-post-unavailable"
        style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
        className="flex flex-col items-center justify-center gap-2 rounded-xl bg-(--surface-muted) px-4 text-center"
      >
        <FiSlash aria-hidden="true" className="text-xl text-(--text-faint)" />
        <p className="text-[13px] leading-4 text-(--text-muted)">Post unavailable</p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen?.(sharedPost.postId)}
      disabled={!onOpen}
      aria-label={caption ? `Open post: ${caption}` : 'Open shared post'}
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      className="group relative overflow-hidden rounded-xl bg-(--surface-muted) text-left not-disabled:cursor-pointer"
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}

      {/* A wash under the caption, so text stays readable over a bright cover. */}
      <span className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" />

      {isVideo ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 pl-0.5 text-white">
            <FiPlay aria-hidden="true" />
          </span>
        </span>
      ) : null}

      {isMultiImage ? (
        <span
          aria-label="Multiple photos"
          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-md bg-black/45 text-[11px] text-white"
        >
          <FiImage aria-hidden="true" />
        </span>
      ) : null}

      <span className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-2">
        {caption ? (
          <span className="line-clamp-2 text-[12px] leading-4 text-white/90">{caption}</span>
        ) : null}
        {author ? (
          <span className="flex items-center gap-1.5">
            <img
              src={resolveAvatarUrl(author.avatar)}
              alt=""
              className="h-4 w-4 shrink-0 rounded-full object-cover"
            />
            <span className="truncate text-[11px] leading-4 text-white/80">
              {author.name || author.username}
            </span>
          </span>
        ) : null}
      </span>
    </button>
  );
}
