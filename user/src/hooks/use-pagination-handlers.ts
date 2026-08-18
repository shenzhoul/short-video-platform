import type { CursorInfo } from '@interfaces/pagination';
import { synthesizeCursorFromItems } from '@lib/utils/pagination';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

export interface UsePaginationHandlersOptions<T> {
  initialPage: number;
  initialPageSize: number;
  initialSortBy: string;
  initialSort: 'asc' | 'desc';
  initialFilter: Record<string, any>;
  initialCursor: CursorInfo | null;
  initialLastCreatedAt: string | null;
  initialMaxOffset: number | null;
  itemToCursor?: (item: T) => CursorInfo | null;
}

export interface UsePaginationHandlersResult {
  // State
  currentPage: number;
  currentPageSize: number;
  sortBy: string;
  sort: 'asc' | 'desc';
  filter: Record<string, any>;
  currentCursor: CursorInfo | null;
  lastCreatedAt: string | null;
  maxOffsetLimit: number | null;

  // State setters
  setCurrentPage: (page: number) => void;
  setCurrentPageSize: (size: number) => void;
  setSortBy: (sortBy: string) => void;
  setSort: (sort: 'asc' | 'desc') => void;
  setFilter: (filter: Record<string, any>) => void;
  setCurrentCursor: (cursor: CursorInfo | null) => void;
  setLastCreatedAt: (value: string | null) => void;
  setMaxOffsetLimit: (limit: number | null) => void;

  // Handlers
  clampOffsetValue: (offset: number) => number;
  serializeCursorCreatedAt: (value: number | string) => string;
  updateRoute: (params: {
    page: number;
    pageSize: number;
    sortBy?: string;
    sort?: 'asc' | 'desc';
    filter?: Record<string, any>;
    extra?: Record<string, string | number | null | undefined>;
  }) => void;
  handleCursorNext: (cursor: CursorInfo) => void;
  handlePaginationChange: (
    page: number,
    pageSize: number | undefined,
    items: any[],
    nextCursor: CursorInfo | null,
    onWarning?: (message: string) => void
  ) => void;
  handleTableChange: (
    paginationState: any,
    filters: any,
    sorter: any,
    extra: any,
    items: any[],
    nextCursor: CursorInfo | null,
    onWarning?: (message: string) => void
  ) => void;
}

