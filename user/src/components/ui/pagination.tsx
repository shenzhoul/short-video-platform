/**
 * Pagination Component
 *
 * Tailwind-based pagination supporting cursor navigation and traditional page numbering.
 * Includes controlled/uncontrolled modes, optional links for SEO, and page size/quick jump controls.
 */

'use client';

import type { CursorInfo, PaginationInfo } from '@interfaces/pagination';
import { FC, ReactNode, useCallback, useMemo, useState } from 'react';

export type { CursorInfo, PaginatedApiResponse, PaginationInfo } from '@interfaces/pagination';

export interface PaginationProps {
  current?: number;
  defaultCurrent?: number;
  pageSize?: number;
  defaultPageSize?: number;
  total: number;
  pageSizeOptions?: number[];
  showSizeChanger?: boolean;
  showQuickJumper?: boolean;
  showTotal?: (total: number, range: [number, number]) => ReactNode;
  onChange?: (page: number, pageSize: number) => void;
  onShowSizeChange?: (current: number, size: number) => void;
  size?: 'default' | 'small';
  disabled?: boolean;
  hideOnSinglePage?: boolean;
  className?: string;
  showLink?: boolean;
  baseLinkUrl?: string;
  disableLinkRedirect?: boolean;
  hasMore?: boolean;
  nextCursor?: CursorInfo | null;
  paginationInfo?: PaginationInfo;
  onCursorNext?: (cursor: CursorInfo) => void;
  showCursorNavigation?: boolean;
}

const clampPage = (page: number) => (page < 1 ? 1 : page);

const resolvePageSize = (size: number) => (size > 0 ? size : 1);

const createHref = (
  baseLinkUrl: string,
  page: number,
  pageSize: number,
  useCursor: boolean,
  nextCursor: CursorInfo | null
) => {
  if (!baseLinkUrl) return '#';

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const url = new URL(baseLinkUrl, origin);

  if (useCursor && nextCursor) {
    url.searchParams.set('cursor', nextCursor.id);
    if (nextCursor.createdAt) {
      url.searchParams.set('lastCreatedAt', String(nextCursor.createdAt));
    }
    url.searchParams.set('offset', String((page - 1) * pageSize));
  } else {
    url.searchParams.set('page', String(page));
  }

  url.searchParams.set('pageSize', String(pageSize));
  return url.pathname + url.search;
};

