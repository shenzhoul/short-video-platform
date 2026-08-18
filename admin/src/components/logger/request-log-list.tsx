'use client';

import { ApiOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import MenuAction from '@components/common/list-action';
import { SearchFilter } from '@components/common/search-filter';
import CustomPagination from '@components/ui/pagination';
import { useCursorPaginationState } from '@hooks/use-cursor-pagination-state';
import { useRequestLogs } from '@hooks/use-request-logs';
import { Breadcrumb as BreadcrumbComponent, Page } from "@layout/components";
import { appMessage as message } from '@lib/antd-message';
import { formatDate } from '@lib/date';
import { Button, Card, Modal, Space, Table, Tag, Typography } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { IRequestLog } from 'src/interfaces';

import { LogDetailsModal } from './log-details-modal';

const { Title, Text } = Typography;

const HTTP_METHODS = {
  GET: { color: 'green' },
  POST: { color: 'blue' },
  PUT: { color: 'orange' },
  DELETE: { color: 'red' },
  PATCH: { color: 'purple' },
  HEAD: { color: 'cyan' },
  OPTIONS: { color: 'grey' }
};

const DEFAULT_SORT_FIELD = 'createdAt';
const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'desc';

export default function RequestLogList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const keyword = params?.get('path') || params?.get('q') || '';
  const methodParam = params?.get('method') || params?.get('type') || '';
  const fromDate = params?.get('fromDate') || '';
  const toDate = params?.get('toDate') || '';
  const sortField = params?.get('sortBy') || DEFAULT_SORT_FIELD;
  const sortParam = params?.get('sort');
  const sortOrder = sortParam === 'asc' ? 'asc' : DEFAULT_SORT_ORDER;

  const [selectedLog, setSelectedLog] = useState<IRequestLog | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [deleting, setDeleting] = useState(false);

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
    requestLogs,
    loading,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    onCursorNext,
    deleteRecord
  } = useRequestLogs({
    keyword,
    method: methodParam,
    fromDate,
    toDate,
    sortBy: sortField,
    sort: sortOrder,
    limit: pageSize,
    page: currentPage,
    initialCursor
  });

  const handleViewDetails = useCallback((log: IRequestLog) => {
    setSelectedLog(log);
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedRowKeys.length === 0) return;

    Modal.confirm({
      title: 'Delete Request Logs',
      content: `Are you sure you want to delete ${selectedRowKeys.length} request log${selectedRowKeys.length > 1 ? 's' : ''}? This action cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          setDeleting(true);
          await deleteRecord(selectedRowKeys.map(key => key.toString()));
          message.success(`Successfully deleted ${selectedRowKeys.length} request log${selectedRowKeys.length > 1 ? 's' : ''}`);
          setSelectedRowKeys([]);
        } catch {
          message.error('Failed to delete request logs');
        } finally {
          setDeleting(false);
        }
      }
    });
  }, [selectedRowKeys]);

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys)
  };

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
    if (Object.prototype.hasOwnProperty.call(mappedValues, 'type')) {
      mappedValues.method = mappedValues.type;
      delete mappedValues.type;
    }
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

  const columns: ColumnsType<IRequestLog> = useMemo(() => [
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
      title: 'Method',
      dataIndex: 'method',
      width: 80,
      render: (httpMethod?: string) => {
        const requestMethod = (httpMethod || 'GET').toUpperCase();
        const methodConfig = HTTP_METHODS[requestMethod as keyof typeof HTTP_METHODS] || HTTP_METHODS.GET;

        return (
          <Tag color={methodConfig.color} style={{ fontWeight: 500, fontSize: '11px' }}>
            {requestMethod}
          </Tag>
        );
      }
    },
    {
      title: 'Request Path',
      dataIndex: 'path',
      width: 250,
      sorter: true,
      sortOrder: sortField === 'path' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      render: (requestPath: string) => (
        <Text
          style={{
            fontFamily: 'monospace',
            fontSize: '12px',
            wordBreak: 'break-all'
          }}
          ellipsis={{ tooltip: requestPath }}
        >
          {requestPath.length > 50 ? `${requestPath.substring(0, 50)}...` : requestPath}
        </Text>
      )
    },
    {
      title: 'User',
      dataIndex: 'authData',
      width: 120,
      render: (authData: Record<string, any> | null | undefined) => {
        if (!authData) return <Text type="secondary">Anonymous</Text>;

        const userId = authData.sub || authData.userId || authData._id;
        const userRole = authData.role || 'user';

        return (
          <div>
            <Text style={{ fontSize: '11px' }}>
              {userId ? `${String(userId).slice(-6)}` : 'Unknown'}
            </Text>
            <br />
            <Tag color={userRole === 'admin' ? 'red' : 'blue'} style={{ fontSize: '10px' }}>
              {userRole}
            </Tag>
          </div>
        );
      }
    },
    {
      title: 'IP Address',
      dataIndex: 'ip',
      width: 120,
      render: (ip: string | undefined, record: IRequestLog) => {
        const clientIp = ip ||
          record.headers?.['x-forwarded-for'] ||
          record.headers?.['x-real-ip'] ||
          'Unknown';

        return (
          <Text code style={{ fontSize: '11px' }}>
            {clientIp}
          </Text>
        );
      }
    },
    {
      title: 'User Agent',
      dataIndex: 'userAgent',
      width: 150,
      render: (userAgent: string | undefined, record: IRequestLog) => {
        const ua = userAgent || record.headers?.['user-agent'];
        if (!ua) return <Text type="secondary">N/A</Text>;

        const isBot = /bot|crawler|spider/i.test(ua);
        const isMobile = /mobile|android|iphone/i.test(ua);

        return (
          <div>
            <Text ellipsis={{ tooltip: ua }} style={{ fontSize: '11px' }}>
              {ua.substring(0, 20)}...
            </Text>
            <br />
            {isBot ? <Tag color="orange" style={{ fontSize: '10px' }}>Bot</Tag> : null}
            {isMobile ? <Tag color="purple" style={{ fontSize: '10px' }}>Mobile</Tag> : null}
          </div>
        );
      }
    },
    {
      title: 'Timestamp',
      dataIndex: 'createdAt',
      width: 140,
      sorter: true,
      sortOrder: sortField === 'createdAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      render: (date?: Date | string | null) => (
        <span style={{ fontSize: '12px', color: '#8c8c8c' }}>
          {date ? formatDate(date instanceof Date ? date : new Date(date), 'MMM DD, HH:mm:ss') : 'N/A'}
        </span>
      )
    },
    {
      title: 'Actions',
      width: 80,
      fixed: 'right',
      render: (_: any, record: IRequestLog) => {
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
          { title: 'Request Logs' }
        ]}
      />
      <Card className='card-box'>

        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ApiOutlined style={{ color: '#52c41a' }} />
              Request Logs
            </Title>
            <Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
              Monitor HTTP requests, user activity, and API usage across your application
            </Text>
          </div>
          {selectedRowKeys.length > 0 && (
            <Space>
              <Text type="secondary">
                {selectedRowKeys.length} log{selectedRowKeys.length > 1 ? 's' : ''} selected
              </Text>
              <Button
                type="primary"
                danger
                icon={<DeleteOutlined />}
                onClick={handleDeleteSelected}
                loading={deleting}
              >
                Delete Selected
              </Button>
            </Space>
          )}
        </div>

        <SearchFilter
          onSubmit={handleFilter}
          keyword
          dateRange
          types={[
            { key: 'GET', text: 'GET' },
            { key: 'POST', text: 'POST' },
            { key: 'PUT', text: 'PUT' },
            { key: 'DELETE', text: 'DELETE' },
            { key: 'PATCH', text: 'PATCH' }
          ]}
        />
      </Card>
      <Page>

        <Table<IRequestLog>
          columns={columns}
          dataSource={requestLogs}
          loading={loading}
          rowKey="_id"
          rowSelection={rowSelection}
          pagination={false}
          onChange={handleTableChange}
          scroll={{ x: 1000 }}
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
            showTotal={(totalCount, range) => `${range[0]}-${range[1]} of ${totalCount} requests`}
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
            title={`${(selectedLog.method || 'GET').toUpperCase()} ${selectedLog.path}`}
            onClose={() => setSelectedLog(null)}
          />
        ) : null}
      </Page>
    </>
  );
}
