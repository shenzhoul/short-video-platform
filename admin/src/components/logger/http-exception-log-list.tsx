'use client';

import { ExclamationCircleOutlined, EyeOutlined } from '@ant-design/icons';
import MenuAction from '@components/common/list-action';
import { SearchFilter } from '@components/common/search-filter';
import CustomPagination from '@components/ui/pagination';
import { useCursorPaginationState } from '@hooks/use-cursor-pagination-state';
import { useHttpExceptionLogs } from '@hooks/use-http-exception-logs';
import { Breadcrumb as BreadcrumbComponent, Page } from "@layout/components";
import { formatDate } from '@lib/date';
import { Card, Table, Tag, Typography } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { IHttpExceptionLog } from 'src/interfaces';

import { LogDetailsModal } from './log-details-modal';

const { Title, Text } = Typography;

const DEFAULT_SORT_FIELD = 'createdAt';
const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'desc';

export default function HttpExceptionLogList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const keyword = params?.get('path') || params?.get('q') || '';
  const fromDate = params?.get('fromDate') || '';
  const toDate = params?.get('toDate') || '';
  const sortField = params?.get('sortBy') || DEFAULT_SORT_FIELD;
  const sortParam = params?.get('sort');
  const sortOrder = sortParam === 'asc' ? 'asc' : DEFAULT_SORT_ORDER;

  const [selectedLog, setSelectedLog] = useState<IHttpExceptionLog | null>(null);

  const {
    currentPage,
    pageSize,
    initialCursor,
    pushPage,
    updateParams
  } = useCursorPaginationState({
    params,
    pathname,
    push: router.push,
    defaultPageSize: 10
  });

  const {
    httpExceptionLogs,
    loading,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    onCursorNext
  } = useHttpExceptionLogs({
    keyword,
    fromDate,
    toDate,
    sortBy: sortField,
    sort: sortOrder,
    limit: pageSize,
    page: currentPage,
    initialCursor
  });

  const handleViewDetails = useCallback((log: IHttpExceptionLog) => {
    setSelectedLog(log);
  }, []);

  const normalizeUpdates = useCallback((updates: Record<string, any>) => {
    const normalized: Record<string, string | undefined> = {};
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
        normalized[key] = undefined;
      } else {
        normalized[key] = String(value);
      }
    });
    return normalized;
  }, []);

  const handleFilterChange = useCallback((updates: Record<string, any>) => {
    updateParams(normalizeUpdates(updates), { resetPage: true, clearCursor: true });
  }, [normalizeUpdates, updateParams]);

  const handleFilter = useCallback((values: Record<string, any>) => {
    const mappedValues = { ...values };
    if (Object.prototype.hasOwnProperty.call(mappedValues, 'q')) {
      mappedValues.path = mappedValues.q;
      delete mappedValues.q;
    }
    handleFilterChange(mappedValues);
  }, [handleFilterChange]);

  const handleTableChange = useCallback((_: any, __: any, sorter: any) => {
    const nextField = sorter?.field || DEFAULT_SORT_FIELD;
    const nextOrder = sorter?.order === 'ascend' ? 'asc' : sorter?.order === 'descend' ? 'desc' : DEFAULT_SORT_ORDER;
    handleFilterChange({ sortBy: nextField, sort: nextOrder });
  }, [handleFilterChange]);

  const handlePaginationChange = useCallback((newPage: number, newSize?: number) => {
    const size = newSize ?? pageSize;
    const cursorBoundaryPage = paginationInfo?.maxOffset
      ? Math.ceil(paginationInfo.maxOffset / size)
      : Number.POSITIVE_INFINITY;

    if (paginationInfo && newPage > cursorBoundaryPage && nextCursor) {
      pushPage(newPage, { pageSize: size, cursor: nextCursor });
      onCursorNext(nextCursor);
      return;
    }

    pushPage(newPage, { pageSize: size, cursor: null });
  }, [pageSize, paginationInfo, nextCursor, pushPage, onCursorNext]);

  const columns: ColumnsType<IHttpExceptionLog> = useMemo(() => [
    {
      title: 'Log ID',
      dataIndex: '_id',
      width: 120,
      render: (id: string) => (
        <Text code style={{ fontSize: '11px' }}>
          {id.slice(-8)}
        </Text>
      )
    },
    {
      title: 'Request Path',
      dataIndex: 'path',
      width: 180,
      sorter: true,
      sortOrder: sortField === 'path' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      render: (requestPath: string) => {
        const maxLength = 30;
        const truncatedPath = requestPath.length > maxLength
          ? `${requestPath.substring(0, maxLength)}...`
          : requestPath;

        return (
          <Text
            style={{
              fontFamily: 'monospace',
              fontSize: '12px',
              display: 'block',
              maxWidth: '160px'
            }}
            ellipsis={{ tooltip: requestPath }}
            title={requestPath}
          >
            {truncatedPath}
          </Text>
        );
      }
    },
    {
      title: 'Error Message',
      dataIndex: 'error',
      render: (errorMessage: string) => (
        <div style={{ maxWidth: 300 }}>
          <Text ellipsis={{ tooltip: errorMessage }} style={{ fontSize: '12px' }}>
            {errorMessage?.length > 60 ? `${errorMessage.substring(0, 60)}...` : errorMessage}
          </Text>
        </div>
      )
    },
    {
      title: 'Status',
      dataIndex: 'statusCode',
      width: 80,
      render: (statusCode: number | null | undefined) => (
        <Tag color={statusCode && statusCode >= 500 ? 'red' : statusCode && statusCode >= 400 ? 'orange' : 'green'}>
          {statusCode ?? 'N/A'}
        </Tag>
      )
    },
    {
      title: 'Timestamp',
      dataIndex: 'createdAt',
      width: 140,
      sorter: true,
      sortOrder: sortField === 'createdAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      render: (date: Date | string | null | undefined) => (
        <span style={{ fontSize: '12px', color: '#8c8c8c' }}>
          {date ? formatDate(date instanceof Date ? date : new Date(date), 'MMM DD, HH:mm:ss') : 'N/A'}
        </span>
      )
    },
    {
      title: 'Actions',
      width: 80,
      fixed: 'right',
      render: (_: any, record: IHttpExceptionLog) => {
        const menuOptions = [
          {
            key: 'view',
            label: 'Details',
            icon: <EyeOutlined />,
            onClick: () => handleViewDetails(record)
          }
        ];

        return <MenuAction menuOptions={menuOptions} />;
      }
    }
  ], [handleViewDetails, sortField, sortOrder]);

  return (
    <>
      <BreadcrumbComponent
        breadcrumbs={[
          { title: 'Dashboard', href: '/' },
          { title: 'System Logs', href: '/system/logger/system-logs' },
          { title: 'HTTP Exception Logs' }
        ]}
      />
      <Card className='card-box'>

        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
              HTTP Exception Logs
            </Title>
            <Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
              Monitor and troubleshoot HTTP errors and exceptions in your application
            </Text>
          </div>
        </div>

        <SearchFilter
          onSubmit={handleFilter}
          keyword
          dateRange
        />
      </Card>
      <Page>

        <Table<IHttpExceptionLog>
          columns={columns}
          dataSource={httpExceptionLogs}
          loading={loading}
          rowKey="_id"
          pagination={false}
          onChange={handleTableChange}
          scroll={{ x: 800 }}
          size="small"
        />

        <div style={{ marginTop: 16 }}>
          <CustomPagination
            current={currentPage}
            pageSize={pageSize}
            total={total}
            onChange={handlePaginationChange}
            hasMore={hasMore}
            nextCursor={nextCursor}
            paginationInfo={paginationInfo}
            pageSizeOptions={['10', '20', '50', '100']}
            showTotal={(totalCount, range) => `${range[0]}-${range[1]} of ${totalCount} logs`}
            onCursorNext={(cursor) => {
              const nextPage = currentPage + 1;
              pushPage(nextPage, { pageSize, cursor });
              onCursorNext(cursor);
            }}
            showCursorNavigation
          />
        </div>

        {selectedLog ? (
          <LogDetailsModal
            open
            logData={selectedLog}
            title={selectedLog.path}
            onClose={() => setSelectedLog(null)}
          />
        ) : null}
      </Page>
    </>
  );
}
