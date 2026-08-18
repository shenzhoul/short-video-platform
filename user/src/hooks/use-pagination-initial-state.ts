import type { CursorInfo, PaginatedApiResponse } from '@interfaces/pagination';
import {
  enhancePaginatedResponse,
  parsePaginationSearchParams,
  type ParsePaginationSearchParamsOptions
} from '@lib/utils/pagination';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { useMemo } from 'react';

type HookSearchParams =
  | Record<string, string | string[] | undefined>
  | URLSearchParams
  | ReadonlyURLSearchParams
  | undefined;

export interface UsePaginationInitialStateOptions<T> extends ParsePaginationSearchParamsOptions {
  searchParams: HookSearchParams;
  initialData: PaginatedApiResponse<T>;
  itemToCursor?: (item: T) => CursorInfo | null;
}

export interface UsePaginationInitialStateResult<T> {
  page: number;
  pageSize: number;
  sortBy: string;
  sort: 'asc' | 'desc';
  filter: Record<string, string>;
  cursor: CursorInfo | null;
  lastCreatedAt: string | null;
  sanitizedInitialData: PaginatedApiResponse<T>;
  maxOffset: number | null;
}

export const usePaginationInitialState = <T>(
  options: UsePaginationInitialStateOptions<T>
): UsePaginationInitialStateResult<T> => {
  const {
    searchParams,
    initialData,
    itemToCursor,
    defaultPage,
    defaultPageSize,
    defaultSortBy,
    defaultSort,
    filterSkipKeys
  } = options;

  const parsed = useMemo(
    () =>
      parsePaginationSearchParams(searchParams as any, {
        defaultPage,
        defaultPageSize,
        defaultSortBy,
        defaultSort,
        filterSkipKeys
      }),
    [searchParams, defaultPage, defaultPageSize, defaultSortBy, defaultSort, filterSkipKeys]
  );

  const sanitizedInitialData = useMemo(
    () =>
      enhancePaginatedResponse<T>(initialData, {
        offset: parsed.offset,
        limit: parsed.pageSize,
        itemToCursor
      }),
    [initialData, parsed.offset, parsed.pageSize, itemToCursor]
  );

  const maxOffset = typeof sanitizedInitialData?.paginationInfo?.maxOffset === 'number'
    ? sanitizedInitialData.paginationInfo.maxOffset
    : null;

  return {
    page: parsed.page,
    pageSize: parsed.pageSize,
    sortBy: parsed.sortBy,
    sort: parsed.sort,
    filter: parsed.filters,
    cursor: parsed.cursor,
    lastCreatedAt: parsed.rawCursor.lastCreatedAt,
    sanitizedInitialData,
    maxOffset
  };
};
