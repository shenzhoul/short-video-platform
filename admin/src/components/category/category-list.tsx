'use client';

import { EditOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import MenuAction from '@components/common/list-action';
import { SearchFilter } from '@components/common/search-filter';
import { GenericStatusTag } from '@components/common/status-tag';
import CustomPagination from '@components/ui/pagination';
import { CATEGORY_STATUS_CONFIG } from '@constants/status-configs';
import { useCategories } from '@hooks/use-categories';
import { Breadcrumb as BreadcrumbComponent, Page } from '@layout/components';
import { formatDate } from '@lib/date';
import { Alert, Button, Card, Col, Row, Table, Typography } from 'antd';
import { ColumnProps } from 'antd/es/table';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { ICategory } from 'src/interfaces';

const PAGE_SIZE = 25;

export default function CategoryList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params?.get('q') || '';
  const status = params?.get('status') || '';
  const currentPage = Number(params?.get('page')) || 1;

  const {
    categories,
    loading,
    total,
    disableCategory
  } = useCategories({ q, status, limit: PAGE_SIZE, page: currentPage });

  const updateParams = useCallback((changes: Record<string, string | undefined>, resetPage = true) => {
    const next = new URLSearchParams(params?.toString());
    Object.entries(changes).forEach(([key, value]) => {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    });
    if (resetPage) next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }, [params, pathname, router]);

  const handleFilter = useCallback((values: any) => {
    updateParams({ q: values.q, status: values.status });
  }, [updateParams]);

  const statusOptions = useMemo(() => [
    { key: '', text: 'All statuses' },
    { key: 'active', text: 'Active' },
    { key: 'inactive', text: 'Disabled' }
  ], []);

  const columns: ColumnProps<ICategory>[] = useMemo(() => [
    {
      title: 'Order',
      dataIndex: 'ordering',
      width: 90,
      render: (ordering: number) => <Typography.Text>{ordering ?? 0}</Typography.Text>
    },
    {
      title: 'Name',
      dataIndex: 'name',
      render: (name: string) => <Typography.Text strong>{name}</Typography.Text>
    },
    {
      title: 'Key',
      dataIndex: 'key',
      render: (key: string) => (
        <Typography.Text code copyable={{ text: key }}>{key}</Typography.Text>
      )
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (description: string) => (
        description
          ? <Typography.Text type="secondary">{description}</Typography.Text>
          : <Typography.Text type="secondary">—</Typography.Text>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (value: string) => (
        <GenericStatusTag status={value} statusConfig={CATEGORY_STATUS_CONFIG} />
      )
    },
    {
      title: 'Updated On',
      dataIndex: 'updatedAt',
      width: 180,
      render: (date: Date) => <span>{formatDate(date)}</span>
    },
    {
      title: 'Actions',
      dataIndex: '_id',
      width: 100,
      render: (id: string, record: ICategory) => (
        <MenuAction
          menuOptions={[
            {
              key: 'edit',
              label: 'Edit',
              icon: <EditOutlined />,
              href: `/content/categories/update/${id}`
            },
            {
              key: 'disable',
              label: 'Disable',
              icon: <StopOutlined />,
              danger: true,
              visible: record.status === 'active',
              confirm: {
                title: `Disable "${record.name}"?`,
                content: 'Creators will no longer be able to choose it and it disappears from the home category bar. Posts already filed under it keep working, and you can re-enable it at any time.',
                okText: 'Yes, disable'
              },
              onClick: () => void disableCategory(record)
            }
          ]}
        />
      )
    }
  ], [disableCategory]);

  return (
    <>
      <BreadcrumbComponent breadcrumbs={[{ title: 'Content' }, { title: 'Categories' }]} />

      <Card className="card-box">
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="Categories are never deleted"
          description="Every post stores its category key, so a category is disabled rather than removed. A disabled category stops being offered to creators while existing posts keep working."
        />
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={18}>
            <SearchFilter
              keyword
              statuses={statusOptions}
              onSubmit={handleFilter}
              initialValues={{ q, status }}
            />
          </Col>
          <Col xs={24} md={6} style={{ textAlign: 'right' }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => router.push('/content/categories/create')}
            >
              Create Category
            </Button>
          </Col>
        </Row>
      </Card>

      <Page>
        <Table
          dataSource={categories}
          columns={columns}
          rowKey="_id"
          loading={loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'No categories match this filter.' }}
        />

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <CustomPagination
            current={currentPage}
            total={total}
            pageSize={PAGE_SIZE}
            onChange={(page) => updateParams({ page: String(page) }, false)}
          />
        </div>
      </Page>
    </>
  );
}
