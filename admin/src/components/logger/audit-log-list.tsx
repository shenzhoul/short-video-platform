"use client";

import { AuditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import MenuAction from '@components/common/list-action';
import { SearchFilter } from '@components/common/search-filter';
import CustomPagination from '@components/ui/pagination';
import { useAuditLogs } from '@hooks/use-audit-logs';
import { useCursorPaginationState } from '@hooks/use-cursor-pagination-state';
import { Breadcrumb as BreadcrumbComponent, Page } from "@layout/components";
import { appMessage as message } from '@lib/antd-message';
import { formatDate } from '@lib/date';
import { Button, Card, Modal, Space, Table, Tag, Typography } from 'antd';
import { ColumnsType } from 'antd/es/table';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { useCallback, useMemo, useState } from 'react';
import { IAuditLog } from 'src/interfaces';

import { LogDetailsModal } from './log-details-modal';

const { Title, Text } = Typography;

const AUDIT_TYPES = {
  auth: { color: 'blue', label: 'Authentication' },
  payment: { color: 'green', label: 'Payment' },
  payment_restriction: { color: 'orange', label: 'Payment Restriction' },
  dispute_action: { color: 'red', label: 'Dispute Action' },
  content: { color: 'purple', label: 'Content' },
  user: { color: 'cyan', label: 'User' },
  system: { color: 'default', label: 'System' }
};

const DEFAULT_SORT_FIELD = 'createdAt';
const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'desc';

export default function AuditLogList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const keyword = params?.get('q') || '';
  const typeParam = params?.get('type') || '';
  const actionParam = params?.get('action') || '';
  const fromDate = params?.get('fromDate') || '';
  const toDate = params?.get('toDate') || '';
  const sortField = params?.get('sort') || DEFAULT_SORT_FIELD;
  const sortOrderParam = params?.get('sortBy');
  const sortOrder = sortOrderParam === 'asc' ? 'asc' : sortOrderParam === 'desc' ? 'desc' : DEFAULT_SORT_ORDER;

  const [selectedLog, setSelectedLog] = useState<IAuditLog | null>(null);
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
    defaultPageSize: 20,
    pageSizeParam: 'limit',
    limitParam: 'limit'
  });

  const {
    auditLogs,
    loading,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    onCursorNext,
    deleteRecord
  } = useAuditLogs({
    keyword,
    type: typeParam,
    action: actionParam,
    fromDate,
    toDate,
    sortBy: sortField,
    sort: sortOrder,
    limit: pageSize,
    page: currentPage,
    initialCursor
  });

  const handleViewDetails = useCallback((log: IAuditLog) => {
    setSelectedLog(log);
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedRowKeys.length === 0) return;

    Modal.confirm({
      title: 'Delete Audit Logs',
      content: `Are you sure you want to delete ${selectedRowKeys.length} audit log${selectedRowKeys.length > 1 ? 's' : ''}? This action cannot be undone and may impact compliance.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          setDeleting(true);
          await deleteRecord(selectedRowKeys.map(key => key.toString()));
          message.success(`Successfully deleted ${selectedRowKeys.length} audit log${selectedRowKeys.length > 1 ? 's' : ''}`);
          setSelectedRowKeys([]);
        } catch {
          message.error('Failed to delete audit logs');
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
    handleFilterChange(values);
  }, [handleFilterChange]);

  const handleTableChange = useCallback((_: any, __: any, sorter: any) => {
    const nextField = sorter?.field || DEFAULT_SORT_FIELD;
    const nextOrder = sorter?.order === 'ascend' ? 'asc' : sorter?.order === 'descend' ? 'desc' : DEFAULT_SORT_ORDER;
    handleFilterChange({ sort: nextField, sortBy: nextOrder });
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

  const columns: ColumnsType<IAuditLog> = useMemo(() => [
    {
      title: 'Timestamp',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      sorter: true,
      sortOrder: sortField === 'createdAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : undefined,
      render: (date?: Date | string | null) => {
        if (!date) {
          return <Text type="secondary">N/A</Text>;
        }
        const parsed = date instanceof Date ? date : new Date(date);
        return formatDate(parsed, 'll HH:mm:ss');
      }
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 150,
      render: (type: string) => {
        const config = AUDIT_TYPES[type as keyof typeof AUDIT_TYPES] || AUDIT_TYPES.system;
        return <Tag color={config.color}>{config.label}</Tag>;
      }
    },
    {
      title: 'Action',
      dataIndex: 'action',
      key: 'action',
      width: 150,
      render: (action: string) => (
        <Tag color="processing">{action}</Tag>
      )
    },
    {
      title: 'User ID',
      dataIndex: 'userId',
      key: 'userId',
      width: 200,
      render: (userId?: string | null) => (
        <Text code>{userId || 'N/A'}</Text>
      )
    },
    {
      title: 'Details',
      dataIndex: 'data',
      key: 'data',
      ellipsis: true,
      render: (data?: Record<string, any> | null) => {
        if (!data) return <Text type="secondary">No additional data</Text>;

        const preview = JSON.stringify(data).substring(0, 100);
        return (
          <Text type="secondary" ellipsis>
            {preview}{preview.length >= 100 ? '...' : ''}
          </Text>
        );
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_: any, record: IAuditLog) => {
        const menuOptions = [
          {
            key: 'view',
            label: 'View',
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
          { title: 'Dashboard', href: '/dashboard' },
          { title: 'System logs', href: '/system/logger/system-logs' },
          { title: 'Audit Logs' }
        ]}
      />

      <Card className='card-box'>
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Title level={3} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AuditOutlined style={{ color: '#1890ff' }} />
              Audit Logs
            </Title>
            <Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
              Track user actions, system events, and administrative operations for compliance and debugging
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
            { key: 'auth', text: 'Authentication' },
            { key: 'payment', text: 'Payment' },
            { key: 'payment_restriction', text: 'Payment Restriction' },
            { key: 'dispute_action', text: 'Dispute Action' },
            { key: 'content', text: 'Content' },
            { key: 'user', text: 'User' },
            { key: 'system', text: 'System' }
          ]}
        />
      </Card>

      <Page>
        <Table<IAuditLog>
          columns={columns}
          dataSource={auditLogs}
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
            showTotal={(totalCount, range) => `${range[0]}-${range[1]} of ${totalCount} audit logs`}
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
            title={`${selectedLog.type} - ${selectedLog.action}`}
            onClose={() => setSelectedLog(null)}
          />
        ) : null}
      </Page>
    </>
  );
}
