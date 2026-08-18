/**
 * Generic cursor-based pagination hook.
 *
 * Provides reusable state management for resources that support hybrid offset/cursor pagination.
 * Handles cursor maps per page, offset fallbacks, and derives pagination metadata from API responses.
 */

'use client';

import { CursorInfo, normalizeCursor, PaginationInfo } from '@lib/cursor';
import { appMessage as message } from '@lib/antd-message';
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Primitive = string | number | boolean | null | undefined;

export interface CursorPaginationResponse<T> {
  data: T[];
  total?: number;
  hasMore?: boolean;
  nextCursor?: CursorInfo | null;
  paginationInfo?: PaginationInfo;
}

export interface UseCursorPaginatedResourceOptions<TItem> {
  /** Current page index (1-based). */
  page: number;
  /** Items per page. */
  limit: number;
  /**
   * Filters merged into every request. Undefined/null values are automatically removed.
   */
  filters?: Record<string, Primitive | Primitive[]>;
  /**
   * Async fetcher returning the paginated response payload.
   * The hook passes composed query params that already include limit/cursor/offset.
   */
  fetcher: (query: Record<string, Primitive | Primitive[]>) => Promise<CursorPaginationResponse<TItem>>;
  /** Initial cursor restored from URL parameters when landing on a deep page. */
  initialCursor?: CursorInfo | null;
  /**
   * Optional fallback cursor extractor when API response omits nextCursor.
   * Receives the last item of the fetched page.
   */
  getCursorFromItem?: (item: TItem | undefined) => CursorInfo | null;
  /** Optional friendly resource name for error reporting. */
  resourceName?: string;
  /**
   * Toggle automatic toast error handling (defaults to true).
   */
  enableErrorMessage?: boolean;
}

export interface UseCursorPaginatedResourceReturn<TItem> {
  items: TItem[];
  setItems: Dispatch<SetStateAction<TItem[]>>;
  setTotal: Dispatch<SetStateAction<number>>;
  loading: boolean;
  total: number;
  hasMore: boolean;
  nextCursor: CursorInfo | null;
  paginationInfo?: PaginationInfo;
  error: unknown;
  /**
   * Request the next cursor page (used by CustomPagination deep pagination button).
   */
  onCursorNext: (cursor: CursorInfo) => void;
  /**
   * Load more items using the currently stored next cursor (infinite-scroll style).
   */
  loadMore: () => Promise<void>;
  /** Refetch the current page, resetting cursor state. */
  refetch: () => Promise<void>;
}