export const usePaginationHandlers = <T>(
  options: UsePaginationHandlersOptions<T>
): UsePaginationHandlersResult => {
  const {
    initialPage,
    initialPageSize,
    initialSortBy,
    initialSort,
    initialFilter,
    initialCursor,
    initialLastCreatedAt,
    initialMaxOffset,
    itemToCursor
  } = options;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [currentPageSize, setCurrentPageSize] = useState(initialPageSize);
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [sort, setSort] = useState<'asc' | 'desc'>(initialSort);
  const [filter, setFilter] = useState<Record<string, any>>(initialFilter);
  const [currentCursor, setCurrentCursor] = useState<CursorInfo | null>(initialCursor);
  const [lastCreatedAt, setLastCreatedAt] = useState<string | null>(initialLastCreatedAt);
  const [maxOffsetLimit, setMaxOffsetLimit] = useState<number | null>(initialMaxOffset);

  const clampOffsetValue = useCallback((offset: number) => {
    if (typeof maxOffsetLimit === 'number' && maxOffsetLimit >= 0) {
      return Math.min(offset, maxOffsetLimit);
    }
    return offset;
  }, [maxOffsetLimit]);

  const serializeCursorCreatedAt = useCallback((value: number | string) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === 'string') {
      const numeric = Number(value);
      if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
        return String(numeric);
      }

      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        return String(parsed);
      }

      return value;
    }

    return String(Date.now());
  }, []);

  const updateRoute = useCallback(({
    page,
    pageSize,
    sortBy: sortByOverride,
    sort: sortOverride,
    filter: filterOverride,
    extra = {}
  }: {
    page: number;
    pageSize: number;
    sortBy?: string;
    sort?: 'asc' | 'desc';
    filter?: Record<string, any>;
    extra?: Record<string, string | number | null | undefined>;
  }) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');

    const nextSortBy = sortByOverride ?? sortBy;
    const nextSort = sortOverride ?? sort;
    const nextFilter = filterOverride ?? filter;

    params.set('page', String(page));
    params.set('pageSize', String(pageSize));

    if (nextSortBy) {
      params.set('sortBy', nextSortBy);
    } else {
      params.delete('sortBy');
    }

    if (nextSort) {
      params.set('sort', nextSort);
    } else {
      params.delete('sort');
    }

    const filterKeys = new Set<string>([
      ...Object.keys(filter || {}),
      ...Object.keys(nextFilter || {})
    ]);

    filterKeys.forEach((key) => {
      params.delete(key);
    });

    if (nextFilter) {
      Object.entries(nextFilter).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          params.delete(key);
          return;
        }
        params.set(key, String(value));
      });
    }

    Object.entries(extra).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        params.delete(key);
      } else {
        const finalValue = key === 'offset'
          ? clampOffsetValue(Number(value))
          : value;
        params.set(key, String(finalValue));
      }
    });

    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [clampOffsetValue, filter, pathname, router, searchParams, sort, sortBy]);

  const handleCursorNext = useCallback((cursor: CursorInfo) => {
    const nextPage = currentPage + 1;
    const lastCreatedAtValue = serializeCursorCreatedAt(cursor.createdAt);
    const offsetValue = clampOffsetValue((nextPage - 1) * currentPageSize);

    setCurrentCursor(cursor);
    setLastCreatedAt(lastCreatedAtValue);
    setCurrentPage(nextPage);

    updateRoute({
      page: nextPage,
      pageSize: currentPageSize,
      extra: {
        cursor: cursor.id,
        lastCreatedAt: lastCreatedAtValue,
        offset: offsetValue
      }
    });
  }, [clampOffsetValue, currentPage, currentPageSize, serializeCursorCreatedAt, updateRoute]);

  const handlePaginationChange = useCallback((
    page: number,
    pageSize: number | undefined,
    items: any[],
    nextCursor: CursorInfo | null,
    onWarning?: (message: string) => void
  ) => {
    const nextPageSize = pageSize && pageSize > 0 ? pageSize : currentPageSize;
    const desiredOffset = (page - 1) * nextPageSize;
    const offsetValue = clampOffsetValue(desiredOffset);

    if (typeof maxOffsetLimit === 'number' && desiredOffset > maxOffsetLimit) {
      const cursorCandidate = nextCursor ?? (itemToCursor ? synthesizeCursorFromItems(items, itemToCursor) : null);

      if (!cursorCandidate) {
        onWarning?.('More items are not available yet for deep pagination. Please try again later.');
        return;
      }

      const cursorLastCreatedAt = serializeCursorCreatedAt(cursorCandidate.createdAt);

      setCurrentCursor(cursorCandidate);
      setLastCreatedAt(cursorLastCreatedAt);
      setCurrentPage(page);
      setCurrentPageSize(nextPageSize);

      updateRoute({
        page,
        pageSize: nextPageSize,
        extra: {
          cursor: cursorCandidate.id,
          lastCreatedAt: cursorLastCreatedAt,
          offset: offsetValue
        }
      });
      return;
    }

    // Reset cursor state when using traditional pagination
    setCurrentCursor(null);
    setLastCreatedAt(null);
    setCurrentPage(page);
    setCurrentPageSize(nextPageSize);

    updateRoute({
      page,
      pageSize: nextPageSize,
      extra: {
        cursor: null,
        lastCreatedAt: null,
        offset: offsetValue
      }
    });
  }, [clampOffsetValue, currentPageSize, itemToCursor, maxOffsetLimit, serializeCursorCreatedAt, updateRoute]);

  const handleTableChange = useCallback((
    paginationState: any,
    _filters: any,
    sorter: any,
    extra: any,
    items: any[],
    nextCursor: CursorInfo | null,
    onWarning?: (message: string) => void
  ) => {
    if (extra?.action === 'cursor-next') {
      return;
    }

    if (extra?.action === 'paginate') {
      return;
    }

    let nextSortBy = sortBy;
    let nextSort = sort;
    let targetPage = paginationState?.current || currentPage;
    const nextPageSize = paginationState?.pageSize || currentPageSize;

    if (sorter?.field) {
      nextSortBy = sorter.field;
      nextSort = sorter.order === 'ascend' ? 'asc' : 'desc';
      targetPage = 1;
      setSortBy(nextSortBy);
      setSort(nextSort);
    }

    const desiredOffset = (targetPage - 1) * nextPageSize;
    const offsetValue = clampOffsetValue(desiredOffset);

    if (typeof maxOffsetLimit === 'number' && desiredOffset > maxOffsetLimit) {
      const cursorCandidate = nextCursor ?? (itemToCursor ? synthesizeCursorFromItems(items, itemToCursor) : null);

      if (!cursorCandidate) {
        onWarning?.('No more items available beyond this page.');
        return;
      }

      const cursorLastCreatedAt = serializeCursorCreatedAt(cursorCandidate.createdAt);

      setCurrentCursor(cursorCandidate);
      setLastCreatedAt(cursorLastCreatedAt);
      setCurrentPage(targetPage);
      setCurrentPageSize(nextPageSize);

      updateRoute({
        page: targetPage,
        pageSize: nextPageSize,
        sortBy: nextSortBy,
        sort: nextSort,
        extra: {
          cursor: cursorCandidate.id,
          lastCreatedAt: cursorLastCreatedAt,
          offset: offsetValue
        }
      });
      return;
    }

    // Reset pagination state when sorting or other table changes occur
    setCurrentCursor(null);
    setLastCreatedAt(null);
    setCurrentPage(targetPage);
    setCurrentPageSize(nextPageSize);

    updateRoute({
      page: targetPage,
      pageSize: nextPageSize,
      sortBy: nextSortBy,
      sort: nextSort,
      extra: {
        cursor: null,
        lastCreatedAt: null,
        offset: offsetValue
      }
    });
  }, [clampOffsetValue, currentPage, currentPageSize, itemToCursor, maxOffsetLimit, serializeCursorCreatedAt, sort, sortBy, updateRoute]);

  return {
    // State
    currentPage,
    currentPageSize,
    sortBy,
    sort,
    filter,
    currentCursor,
    lastCreatedAt,
    maxOffsetLimit,

    // State setters
    setCurrentPage,
    setCurrentPageSize,
    setSortBy,
    setSort,
    setFilter,
    setCurrentCursor,
    setLastCreatedAt,
    setMaxOffsetLimit,

    // Handlers
    clampOffsetValue,
    serializeCursorCreatedAt,
    updateRoute,
    handleCursorNext,
    handlePaginationChange,
    handleTableChange
  };
};
