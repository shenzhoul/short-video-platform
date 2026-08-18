import { HomeOutlined } from '@ant-design/icons';
import type { BreadcrumbProps } from 'antd';
import { Breadcrumb } from 'antd';
import type { Key } from 'react';

type BreadcrumbDataItem = NonNullable<BreadcrumbProps['items']>[number];

interface IBreadcrumbProps {
  items?: BreadcrumbDataItem[];
  breadcrumbs?: BreadcrumbDataItem[];
  showHome?: boolean;
}

const getBreadcrumbKey = (
  key: BreadcrumbDataItem['key'] | undefined,
  index: number
): Key => {
  if (typeof key === 'symbol') {
    return key.description || `breadcrumb-${index}`;
  }

  return key ?? `breadcrumb-${index}`;
};

export default function BreadcrumbComponent({
  items = undefined,
  breadcrumbs = undefined,
  showHome = true
}: IBreadcrumbProps) {
  // Support both 'items' and 'breadcrumbs' props for backward compatibility
  const breadcrumbData = items || breadcrumbs || [];

  // Ensure all items have keys
  const normalizedItems: BreadcrumbDataItem[] = breadcrumbData.map((item, index) => ({
    ...item,
    key: getBreadcrumbKey(item.key, index)
  }));

  const breadcrumbItems: BreadcrumbProps['items'] = showHome
    ? [
      {
        key: 'home',
        title: <HomeOutlined />,
        href: '/'
      },
      ...normalizedItems
    ]
    : normalizedItems;

  // Transform items to include proper rendering
  const processedItems: BreadcrumbProps['items'] = breadcrumbItems?.map((item) => ({
    ...item
  }));

  return (
    <div style={{ marginBottom: '16px' }}>
      <Breadcrumb items={processedItems} />
    </div>
  );
}
