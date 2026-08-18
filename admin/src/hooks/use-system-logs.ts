'use client';

import { useCursorPaginatedResource } from '@hooks/use-cursor-paginated-resource';
import { CursorInfo, normalizeCursor, PaginationInfo } from '@lib/cursor';
import { toTimestamp } from '@lib/date';
import { loggerService } from '@services/logger.service';
import { useCallback, useMemo } from 'react';
import { ISystemLog } from 'src/interfaces';

interface UseSystemLogsProps {
  keyword?: string;
  level?: string;
  context?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  page?: number;
  initialCursor?: CursorInfo | null;
}

interface UseSystemLogsReturn {
  systemLogs: ISystemLog[];
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

export const useSystemLogs = ({
  keyword,
  level,
  context,
  fromDate,
  toDate,
  sortBy,
  sort,
  limit = 10,
  page = 1,
  initialCursor = null
}: UseSystemLogsProps): UseSystemLogsReturn => {
  const filters = useMemo(() => ({
    ...(keyword ? { q: keyword } : {}),
    ...(level ? { level } : {}),
    ...(context ? { context } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    sortBy: sortBy || 'createdAt',
    sort: sort || 'desc'
  }), [keyword, level, context, fromDate, toDate, sortBy, sort]);

  const fetchSystemLogs = useCallback(async (query: Record<string, any>) => {
    const response = await loggerService.findSystemLogs(query);
    const data = response.data ?? {};
    return {
      data: data.data ?? [],
      total: data.total ?? 0,
      hasMore: data.hasMore ?? false,
      nextCursor: data.nextCursor ?? null,
      paginationInfo: data.paginationInfo
    };
  }, []);

  const getSystemCursor = useCallback((log: ISystemLog | undefined) => {
    if (!log?._id) return null;

    return normalizeCursor({
      id: log._id,
      createdAt: toTimestamp(log.createdAt) ?? toTimestamp(log.timestamp)
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
  } = useCursorPaginatedResource<ISystemLog>({
    page,
    limit,
    filters,
    initialCursor,
    fetcher: fetchSystemLogs,
    getCursorFromItem: getSystemCursor,
    resourceName: 'system logs'
  });

  const deleteRecord = useCallback(async (ids: string[]) => {
    await loggerService.deleteSystemLogs(ids);
    await refetch();
  }, [refetch]);

  return {
    systemLogs: items,
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
