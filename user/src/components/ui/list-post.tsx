'use client';

import { FC, ReactNode } from 'react';

import NoData from './no-data';
import Pagination, { type CursorInfo, type PaginationInfo } from './pagination';

export interface PostListPaginationConfig {
  current?: number;
  pageSize?: number;
  total?: number;
  onChange?: (page: number, pageSize: number) => void;
  showSizeChanger?: boolean;
  showQuickJumper?: boolean;
  showTotal?: (total: number, range: [number, number]) => ReactNode;
  hasMore?: boolean;
  nextCursor?: CursorInfo | null;
  paginationInfo?: PaginationInfo;
  onCursorNext?: (cursor: CursorInfo) => void;
  showCursorNavigation?: boolean;
  showLink?: boolean;
  baseLinkUrl?: string;
  disableLinkRedirect?: boolean;
  className?: string;
}

interface PostListProps {
  data: any[];
  renderItem: (item: any) => ReactNode;
  emptyMessage?: string;
  pagination?: PostListPaginationConfig | false;
  className?: string;
}

const PostList: FC<PostListProps> = ({
  data,
  renderItem,
  emptyMessage,
  pagination = false,
  className = ''
}) => {
  const isPaginationEnabled = pagination !== false;
  const paginationConfig =
    isPaginationEnabled && typeof pagination === 'object' ? pagination : undefined;

  const current = paginationConfig?.current ?? 1;
  const pageSize = paginationConfig?.pageSize ?? 10;
  const total = paginationConfig?.total ?? data.length;

  if (!data || data.length === 0) {
    return <NoData title={emptyMessage || 'No data available'} className="w-full" />;
  }

  const paginationClassName = ['justify-center mt-4', paginationConfig?.className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`space-y-3 ${className}`}>
      {data.map(renderItem)}

      {isPaginationEnabled && total > pageSize ? (
        <Pagination
          current={current}
          pageSize={pageSize}
          total={total}
          onChange={paginationConfig?.onChange}
          onCursorNext={paginationConfig?.onCursorNext}
          hasMore={paginationConfig?.hasMore}
          nextCursor={paginationConfig?.nextCursor}
          paginationInfo={paginationConfig?.paginationInfo}
          showCursorNavigation={paginationConfig?.showCursorNavigation}
          // showSizeChanger={paginationConfig?.showSizeChanger ?? true}
          showQuickJumper={paginationConfig?.showQuickJumper}
          showTotal={paginationConfig?.showTotal}
          showLink={paginationConfig?.showLink}
          baseLinkUrl={paginationConfig?.baseLinkUrl}
          disableLinkRedirect={paginationConfig?.disableLinkRedirect}
          className={`${paginationClassName} flex-col`}
        />
      ) : null}
    </div>
  );
};

export default PostList;