export function useCursorPaginatedResource<TItem>(options: UseCursorPaginatedResourceOptions<TItem>): UseCursorPaginatedResourceReturn<TItem> {
  const {
    page,
    limit,
    filters = {},
    fetcher,
    initialCursor = null,
    getCursorFromItem,
    resourceName = 'items',
    enableErrorMessage = true
  } = options;

  const [items, setItems] = useState<TItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<CursorInfo | null>(null);
  const [paginationInfo, setPaginationInfo] = useState<PaginationInfo | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);

  const paginationInfoRef = useRef<PaginationInfo | undefined>(undefined);
  const cursorMapRef = useRef<Record<number, CursorInfo>>({});
  const initialCursorRef = useRef<CursorInfo | null>(initialCursor);
  const filtersRef = useRef<Record<string, Primitive | Primitive[]>>(filters);
  const prevDepsRef = useRef<{ filtersKey: string; limit: number; page: number } | null>(null);

  useEffect(() => {
    initialCursorRef.current = initialCursor;
  }, [initialCursor]);

  const filtersKey = useMemo(() => JSON.stringify(filters ?? {}), [filters]);
  filtersRef.current = filters;

  const sanitizeQuery = useCallback((query: Record<string, Primitive | Primitive[]>) => {
    const sanitized: Record<string, Primitive | Primitive[]> = {};
    Object.entries(query).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        const filteredArray = value.filter((item) => item !== undefined && item !== null && item !== '');
        if (filteredArray.length > 0) {
          sanitized[key] = filteredArray;
        }
        return;
      }

      if (value !== undefined && value !== null && value !== '') {
        sanitized[key] = value;
      }
    });
    return sanitized;
  }, []);

  const fetchData = useCallback(async (reset = false, cursorOverride: CursorInfo | null = null) => {
    try {
      setLoading(true);
      setError(null);

      const baseParams: Record<string, Primitive | Primitive[]> = {
        limit
      };

      Object.assign(baseParams, sanitizeQuery(filtersRef.current));

      let cursorToUse = cursorOverride || cursorMapRef.current[page] || null;
      if (!cursorToUse && page > 1 && initialCursorRef.current) {
        cursorToUse = initialCursorRef.current;
        cursorMapRef.current = {
          ...cursorMapRef.current,
          [page]: initialCursorRef.current
        };
        initialCursorRef.current = null;
      }

      const offsetValue = (page - 1) * limit;
      const maxOffset = paginationInfoRef.current?.maxOffset ?? Number.POSITIVE_INFINITY;
      const forceCursor = Boolean(cursorOverride);
      const exceedsOffsetLimit = offsetValue >= maxOffset;
      const shouldUseCursor = (forceCursor || exceedsOffsetLimit) && !!cursorToUse;

      if (shouldUseCursor && cursorToUse) {
        baseParams.cursor = cursorToUse.id;
        if (cursorToUse.createdAt) {
          baseParams.lastCreatedAt = cursorToUse.createdAt;
        }
        if (cursorToUse.updatedAt) {
          baseParams.lastUpdatedAt = cursorToUse.updatedAt;
        }
      } else if (page > 1) {
        baseParams.offset = offsetValue;
      }

      const response = await fetcher(baseParams);
      const newItems = response.data ?? [];

      const responsePaginationInfo = response.paginationInfo;
      const responseTotal = typeof response.total === 'number' ? response.total : undefined;
      const responseHasMore = typeof response.hasMore === 'boolean' ? response.hasMore : undefined;
      const responseNextCursor = normalizeCursor(response.nextCursor);

      if (reset || shouldUseCursor) {
        setItems(newItems);
      } else {
        setItems((prev) => {
          // Prevent accidental duplication when API already returns page-sized data.
          if (!prev.length) return newItems;
          return [...prev, ...newItems];
        });
      }

      const derivedHasMore = (() => {
        if (typeof responseTotal === 'number') {
          return page * limit < responseTotal;
        }
        if (typeof responseHasMore === 'boolean') {
          return responseHasMore;
        }
        return newItems.length === limit;
      })();

      setHasMore(derivedHasMore);

      const inferredCursor = (() => {
        if (!derivedHasMore) return null;
        if (responseNextCursor) return responseNextCursor;
        if (getCursorFromItem) return getCursorFromItem(newItems[newItems.length - 1]);
        const lastItem = newItems[newItems.length - 1];
        if (!lastItem || typeof lastItem !== 'object') return null;
        const candidate = (lastItem as Record<string, any>)._id ?? (lastItem as Record<string, any>).id;
        if (!candidate) return null;
        return normalizeCursor({
          id: candidate,
          createdAt: (lastItem as Record<string, any>).createdAt,
          updatedAt: (lastItem as Record<string, any>).updatedAt
        });
      })();

      setNextCursor(inferredCursor);
      if (paginationInfoRef.current && offsetValue >= maxOffset && inferredCursor) {
        cursorMapRef.current = {
          ...cursorMapRef.current,
          [page + 1]: inferredCursor
        };
      } else if (cursorMapRef.current[page + 1] && offsetValue >= maxOffset) {
        const updated = { ...cursorMapRef.current };
        delete updated[page + 1];
        cursorMapRef.current = updated;
      }

      if (typeof responseTotal === 'number') {
        setTotal(responseTotal);
      } else {
        setTotal((prev) => {
          if (prev && prev > 0) {
            return prev;
          }
          return newItems.length;
        });
      }

      setPaginationInfo(responsePaginationInfo);
      paginationInfoRef.current = responsePaginationInfo;
    } catch (err) {
      setError(err);
      if (enableErrorMessage) {
        const fallbackMessage = `Failed to load ${resourceName}`;
        const errorMessage = err instanceof Error ? err.message : fallbackMessage;
        message.error(errorMessage || fallbackMessage);
      }
    } finally {
      setLoading(false);
    }
  }, [fetcher, limit, page, sanitizeQuery, getCursorFromItem, resourceName, enableErrorMessage]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !nextCursor) return;
    await fetchData(false, nextCursor);
  }, [loading, hasMore, nextCursor, fetchData]);

  const refetch = useCallback(async () => {
    cursorMapRef.current = {};
    paginationInfoRef.current = undefined;
    setNextCursor(null);
    await fetchData(true, null);
  }, [fetchData]);

  const handleCursorNext = useCallback((cursor: CursorInfo) => {
    cursorMapRef.current = {
      ...cursorMapRef.current,
      [page + 1]: cursor
    };
    initialCursorRef.current = cursor;
    setNextCursor(cursor);
  }, [page]);

  useEffect(() => {
    const prevDeps = prevDepsRef.current;
    const nextDeps = { filtersKey, limit, page };
    prevDepsRef.current = nextDeps;

    if (!prevDeps) {
      fetchData(true, null);
      return;
    }

    const filtersChanged = prevDeps.filtersKey !== filtersKey;
    const limitChanged = prevDeps.limit !== limit;
    const pageChanged = prevDeps.page !== page;

    if (filtersChanged || limitChanged) {
      cursorMapRef.current = {};
      paginationInfoRef.current = undefined;
      initialCursorRef.current = initialCursor;
      setNextCursor(null);
      fetchData(true, null);
      return;
    }

    if (pageChanged) {
      fetchData(true, null);
    }
  }, [filtersKey, limit, page, fetchData, initialCursor]);

  return {
    items,
    setItems,
    setTotal,
    loading,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    error,
    onCursorNext: handleCursorNext,
    loadMore,
    refetch
  };
}
