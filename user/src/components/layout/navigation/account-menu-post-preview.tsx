'use client';

import { getPostMedia } from '@components/content/post/home-feed-media';
import { IPost } from '@interfaces/post';
import { memo, ReactNode, useState } from 'react';
import { PostIcon } from 'src/icons';

/**
 * `getPostMedia`'s last resort. That file is not in `public/`, so it is treated
 * as "no media" here and drawn as a neutral tile instead of a broken image.
 */
const MISSING_MEDIA_PLACEHOLDER = '/no-image.png';

/** Which way a section enters: from above for the first row, from below for the last. */
export type AccountMenuPreviewEnterFrom = 'above' | 'below';

interface AccountMenuPostPreviewProps {
  id: string;
  /** Accessible name of the region, e.g. the collection label. */
  label: string;
  /** Which collection this is, for styling and tests. */
  section: 'liked' | 'works';
  enterFrom: AccountMenuPreviewEnterFrom;
  posts: IPost[];
  /** True only while there is nothing loaded to show yet. */
  loading: boolean;
  error: boolean;
  emptyMessage: string;
  onRetry: () => void;
  onOpenPost: (post: IPost) => void;
}

/**
 * The cover for a vertical tile.
 *
 * The 3:4 cover is the natural fit; otherwise the same chain every feed card
 * uses (chosen cover, generated thumbnail, first photo). Never a video source:
 * a menu has no business decoding video, so a video with no poster gets the
 * neutral tile.
 */
function resolvePreviewCover(post: IPost): string | null {
  const media = post.cover3x4Url || getPostMedia(post);
  if (!media || media === MISSING_MEDIA_PLACEHOLDER) return null;
  const isVideoSource = Array.isArray(post.files) && post.files.some(
    (file: any) => file?.url === media && file?.type?.includes?.('video')
  );
  return isVideoSource ? null : media;
}

function resolvePreviewCaption(post: IPost) {
  return (post.title || post.text || post.tagline || '').trim();
}

const TILE_FRAME = 'relative block aspect-[3/4] w-full overflow-hidden rounded-md max-lg:rounded bg-(--surface-hover)';
const TILE_CAPTION = 'block h-4 max-lg:h-3 truncate text-xs max-lg:text-[8px] leading-4 max-lg:leading-3 text-(--text-soft)';

const PreviewTile = memo(function PreviewTile({ post, onOpenPost }: {
  post: IPost;
  onOpenPost: (post: IPost) => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const cover = coverFailed ? null : resolvePreviewCover(post);
  const caption = resolvePreviewCaption(post);

  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onOpenPost(post)}
        aria-label={caption ? `Open post: ${caption}` : 'Open post'}
        className="group/tile flex w-full min-w-0 cursor-pointer flex-col gap-1 max-lg:gap-0.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--text-muted)"
      >
        <span className={TILE_FRAME}>
          {cover ? (
            /*
              The scale happens inside a clipped frame, so the tile's box never
              changes size and its neighbours do not move.
            */
            <img
              src={cover}
              alt=""
              draggable={false}
              decoding="async"
              onError={() => setCoverFailed(true)}
              className="h-full w-full object-cover transition-transform duration-[160ms] ease-out group-hover/tile:scale-[1.04] group-focus-visible/tile:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover/tile:scale-100"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-(--text-faint)">
              <PostIcon className="text-2xl max-lg:text-sm" />
            </span>
          )}
        </span>
        <span className={TILE_CAPTION}>{caption || ' '}</span>
      </button>
    </li>
  );
});

function SkeletonTile() {
  return (
    <li className="flex min-w-0 flex-col gap-1 max-lg:gap-0.5" aria-hidden>
      <span className={`${TILE_FRAME} animate-pulse motion-reduce:animate-none`} />
      <span className="block h-4 max-lg:h-3 py-1 max-lg:py-0.5">
        <span className="block h-full w-3/4 rounded-sm bg-(--surface-hover)" />
      </span>
    </li>
  );
}

/**
 * Empty and error messages, drawn over space the height of one row of tiles.
 * Three tiles loading and then collapsing into a one-line message would jump the
 * rows below under the pointer; a single box of the same height does not.
 */
function PreviewNotice({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div className="grid grid-cols-3 gap-2 max-lg:gap-1 invisible" aria-hidden>
        <span className="flex flex-col gap-1 max-lg:gap-0.5">
          <span className="block aspect-[3/4]" />
          <span className="block h-4 max-lg:h-3" />
        </span>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 max-lg:gap-1 rounded-md bg-(--surface-hover) px-3 text-center text-xs max-lg:text-[9px] text-(--text-soft)">
        {children}
      </div>
    </div>
  );
}

/**
 * Up to three posts under an account menu row. Presentational only: the posts,
 * the loading and error state and every callback come from the caller, which
 * owns the data through the same hooks the profile page uses.
 *
 * Mounted only while its row is the active one, and keyed by the row, so each
 * appearance is a new element with a new animation: the strip drops in from
 * above for "I like it" (and is uncovered downward, in step with the rows below
 * gliding down) and rises from below for "My work".
 */
function AccountMenuPostPreview({
  id,
  label,
  section,
  enterFrom,
  posts,
  loading,
  error,
  emptyMessage,
  onRetry,
  onOpenPost
}: AccountMenuPostPreviewProps) {
  let body: ReactNode;
  if (loading) {
    body = (
      <ul className="grid grid-cols-3 gap-2 max-lg:gap-1" aria-busy="true">
        <SkeletonTile />
        <SkeletonTile />
        <SkeletonTile />
      </ul>
    );
  } else if (error && !posts.length) {
    body = (
      <PreviewNotice>
        <span>Couldn&apos;t load these posts.</span>
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer rounded-md px-2 py-0.5 font-semibold text-(--text-strong) underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-(--text-muted)"
        >
          Try again
        </button>
      </PreviewNotice>
    );
  } else if (!posts.length) {
    body = <PreviewNotice>{emptyMessage}</PreviewNotice>;
  } else {
    body = (
      <ul className="grid grid-cols-3 gap-2 max-lg:gap-1">
        {posts.map((post) => (
          <PreviewTile key={post._id} post={post} onOpenPost={onOpenPost} />
        ))}
      </ul>
    );
  }

  return (
    <div
      id={id}
      role="region"
      aria-label={label}
      data-account-menu-section={section}
      className={`px-3 pb-3 max-lg:px-1.5 max-lg:pb-1.5 ${enterFrom === 'above' ? 'account-menu-reveal' : ''}`}
    >
      <div
        data-account-menu-strip={section}
        className={`account-menu-strip account-menu-strip--from-${enterFrom}`}
      >
        {body}
      </div>
    </div>
  );
}

export default memo(AccountMenuPostPreview);
