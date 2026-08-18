'use client';

import { FiCalendar, FiChevronDown, FiDownload } from 'react-icons/fi';
import { SearchIcon } from 'src/icons';

import {
  PLACEHOLDER_COLLECTION_COUNT,
  PLACEHOLDER_STATUS_FILTERS,
  PLACEHOLDER_TOOLBAR_CONTROLS
} from './creator-manage-placeholders';

interface CreatorPostsToolbarProps {
  /** Real count from the API, used for the active tab. */
  worksCount: number;
}

const controlClassName = 'flex h-8 cursor-not-allowed items-center gap-1.5 rounded-sm border border-(--border-soft) px-3 text-[12px] leading-5 text-(--text-muted)';

/**
 * Tabs and filter bar above the works list.
 *
 * Structure follows the reference; every control except the Works tab is inert, because the API has
 * no status filter, no collections and no export. They are declared in creator-manage-placeholders.ts
 * with what each would need, and rendered visibly disabled rather than looking clickable.
 */
export default function CreatorPostsToolbar({ worksCount }: CreatorPostsToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-(--border-faint) px-8 pb-4">
      <div className="flex items-center gap-2">
        <span className="rounded-md flex h-9 items-center bg-(--active-bg) px-4 text-[14px] font-semibold leading-5 text-(--text-strong)">
          {`Works (${worksCount})`}
        </span>
        <span
          title="Collections of works are not available yet"
          aria-disabled
          className="rounded-md flex h-9 cursor-not-allowed items-center px-4 text-[13px] leading-5 text-(--text-muted)"
        >
          {`Collection of Works (${PLACEHOLDER_COLLECTION_COUNT})`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center text-[13px] leading-5">
          <span className="px-3 font-semibold text-(--text-strong)">All of them</span>
          {PLACEHOLDER_STATUS_FILTERS.map(filter => (
            <span key={filter} className="flex items-center">
              <span aria-hidden className="text-(--border-soft)">|</span>
              <span
                title="Filtering by review state is not available yet"
                aria-disabled
                className="cursor-not-allowed px-3 text-(--text-muted)"
              >
                {filter}
              </span>
            </span>
          ))}
        </div>

        <span title="Filtering by genre is not available yet" aria-disabled className={controlClassName}>
          <span className="text-(--text-subtle)">Genre</span>
          <span>{PLACEHOLDER_TOOLBAR_CONTROLS.genre}</span>
          <FiChevronDown className="text-[13px]" />
        </span>
        <span title="Filtering by date is not available yet" aria-disabled className={controlClassName}>
          <FiCalendar className="text-[13px]" />
          <span>{PLACEHOLDER_TOOLBAR_CONTROLS.dateRange}</span>
        </span>
        <span title="Searching your works is not available yet" aria-disabled className={controlClassName}>
          <SearchIcon className="text-sm" />
          <span>{PLACEHOLDER_TOOLBAR_CONTROLS.search}</span>
        </span>
        <span title="Exporting data is not available yet" aria-disabled className={controlClassName}>
          <FiDownload className="text-[13px]" />
          <span>{PLACEHOLDER_TOOLBAR_CONTROLS.export}</span>
        </span>
      </div>
    </div>
  );
}
