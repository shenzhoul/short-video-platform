'use client';

import {
  formatCompactCount,
  getPostDuration,
  getPostImages,
  getPostMedia,
  isGraphicPost
} from '@components/content/post/home-feed-media';
import PostPinnedBadge from '@components/content/post/post-pinned-badge';
import Dropdown from '@components/ui/dropdown-menu';
import { IPost } from '@interfaces/post';
import {
  getPostNotEditableReason,
  isPostEditable
} from '@lib/post-editable';
import Link from 'next/link';
import { FiTrash2 } from 'react-icons/fi';
import {
  ArrowRightIcon,
  CopyIcon,
  EditIcon,
  LockIcon,
  PinIcon,
  UnpinIcon
} from 'src/icons';

import {
  PLACEHOLDER_GRAPHIC_METRICS,
  PLACEHOLDER_VIDEO_METRICS
} from './creator-manage-placeholders';
import PostStatistics from './post-statistics';

interface CreatorPostRowProps {
  post: IPost;
  isDeleting?: boolean;
  isPinning?: boolean;
  onDelete: (post: IPost) => void;
  onTogglePinned: (post: IPost) => void;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

const actionClassName =
  'inline-flex items-center justify-center whitespace-nowrap text-xs text-(--text-muted)';

export default function CreatorPostRow({
  post,
  isDeleting = false,
  isPinning = false,
  onDelete,
  onTogglePinned
}: CreatorPostRowProps) {
  const cover = getPostMedia(post);
  const duration = getPostDuration(post);

  const isGraphic = isGraphicPost(post);
  const imageCount = isGraphic ? getPostImages(post).length : 0;

  const editable = isPostEditable(post);
  const notEditableReason = getPostNotEditableReason(post);

  // Use title first. Fall back to the post text only when title is empty.
  const heading =
    post.title?.trim() + '' + post.text?.trim() ||
    'Untitled';

  const publishedAt = post.createdAt
    ? dateFormatter.format(new Date(post.createdAt))
    : '';

  const isDeleted = post.status === 'deleted';

  const placeholderMetrics = isGraphic
    ? PLACEHOLDER_GRAPHIC_METRICS
    : PLACEHOLDER_VIDEO_METRICS;

  const metrics = [
    {
      label: 'Play',
      value: formatCompactCount(post.totalView)
    },
    {
      label: 'Like',
      value: formatCompactCount(post.totalLike)
    },
    {
      label: 'Comment',
      value: formatCompactCount(post.totalComment)
    },
    {
      label: 'Share',
      value: formatCompactCount(post.totalShare || 0)
    },
    ...placeholderMetrics.map(metric => ({
      ...metric,
      isPlaceholder: true
    }))
  ];

  return (
    <li
      className="group mx-2 flex min-h-48 cursor-pointer gap-4 rounded-md px-4 py-4 transition-colors duration-150 hover:bg-(--hover-bg)"
    >
      {/* Cover */}
      <div
        className="relative h-40 w-30 shrink-0 overflow-hidden rounded-sm bg-(--surface-muted)"
      >
        <img
          src={cover}
          alt={`${heading} cover`}
          className="h-full w-full object-cover"
        />

        {isGraphic ? (
          <span
            aria-label="Graphic post"
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-sm text-white"
          >
            <CopyIcon className="text-[12px]" />
          </span>
        ) : null}

        {post.isPinned ? (
          <PostPinnedBadge className="absolute left-1.5 top-1.5 z-10" />
        ) : null}

        {duration ? (
          <span
            className="absolute bottom-1 right-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white"
          >
            {duration}
          </span>
        ) : null}

        {imageCount > 0 && (
          <span
            className="absolute bottom-1 right-1 flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white"
          >
            {imageCount} {imageCount > 1 ? 'images' : 'image'}
          </span>
        )}
      </div>

      {/* Content */}
      <div
        className="relative flex min-h-40 min-w-0 flex-1 flex-col overflow-hidden pl-4"
      >
        {/* Heading + actions */}
        <div className="mb-1 flex min-w-0 items-start">
          <div
            title={heading}
            className="min-w-0 flex-1 truncate text-[15px] leading-5 text-(--text-strong)"
            style={{ fontFamily: 'PingFang SC' }}
          >
            {heading}
          </div>

          <div className="ml-4 flex shrink-0 items-center whitespace-nowrap">
            {editable ? (
              <Dropdown
                position="right"
                width={120}
                triggerMode="hover"
                menuClassName="!mt-1 !rounded-sm !border-(--border-soft) !bg-(--surface-raised) !p-1"
                trigger={(
                  <div className={`${actionClassName} cursor-pointer`}>
                    <EditIcon className="text-xl" />

                    <span className="pl-[2.5px]">
                      Edited works
                    </span>

                    <ArrowRightIcon className="text-xl rotate-90" />
                  </div>
                )}
              >
                <Link
                  href={`/creator/posts/${post._id}/edit`}
                  className="flex h-8 items-center rounded-sm px-3 text-[13px] text-(--text-strong) hover:bg-(--hover-bg)"
                >
                  Edited works
                </Link>

                <button
                  type="button"
                  disabled
                  title="Chapters are not available yet"
                  className="flex h-8 w-full cursor-not-allowed items-center rounded-sm px-3 text-left text-[13px] text-(--text-faint)"
                >
                  Add chapters
                </button>
              </Dropdown>
            ) : (
              <div
                title={notEditableReason}
                aria-disabled
                className={`${actionClassName} cursor-not-allowed text-(--text-faint)`}
              >
                <EditIcon className="text-[14px] opacity-60" />

                <span className="pl-[2.5px]">
                  Edited works
                </span>
              </div>
            )}

            <div className={`${actionClassName} ml-4 cursor-pointer`}>
              <LockIcon className="text-[14px] opacity-60" />

              <span className="pl-[2.5px]">
                Set permissions
              </span>
            </div>

            <button
              type="button"
              disabled={isDeleted || isPinning}
              onClick={() => onTogglePinned(post)}
              className={`${actionClassName} ml-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45`}
            >
              {post.isPinned ? <UnpinIcon className="text-xs text-[#b0b0b5]" /> : <PinIcon className="text-[14px] opacity-60" />}

              <span className="pl-[2.5px]">
                {isPinning ? 'Updating...' : post.isPinned ? 'Removing pinning' : 'Pinned to the pin'}
              </span>
            </button>

            <button
              type="button"
              disabled={isDeleted || isDeleting}
              onClick={() => onDelete(post)}
              className="ml-4 inline-flex cursor-pointer items-center justify-center whitespace-nowrap text-xs text-[rgb(254,44,85)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <FiTrash2 className="text-[14px]" />

              <span className="pl-[2.5px]">
                {isDeleting ? 'Deleting...' : 'Delete work'}
              </span>
            </button>
          </div>
        </div>

        {/* Publish information */}
        <div className="mt-1 flex items-center text-[13px] leading-4.5">
          <div className="flex flex-wrap items-center gap-2 text-(--text-muted)">
            {publishedAt ? <span>{publishedAt}</span> : null}

            {post.status ? (
              <span
                className={
                  isDeleted
                    ? 'text-[#fe2c55]'
                    : 'text-[#20b86a]'
                }
              >
                {isDeleted ? 'Deleted' : 'Published'}
              </span>
            ) : null}
          </div>
        </div>

        {/* Metrics */}
        <PostStatistics metrics={metrics} />
      </div>
    </li>
  );
}
