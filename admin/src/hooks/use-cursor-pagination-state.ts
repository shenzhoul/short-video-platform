'use client';

import { clearCursorParams, CursorInfo, parseCursorFromParams, setCursorParams } from '@lib/cursor';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface UseCursorPaginationStateOptions {
  params: ReadonlyURLSearchParams | null;
  pathname: string;
  push: (url: string) => void;
  defaultPageSize?: number;
  pageParam?: string;
  pageSizeParam?: string;
  limitParam?: string | null;
}

export interface UseCursorPaginationStateReturn {
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  initialCursor: CursorInfo | null;
  paramsKey: string;
  createSearchParams: () => URLSearchParams;
  pushParams: (params: URLSearchParams) => void;
  pushPage: (page: number, options?: { pageSize?: number; cursor?: CursorInfo | null }) => void;
  updateParams: (
    updates: Record<string, string | number | null | undefined>,
    options?: { resetPage?: boolean; clearCursor?: boolean }
  ) => void;
}

export function useCursorPaginationState(options: UseCursorPaginationStateOptions): UseCursorPaginationStateReturn {
  const {
    params,
    pathname,
    push,
    defaultPageSize = 10,
    pageParam = 'page',
    pageSizeParam = 'pageSize',
    limitParam = 'limit'
  } = options;

  const paramsKey = useMemo(() => params?.toString() ?? '', [params]);

  const initialPage = useMemo(() => {
    const raw = params?.get(pageParam);
    const parsed = raw ? parseInt(raw, 10) : 1;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [params, pageParam]);

  const initialPageSize = useMemo(() => {
    const raw = params?.get(pageSizeParam) ?? (limitParam ? params?.get(limitParam) : null);
    const parsed = raw ? parseInt(raw, 10) : defaultPageSize;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPageSize;
  }, [params, pageSizeParam, limitParam, defaultPageSize]);

  const initialCursor = useMemo(() => parseCursorFromParams(params), [paramsKey]);

  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => {
    setCurrentPage(initialPage);
  }, [initialPage]);

  useEffect(() => {
    setPageSize(initialPageSize);
  }, [initialPageSize]);

  const createSearchParams = useCallback(() => new URLSearchParams(params?.toString() || ''), [params]);

  const pushParams = useCallback((nextParams: URLSearchParams) => {
    push(`${pathname}?${nextParams.toString()}`);
  }, [push, pathname]);

  const pushPage = useCallback((page: number, pageOptions?: { pageSize?: number; cursor?: CursorInfo | null }) => {
    const size = pageOptions?.pageSize ?? pageSize;
    const nextParams = createSearchParams();
    nextParams.set(pageParam, page.toString());
    nextParams.set(pageSizeParam, size.toString());
    if (limitParam) {
      nextParams.set(limitParam, size.toString());
    }

    if (pageOptions?.cursor) {
      setCursorParams(nextParams, pageOptions.cursor);
    } else {
      clearCursorParams(nextParams);
    }

    pushParams(nextParams);
    setCurrentPage(page);
    setPageSize(size);
  }, [createSearchParams, pageParam, pageSizeParam, limitParam, pushParams, pageSize]);

  const updateParams = useCallback((updates: Record<string, string | number | null | undefined>, paramOptions: { resetPage?: boolean; clearCursor?: boolean } = {}) => {
    const { resetPage = false, clearCursor = true } = paramOptions;
    const nextParams = createSearchParams();

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        nextParams.delete(key);
        return;
      }
      nextParams.set(key, String(value));
    });

    if (resetPage) {
      nextParams.set(pageParam, '1');
      if (limitParam) {
        const sizeValue = updates[pageSizeParam] ?? updates[limitParam] ?? pageSize;
        nextParams.set(pageSizeParam, String(sizeValue));
        if (limitParam) {
          nextParams.set(limitParam, String(sizeValue));
        }
      }
    }

    if (clearCursor) {
      clearCursorParams(nextParams);
    }

    pushParams(nextParams);

    if (resetPage) {
      setCurrentPage(1);
    }
  }, [createSearchParams, pushParams, pageParam, pageSizeParam, limitParam, pageSize]);

  return {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    initialCursor,
    paramsKey,
    createSearchParams,
    pushParams,
    pushPage,
    updateParams
  };
}