export const Pagination: FC<PaginationProps> = ({
  current,
  defaultCurrent = 1,
  pageSize,
  defaultPageSize = 10,
  total,
  pageSizeOptions = [10, 20, 50],
  showSizeChanger = false,
  showQuickJumper = false,
  showTotal,
  onChange,
  onShowSizeChange,
  size = 'default',
  disabled = false,
  hideOnSinglePage = false,
  className = '',
  showLink = true,
  baseLinkUrl = '',
  disableLinkRedirect = false,
  hasMore = false,
  nextCursor = null,
  paginationInfo,
  onCursorNext,
  showCursorNavigation = true
}) => {
  const [internalPage, setInternalPage] = useState(defaultCurrent);
  const [internalPageSize, setInternalPageSize] = useState(defaultPageSize);

  const isPageControlled = current !== undefined;
  const isSizeControlled = pageSize !== undefined;

  const currentPage = clampPage(isPageControlled ? current! : internalPage);
  const currentPageSize = resolvePageSize(isSizeControlled ? pageSize! : internalPageSize);

  const maxOffset = paginationInfo?.maxOffset;
  const isCursorAvailable = paginationInfo?.cursorPaginationAvailable ?? true;

  const maxOffsetPage = useMemo(() => {
    if (typeof maxOffset !== 'number' || maxOffset <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(1, Math.ceil(maxOffset / currentPageSize));
  }, [maxOffset, currentPageSize]);

  const isDeepPagination = useMemo(() => currentPage >= maxOffsetPage, [currentPage, maxOffsetPage]);
  const shouldShowCursorNav = showCursorNavigation && isCursorAvailable && isDeepPagination;

  const limitedTotal = useMemo(() => {
    if (typeof maxOffset === 'number' && maxOffset > 0) {
      return Math.min(total, maxOffset);
    }
    return total;
  }, [maxOffset, total]);

  const paginationTotal = useMemo(() => {
    let computed = limitedTotal;
    const minimumVisible = currentPage * currentPageSize;

    if (minimumVisible > computed) {
      computed = minimumVisible;
    }

    if (shouldShowCursorNav && hasMore) {
      computed = Math.max(computed, minimumVisible + currentPageSize);
    }

    return computed;
  }, [limitedTotal, currentPage, currentPageSize, shouldShowCursorNav, hasMore]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(paginationTotal / currentPageSize)), [paginationTotal, currentPageSize]);

  const totalDisplay = useMemo(() => {
    if (!showTotal) return null;
    if (limitedTotal === 0) {
      return showTotal(0, [0, 0]);
    }
    const start = Math.min((currentPage - 1) * currentPageSize + 1, limitedTotal);
    const end = Math.min(currentPage * currentPageSize, limitedTotal);
    return showTotal(limitedTotal, [start, Math.max(end, start)] as [number, number]);
  }, [showTotal, limitedTotal, currentPage, currentPageSize]);

  const handleChange = useCallback((newPage: number, newSize?: number) => {
    const nextPage = clampPage(newPage);
    const pageSizeValue = resolvePageSize(newSize ?? currentPageSize);

    if (!isPageControlled) {
      setInternalPage(nextPage);
    }
    if (!isSizeControlled && newSize !== undefined) {
      setInternalPageSize(pageSizeValue);
    }

    onChange?.(nextPage, pageSizeValue);
  }, [currentPageSize, isPageControlled, isSizeControlled, onChange]);

  const handlePageSizeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const newSize = resolvePageSize(Number(event.target.value));

    if (!isSizeControlled) {
      setInternalPageSize(newSize);
    }
    if (!isPageControlled) {
      setInternalPage(1);
    }

    onShowSizeChange?.(1, newSize);
    onChange?.(1, newSize);
  }, [isPageControlled, isSizeControlled, onChange, onShowSizeChange]);

  const handleQuickJump = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const input = form.elements.namedItem('quickJump') as HTMLInputElement;
    const value = clampPage(Number(input.value));
    const clampedValue = Math.min(value, pageCount);
    handleChange(clampedValue);
    input.value = '';
  }, [handleChange, pageCount]);

  const handleCursorNext = useCallback(() => {
    if (!nextCursor || !onCursorNext) return;

    if (!isPageControlled) {
      setInternalPage(currentPage + 1);
    }

    onCursorNext(nextCursor);
  }, [nextCursor, onCursorNext, isPageControlled, currentPage]);

  const isPrevDisabled = disabled || currentPage <= 1;
  const canUseCursorNext = shouldShowCursorNav && hasMore && !!nextCursor;
  const isNextDisabled = disabled || (shouldShowCursorNav ? true : currentPage >= pageCount);

  const shouldHide = hideOnSinglePage && pageCount <= 1 && !shouldShowCursorNav;
  const baseClasses = `h-[30px] min-w-[30px] px-2 flex items-center justify-center rounded border border-border cursor-pointer ${size === 'small' ? 'text-sm' : 'text-base'}`;

  const renderPageButton = useCallback((pageNum: number) => {
    const isActive = pageNum === currentPage;
    const activeClasses = isActive ? 'bg-primary text-white' : 'bg-surface opacity-70  border-border';
    const hoverClasses = disabled ? 'opacity-50 cursor-not-allowed' : '';
    // Determine if this page needs cursor pagination
    const pageOffset = (pageNum - 1) * currentPageSize;
    const needsCursor = maxOffset && typeof maxOffset === 'number' && pageOffset > maxOffset && pageNum >= maxOffsetPage;
    if (showLink && baseLinkUrl) {
      return (
        <a
          key={pageNum}
          href={createHref(baseLinkUrl, pageNum, currentPageSize, needsCursor, nextCursor)}
          className={`${baseClasses} ${activeClasses} ${disabled ? 'opacity-50 pointer-events-none' : hoverClasses}`}
          aria-current={isActive ? 'page' : undefined}
          tabIndex={disabled ? -1 : 0}
          onClick={(event) => {
            if (disabled || disableLinkRedirect) event.preventDefault();
            if (!disabled) handleChange(pageNum, currentPageSize);
          }}
        >
          {pageNum}
        </a>
      );
    }

    return (
      <button
        key={pageNum}
        type="button"
        disabled={disabled}
        className={`${baseClasses} ${activeClasses} ${hoverClasses}`}
        onClick={() => handleChange(pageNum, currentPageSize)}
      >
        {pageNum}
      </button>
    );
  }, [baseLinkUrl, currentPage, currentPageSize, disableLinkRedirect, disabled, handleChange, nextCursor, showLink, baseClasses, maxOffset, maxOffsetPage]);

  const renderPages = useCallback(() => {
    const pages: React.ReactElement[] = [];
    const maxPagesToShow = 5;

    let start = Math.max(1, currentPage - 2);
    let end = Math.min(pageCount, currentPage + 2);

    if (currentPage <= 3) {
      end = Math.min(maxPagesToShow, pageCount);
    } else if (currentPage >= pageCount - 2) {
      start = Math.max(1, pageCount - maxPagesToShow + 1);
    }

    for (let pageNum = start; pageNum <= end; pageNum += 1) {
      pages.push(renderPageButton(pageNum));
    }

    if (start > 1) {
      pages.unshift(<span key="start-ellipsis" className="mx-1">...</span>);
      pages.unshift(renderPageButton(1));
    }

    if (end < pageCount) {
      pages.push(<span key="end-ellipsis" className="mx-1">...</span>);
      pages.push(renderPageButton(pageCount));
    }

    return pages;
  }, [currentPage, pageCount, renderPageButton]);

  const renderPrevButton = () => (
    <button
      type="button"
      disabled={isPrevDisabled}
      className={`${baseClasses} ${size === 'small' ? 'text-sm' : 'text-base'
        } ${isPrevDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onClick={() => handleChange(currentPage - 1, currentPageSize)}
    >
      Prev
    </button>
  );

  const renderNextButton = () => {
    return (
      <button
        type="button"
        disabled={isNextDisabled}
        className={`${baseClasses} ${size === 'small' ? 'text-sm' : 'text-base'
          } ${isNextDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={() => handleChange(currentPage + 1, currentPageSize)}
      >
        Next
      </button>
    );
  };

  const renderCursorButton = () => {
    if (!shouldShowCursorNav || !canUseCursorNext) {
      return null;
    }

    const content = 'Load more';

    if (showLink && baseLinkUrl) {
      return (
        <a
          href={createHref(baseLinkUrl, currentPage + 1, currentPageSize, true, nextCursor)}
          className={`${baseClasses} ${size === 'small' ? 'text-sm' : 'text-base'
            } hover:bg-blue-100`}
          onClick={(event) => {
            if (disableLinkRedirect) event.preventDefault();
            handleCursorNext();
          }}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        type="button"
        className={`${baseClasses} ${size === 'small' ? 'text-sm' : 'text-base'
          } `}
        onClick={handleCursorNext}
      >
        {content}
      </button>
    );
  };

  if (shouldHide) {
    return null;
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {shouldShowCursorNav ? (
        <span className="mr-2 text-xs text-blue-600 bg-primary-50 px-2 py-1 rounded">
          Deep pagination mode
        </span>
      ) : null}

      {totalDisplay ? (
        <span className="mr-2 opacity-60 text-sm">
          {totalDisplay}
        </span>
      ) : null}

      <div className='flex gap-1'>
        {renderPrevButton()}

        {renderPages()}

        {renderNextButton()}

        {renderCursorButton()}
      </div>

      {showSizeChanger && !shouldShowCursorNav ? (
        <select
          className={`px-2 h-[30px] border border-border rounded ${size === 'small' ? 'text-sm' : 'text-base'}`}
          value={currentPageSize}
          disabled={disabled}
          onChange={handlePageSizeChange}
        >
          {pageSizeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
              {' '}
              / page
            </option>
          ))}
        </select>
      ) : null}

      {showQuickJumper && !shouldShowCursorNav ? (
        <form onSubmit={handleQuickJump} className="ml-2 flex items-center gap-1">
          <span className="opacity-60 text-sm">Go to</span>
          <input
            name="quickJump"
            type="number"
            inputMode="decimal"
            min={1}
            max={pageCount}
            className={`w-16 px-2 py-1 border rounded ${size === 'small' ? 'text-sm' : 'text-base'}`}
            disabled={disabled}
          />
          <button
            type="submit"
            className="px-2 py-1 rounded bg-primary-500 text-white text-xs"
            disabled={disabled}
          >
            Go
          </button>
        </form>
      ) : null}
    </div>
  );
};

export default Pagination;
