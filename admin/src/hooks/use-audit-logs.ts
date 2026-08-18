'use client';

import { CursorInfo, normalizeCursor, PaginationInfo } from '@lib/cursor';
import { toTimestamp } from '@lib/date';
import { useCallback, useMemo } from 'react';
import { IAuditLog } from 'src/interfaces';

import { useCursorPaginatedResource } from './use-cursor-paginated-resource';
import { loggerService } from '@services/logger.service';

interface UseAuditLogsProps {
  keyword?: string;
  type?: string;
  action?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  page?: number;
  initialCursor?: CursorInfo | null;
}

interface UseAuditLogsReturn {
  auditLogs: IAuditLog[];
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

export const useAuditLogs = ({
  keyword,
  type,
  action,
  fromDate,
  toDate,
  sortBy,
  sort,
  limit = 20,
  page = 1,
  initialCursor = null
}: UseAuditLogsProps): UseAuditLogsReturn => {
  const filters = useMemo(() => ({
    ...(keyword ? { q: keyword } : {}),
    ...(type ? { type } : {}),
    ...(action ? { action } : {}),
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    sort: sortBy || 'createdAt',
    sortBy: sort || 'desc'
  }), [keyword, type, action, fromDate, toDate, sortBy, sort]);

  const fetchAuditLogs = useCallback(async (query: Record<string, any>) => {
    const response = await loggerService.findAuditLogs(query);
    const data = response.data ?? {};
    return {
      data: data.data ?? [],
      total: data.total ?? 0,
      hasMore: data.hasMore ?? false,
      nextCursor: data.nextCursor ?? null,
      paginationInfo: data.paginationInfo
    };
  }, []);

  const getAuditCursor = useCallback((log: IAuditLog | undefined) => {
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
  } = useCursorPaginatedResource<IAuditLog>({
    page,
    limit,
    filters,
    initialCursor,
    fetcher: fetchAuditLogs,
    getCursorFromItem: getAuditCursor,
    resourceName: 'audit logs'
  });

  const deleteRecord = useCallback(async (ids: string[]) => {
    await loggerService.deleteAuditLogs(ids);
    await refetch();
  }, [refetch]);

  return {
    auditLogs: items,
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
