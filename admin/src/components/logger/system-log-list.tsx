'use client';

import { DeleteOutlined, EyeOutlined, MonitorOutlined } from '@ant-design/icons';
import MenuAction from '@components/common/list-action';
import { SearchFilter } from '@components/common/search-filter';
import CustomPagination from '@components/ui/pagination';
import { useCursorPaginationState } from '@hooks/use-cursor-pagination-state';
import { useSystemLogs } from '@hooks/use-system-logs';
import { Breadcrumb as BreadcrumbComponent, Page } from "@layout/components";
import { appMessage as message } from '@lib/antd-message';
import { formatDate } from '@lib/date';
import { Button, Card, Modal, Space, Table, Tag, Typography } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { ISystemLog } from 'src/interfaces';

import { LogDetailsModal } from './log-details-modal';

const { Title, Text } = Typography;

const LOG_LEVELS = {
  error: { color: 'red', priority: 4 },
  warn: { color: 'orange', priority: 3 },
  info: { color: 'blue', priority: 2 },
  debug: { color: 'green', priority: 1 },
  verbose: { color: 'purple', priority: 0 }
};

const DEFAULT_SORT_FIELD = 'createdAt';
const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'desc';

export default function SystemLogList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const keyword = params?.get('q') || '';
  const levelParam = params?.get('level') || params?.get('type') || '';
  const contextParam = params?.get('context') || '';
  const fromDate = params?.get('fromDate') || '';
  const toDate = params?.get('toDate') || '';
  const sortField = params?.get('sortBy') || DEFAULT_SORT_FIELD;
  const sortParam = params?.get('sort');
  const sortOrder = sortParam === 'asc' ? 'asc' : DEFAULT_SORT_ORDER;

  const [selectedLog, setSelectedLog] = useState<ISystemLog | null>(null);
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
    systemLogs,
    loading,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    onCursorNext,
    deleteRecord
  } = useSystemLogs({
    keyword,
    level: levelParam,
    context: contextParam,
    fromDate,
    toDate,
    sortBy: sortField,
    sort: sortOrder,
    limit: pageSize,
    page: currentPage,
    initialCursor
  });

  const handleViewDetails = useCallback((log: ISystemLog) => {
    setSelectedLog(log);
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedRowKeys.length === 0) return;

    Modal.confirm({
      title: 'Delete System Logs',
      content: `Are you sure you want to delete ${selectedRowKeys.length} system log${selectedRowKeys.length > 1 ? 's' : ''}? This action cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          setDeleting(true);
          await deleteRecord(selectedRowKeys.map(key => key.toString()));
          message.success(`Successfully deleted ${selectedRowKeys.length} system log${selectedRowKeys.length > 1 ? 's' : ''}`);
          setSelectedRowKeys([]);
        } catch {
          message.error('Failed to delete system logs');
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
      mappedValues.level = mappedValues.type;
      delete mappedValues.type;
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

  const columns: ColumnsType<ISystemLog> = useMemo(() => [
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
      title: 'Level',
      dataIndex: 'level',
      width: 90,
      sorter: true,
      sortOrder: sortField === 'level' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      render: (logLevel: string) => {
        const levelConfig = LOG_LEVELS[logLevel?.toLowerCase() as keyof typeof LOG_LEVELS] || LOG_LEVELS.info;
        return (
          <Tag color={levelConfig.color} style={{ fontWeight: 500 }}>
            {logLevel?.toUpperCase()}
          </Tag>
        );
      }
    },
    {
      title: 'Context',
      dataIndex: 'context',
      sorter: true,
      sortOrder: sortField === 'context' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      render: (logContext: string) => (
        <Text style={{
          fontFamily: 'monospace',
          fontSize: '12px',
          background: 'var(--light-color)',
          padding: '2px 6px',
          borderRadius: '3px',
          whiteSpace: 'nowrap'
        }}
        >
          {logContext}
        </Text>
      )
    },
    {
      title: 'Message',
      dataIndex: 'message',
      render: (logMessage: string | Record<string, any>, record: ISystemLog) => {
        const displayMessage = typeof logMessage === 'string'
          ? logMessage
          : JSON.stringify(record).substring(0, 100);

        return (
          <div style={{ maxWidth: 300 }}>
            <Text ellipsis={{ tooltip: displayMessage }} style={{ fontSize: '12px' }}>
              {displayMessage}
            </Text>
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
      render: (date: Date | string | null | undefined, record: ISystemLog) => {
        const fallbackDate = record.timestamp;
        const value = date || fallbackDate;
        if (!value) {
          return <span style={{ fontSize: '12px', color: '#8c8c8c' }}>N/A</span>;
        }
        const parsedDate = value instanceof Date ? value : new Date(value);
        return (
          <span style={{ fontSize: '12px', color: '#8c8c8c' }}>
            {formatDate(parsedDate, 'MMM DD, HH:mm:ss')}
          </span>
        );
      }
    },
    {
      title: 'Actions',
      width: 80,
      fixed: 'right',
      render: (_: any, record: ISystemLog) => {
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
          { title: 'System Logs' }
        ]}
      />
      <Card className='card-box'>

        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <MonitorOutlined style={{ color: '#1890ff' }} />
              System Logs
            </Title>
            <Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
              Monitor system events, application logs, and debug information
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
            { key: 'error', text: 'Error' },
            { key: 'warn', text: 'Warning' },
            { key: 'info', text: 'Info' },
            { key: 'debug', text: 'Debug' },
            { key: 'verbose', text: 'Verbose' }
          ]}
        />
      </Card>
      <Page>
        <Table<ISystemLog>
          columns={columns}
          dataSource={systemLogs}
          loading={loading}
          rowKey="_id"
          rowSelection={rowSelection}
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
            title={`${selectedLog.level.toUpperCase()} - ${selectedLog.context}`}
            onClose={() => setSelectedLog(null)}
          />
        ) : null}
      </Page>
    </>
  );
}
