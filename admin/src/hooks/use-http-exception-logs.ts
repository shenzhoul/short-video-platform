'use client';

import { CursorInfo, normalizeCursor, PaginationInfo } from '@lib/cursor';
import { toTimestamp } from '@lib/date';
import { loggerService } from '@services/logger.service';
import { useCallback, useMemo } from 'react';
import { IHttpExceptionLog } from 'src/interfaces';

import { useCursorPaginatedResource } from './use-cursor-paginated-resource';

interface UseHttpExceptionLogsProps {
  keyword?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  page?: number;
  initialCursor?: CursorInfo | null;
}

interface UseHttpExceptionLogsReturn {
  httpExceptionLogs: IHttpExceptionLog[];
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

export const useHttpExceptionLogs = ({
  keyword,
  fromDate,
  toDate,
  sortBy,
  sort,
  limit = 10,
  page = 1,
  initialCursor = null
}: UseHttpExceptionLogsProps): UseHttpExceptionLogsReturn => {
  const filters = useMemo(() => ({
    ...(keyword ? { path: keyword, q: keyword } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    sortBy: sortBy || 'createdAt',
    sort: sort || 'desc'
  }), [keyword, fromDate, toDate, sortBy, sort]);

  const fetchLogs = useCallback(async (query: Record<string, any>) => {
    const response = await loggerService.findHttpExceptionLogs(query);
    const data = response.data ?? {};
    return {
      data: data.data ?? [],
      total: data.total ?? 0,
      hasMore: data.hasMore ?? false,
      nextCursor: data.nextCursor ?? null,
      paginationInfo: data.paginationInfo
    };
  }, []);

  const getLogCursor = useCallback((log: IHttpExceptionLog | undefined) => {
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
  } = useCursorPaginatedResource<IHttpExceptionLog>({
    page,
    limit,
    filters,
    initialCursor,
    fetcher: fetchLogs,
    getCursorFromItem: getLogCursor,
    resourceName: 'HTTP exception logs'
  });

  const deleteRecord = useCallback(async (ids: string[]) => {
    await loggerService.deleteHttpExceptionLogs(ids);
    await refetch();
  }, [refetch]);

  return {
    httpExceptionLogs: items,
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
