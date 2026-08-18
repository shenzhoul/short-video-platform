'use client';

import { CursorInfo, normalizeCursor, PaginationInfo } from '@lib/cursor';
import { toTimestamp } from '@lib/date';
import { loggerService } from '@services/logger.service';
import { useCallback, useMemo } from 'react';
import { IRequestLog } from 'src/interfaces';

import { useCursorPaginatedResource } from './use-cursor-paginated-resource';

interface UseRequestLogsProps {
  keyword?: string;
  method?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  page?: number;
  initialCursor?: CursorInfo | null;
}

interface UseRequestLogsReturn {
  requestLogs: IRequestLog[];
  loading: boolean;
  total: number;
  hasMore: boolean;
  nextCursor: CursorInfo | null;
  paginationInfo?: PaginationInfo;
  onCursorNext: (cursor: CursorInfo) => void;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
  deleteRecord: (ids: string[]) => Promise<void>;
}

export const useRequestLogs = ({
  keyword,
  method,
  fromDate,
  toDate,
  sortBy,
  sort,
  limit = 10,
  page = 1,
  initialCursor = null
}: UseRequestLogsProps): UseRequestLogsReturn => {
  const filters = useMemo(() => ({
    ...(keyword ? { path: keyword, q: keyword } : {}),
    ...(method ? { method } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    sortBy: sortBy || 'createdAt',
    sort: sort || 'desc'
  }), [keyword, method, fromDate, toDate, sortBy, sort]);

  const fetchRequestLogs = useCallback(async (query: Record<string, any>) => {
    const response = await loggerService.findRequestLogs(query);
    const data = response.data ?? {};
    return {
      data: data.data ?? [],
      total: data.total ?? 0,
      hasMore: data.hasMore ?? false,
      nextCursor: data.nextCursor ?? null,
      paginationInfo: data.paginationInfo
    };
  }, []);

  const getRequestCursor = useCallback((log: IRequestLog | undefined) => {
    if (!log?._id) return null;

    return normalizeCursor({
      id: log._id,
      createdAt: toTimestamp(log.createdAt)
    });
  }, []);

  const {
    items,
    loading,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    onCursorNext,
    loadMore,
    refetch
  } = useCursorPaginatedResource<IRequestLog>({
    page,
    limit,
    filters,
    initialCursor,
    fetcher: fetchRequestLogs,
    getCursorFromItem: getRequestCursor,
    resourceName: 'request logs'
  });

  const deleteRecord = useCallback(async (ids: string[]) => {
    await loggerService.deleteRequestLogs(ids);
    await refetch();
  }, [refetch]);

  return {
    requestLogs: items,
    loading,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    onCursorNext,
    loadMore,
    refetch,
    deleteRecord
  };
};
