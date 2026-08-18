'use client';

import { PlusOutlined } from '@ant-design/icons';
import { SearchFilter } from '@components/common/search-filter';
import CustomPagination from '@components/ui/pagination';
import UserActions from '@components/user/user-actions';
import UserRoleTags from '@components/user/user-role-tags';
import UserStatusTag from '@components/user/user-status-tag';
import { useCursorPaginationState } from '@hooks/use-cursor-pagination-state';
import { useUsers } from '@hooks/use-users';
import { Breadcrumb as BreadcrumbComponent, Page } from "@layout/components";
import { formatDate } from '@lib/date';
import { Avatar, Button, Card, Col, Row, Table, Tag } from 'antd';
import { ColumnProps } from 'antd/es/table';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { IUser } from 'src/interfaces';

export default function UserList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Search parameters
  const q = params?.get('q') || '';
  const isAdmin = params?.get('isAdmin') || '';
  const status = params?.get('status') || '';

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

  // Use cursor pagination hook
  const {
    users,
    loading: isLoading,
    total,
    hasMore,
    nextCursor,
    paginationInfo,
    onCursorNext
  } = useUsers({
    keyword: q,
    status,
    isAdmin: (isAdmin && isAdmin === 'true') ? true : isAdmin === 'false' ? false : undefined,
    limit: pageSize,
    page: currentPage,
    initialCursor
  });

  const applyFilterChanges = useCallback((changes: Record<string, any>) => {
    const currentEntries = Object.fromEntries(params?.entries() || []);
    const merged: Record<string, string | null | undefined> = {
      ...currentEntries,
      ...changes
    };

    delete merged.page;
    delete merged.pageSize;
    delete merged.limit;
    delete merged.cursor;
    delete merged.lastCreatedAt;
    delete merged.lastUpdatedAt;

    // Handle role filter - convert to isAdmin and ensure proper cleanup
    if (Object.prototype.hasOwnProperty.call(changes, 'role')) {
      const roleValue = changes.role;
      if (!roleValue || roleValue === '') {
        delete merged.isAdmin;
        merged.isAdmin = undefined;
      } else {
        merged.isAdmin = roleValue;
      }
      delete merged.role;
    } else if (Object.prototype.hasOwnProperty.call(merged, 'role')) {
      const roleValue = merged.role;
      if (!roleValue || roleValue === '') {
        delete merged.isAdmin;
        merged.isAdmin = undefined;
      } else {
        merged.isAdmin = roleValue;
      }
      delete merged.role;
    }

    const normalized: Record<string, string | null | undefined> = {};
    Object.entries(merged).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        normalized[key] = undefined;
      } else {
        normalized[key] = String(value);
      }
    });

    updateParams(normalized, { resetPage: true, clearCursor: true });
  }, [params, updateParams]);

  // Update URL on filter
  const handleFilter = useCallback((values: any) => {
    applyFilterChanges(values);
  }, [applyFilterChanges]);

  // Navigate to create page
  const handleCreateUser = useCallback(() => {
    router.push('/identity/users/create');
  }, [router]);

  // Table columns
  const columns: ColumnProps<IUser>[] = useMemo(() => [
    {
      title: 'Avatar',
      dataIndex: 'avatar',
      width: 80,
      render: (avatar: string, record: IUser) => (
        <Avatar
          src={avatar || '/no-avatar.png'}
          alt={record.name || record.username}
          size={40}
        />
      )
    },
    {
      title: 'Display Name',
      dataIndex: 'name',
      sorter: true,
      render: (name: string, record: IUser) => name || record.username || 'N/A'
    },
    {
      title: 'Username',
      dataIndex: 'username',
      sorter: true
    },
    {
      title: 'Email Address',
      dataIndex: 'email',
      sorter: true
    },
    {
      title: 'Roles',
      key: 'roles',
      render: (_, record: any) => (
        <UserRoleTags
          isAdmin={record.isAdmin}
          username={record.username}
        />
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (statusValue: string) => <UserStatusTag status={statusValue} />
    },
    {
      title: 'Email Verified',
      dataIndex: 'verifiedEmail',
      render: (verified: boolean) => (
        <Tag color={verified ? 'green' : 'red'}>
          {verified ? 'Yes' : 'No'}
        </Tag>
      )
    },
    {
      title: 'Updated On',
      dataIndex: 'updatedAt',
      sorter: true,
      render: (date: Date) => <span>{formatDate(date)}</span>
    },
    {
      title: 'Actions',
      dataIndex: '_id',
      width: 100,
      render: (id: string, record: IUser) => (
        <UserActions
          userId={id}
          userName={record.name || record.username}
          userStatus={record.status}
        />
      )
    }
  ], []);

  // Status filter options
  const statusOptions = useMemo(() => [
    { key: '', text: 'All Status' },
    { key: 'active', text: 'Active' },
    { key: 'inactive', text: 'Inactive' },
    { key: 'deleted', text: 'Deleted' }
  ], []);

  // Admin filter options
  const adminOptions = useMemo(() => [
    { key: '', text: 'All Users' },
    { key: 'true', text: 'Admins Only' },
    { key: 'false', text: 'Regular Users' }
  ], []);

  return (
    <>
      <BreadcrumbComponent breadcrumbs={[{ title: 'Users' }]} />
      <Card className='card-box'>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={18}>
            <SearchFilter
              keyword
              statuses={statusOptions}
              roles={adminOptions}
              onSubmit={handleFilter}
              initialValues={{
                q,
                status,
                role: isAdmin
              }}
            />
          </Col>

          <Col xs={24} md={6} style={{ textAlign: 'right' }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateUser}
            >
              Create User
            </Button>
          </Col>
        </Row>
      </Card>
      <Page>

        <Table
          dataSource={users}
          columns={columns}
          rowKey="_id"
          loading={isLoading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{
            emptyText: 'No users found. Create your first user to get started!'
          }}
        />

        {/* CustomPagination with cursor support */}
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <CustomPagination
            current={currentPage}
            total={total}
            pageSize={pageSize}
            onChange={(newPage, newSize) => {
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
            }}
            hasMore={hasMore}
            nextCursor={nextCursor}
            paginationInfo={paginationInfo}
            onCursorNext={(cursor) => {
              const nextPage = currentPage + 1;
              pushPage(nextPage, { pageSize, cursor });
              onCursorNext(cursor);
            }}
            showCursorNavigation
          />
        </div>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <span style={{ color: 'var(--color-main)' }}>
            Showing {users.length} of {total} users
          </span>
        </div>
      </Page>
    </>
  );
}
