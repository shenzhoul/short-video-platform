/**
 * Custom Pagination Component
 *
 * A comprehensive pagination component for admin interface with Ant Design integration.
 * Supports both controlled and uncontrolled modes, custom total display, and cursor-based pagination.
 * Includes enhanced cursor-based pagination for deep pagination scenarios (offset > 5000).
 * Includes accessibility features and responsive design.
 *
 * @example
 * // Basic pagination with Ant Design Table
 * <CustomPagination
 *   total={500}
 *   current={currentPage}
 *   pageSize={20}
 *   onChange={(page, pageSize) => setCurrentPage(page)}
 * />
 *
 * // With cursor-based pagination for deep pagination
 * <CustomPagination
 *   total={10000}
 *   current={currentPage}
 *   hasMore={response.hasMore}
 *   nextCursor={response.nextCursor}
 *   paginationInfo={response.paginationInfo}
 *   onCursorNext={(cursor) => fetchNextPage(cursor)}
 *   showCursorNavigation
 * />
 */

import { FastForwardOutlined } from '@ant-design/icons';
import { Alert, Button, Pagination as AntPagination, Space, Tag } from 'antd';
import React, { useCallback, useMemo, useState } from 'react';

export interface PaginationInfo {
  maxOffset: number;
  cursorPaginationAvailable: boolean;
}

export interface NextCursor {
  id: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface CustomPaginationProps {
  // Basic pagination props
  current?: number;
  defaultCurrent?: number;
  pageSize?: number;
  defaultPageSize?: number;
  total?: number;
  pageSizeOptions?: string[];
  showSizeChanger?: boolean;
  showQuickJumper?: boolean;
  showTotal?: (total: number, range: [number, number]) => React.ReactNode;
  onChange?: (page: number, pageSize?: number) => void;
  onShowSizeChange?: (current: number, size: number) => void;
  size?: 'default' | 'small';
  disabled?: boolean;
  hideOnSinglePage?: boolean;
  className?: string;

  // Enhanced pagination props for cursor-based pagination
  hasMore?: boolean;
  nextCursor?: NextCursor | null;
  paginationInfo?: PaginationInfo;
  onCursorNext?: (cursor: NextCursor) => void;
  showCursorNavigation?: boolean;
}

export const CustomPagination: React.FC<CustomPaginationProps> = ({
  current = undefined,
  defaultCurrent = 1,
  pageSize = undefined,
  defaultPageSize = 10,
  total = undefined,
  pageSizeOptions = ['10', '20', '50'],
  showSizeChanger = true,
  showQuickJumper = true,
  showTotal = undefined,
  onChange = undefined,
  onShowSizeChange = undefined,
  size = 'default',
  disabled = false,
  hideOnSinglePage = false,
  className = '',
  // Enhanced pagination props
  hasMore = false,
  nextCursor = null,
  paginationInfo = undefined,
  onCursorNext = undefined,
  showCursorNavigation = true
}) => {
  // Controlled/uncontrolled logic
  const [internalPage, setInternalPage] = useState(defaultCurrent);
  const [internalPageSize, setInternalPageSize] = useState(defaultPageSize);
  const isControlled = current !== undefined;

  const currentPage = isControlled ? current : internalPage;
  const currentPageSize = pageSize !== undefined ? pageSize : internalPageSize;

  // Calculate if we're in deep pagination mode
  const maxOffsetPage = paginationInfo ? Math.ceil(paginationInfo.maxOffset / currentPageSize) : Number.POSITIVE_INFINITY;
  const isDeepPagination = paginationInfo ? currentPage >= maxOffsetPage : false;
  const showDeepPaginationWarning = false; // isDeepPagination && showCursorNavigation;

  const limitedTotal = useMemo(() => {
    if (paginationInfo?.maxOffset) {
      if (typeof total === 'number') {
        return Math.min(total, paginationInfo.maxOffset);
      }
      return paginationInfo.maxOffset;
    }
    return typeof total === 'number' ? total : undefined;
  }, [paginationInfo, total]);

  const baseTotal = useMemo(() => {
    if (typeof limitedTotal === 'number') {
      return limitedTotal;
    }
    if (paginationInfo?.maxOffset) {
      return paginationInfo.maxOffset;
    }
    return 0;
  }, [limitedTotal, paginationInfo]);

  const paginationTotal = useMemo(() => {
    let computedTotal = baseTotal;
    const minimumVisibleTotal = currentPage * currentPageSize;

    if (minimumVisibleTotal > computedTotal) {
      computedTotal = minimumVisibleTotal;
    }

    if (showCursorNavigation && hasMore && isDeepPagination) {
      computedTotal = Math.max(computedTotal, minimumVisibleTotal + currentPageSize);
    }

    return computedTotal;
  }, [baseTotal, currentPage, currentPageSize, showCursorNavigation, hasMore, isDeepPagination]);

  // Handle page change
  const handlePageChange = useCallback((page: number, newPageSize?: number) => {
    const pageSizeValue = newPageSize || currentPageSize;

    if (!isControlled) {
      setInternalPage(page);
      if (newPageSize !== undefined) {
        setInternalPageSize(pageSizeValue);
      }
    }

    onChange?.(page, pageSizeValue);
  }, [currentPageSize, isControlled, onChange]);

  // Handle page size change
  const handlePageSizeChange = useCallback((page: number, newSize: number) => {
    if (!isControlled) {
      setInternalPageSize(newSize);
      // Reset to page 1 when page size changes
      setInternalPage(1);
    }

    onShowSizeChange?.(1, newSize);
    onChange?.(1, newSize);
  }, [isControlled, onShowSizeChange, onChange]);

  // Handle cursor-based next page
  const handleCursorNext = useCallback(() => {
    if (nextCursor && onCursorNext) {
      onCursorNext(nextCursor);
    }
  }, [nextCursor, onCursorNext]);

  // Calculate total display
  const totalDisplay = useMemo(() => {
    if (!showTotal) return undefined;
    const totalValue = typeof limitedTotal === 'number' ? limitedTotal : undefined;
    if (typeof totalValue !== 'number') return undefined;

    const start = (currentPage - 1) * currentPageSize + 1;
    const end = Math.min(currentPage * currentPageSize, totalValue);

    return showTotal(totalValue, [start, end]);
  }, [showTotal, limitedTotal, currentPage, currentPageSize]);

  const cursorModeSummary = useMemo(() => {
    if (!isDeepPagination) {
      return null;
    }
    const startIndex = (currentPage - 1) * currentPageSize + 1;
    const rawEndIndex = startIndex + currentPageSize - 1;
    const endIndex = typeof total === 'number' ? Math.min(rawEndIndex, total) : rawEndIndex;
    const clampedStart = typeof total === 'number' ? Math.min(startIndex, total) : startIndex;
    const safeStart = Math.max(clampedStart, 1);
    const safeEnd = Math.max(endIndex, safeStart);
    const rangeText = `${safeStart.toLocaleString()}-${safeEnd.toLocaleString()}`;
    const totalPart = typeof total === 'number'
      ? ` of ~${total.toLocaleString()} items`
      : '';

    return `Page ${currentPage.toLocaleString()} · ${rangeText}${totalPart}`;
  }, [isDeepPagination, currentPage, currentPageSize, total]);

  const nextCursorPageLabel = useMemo(() => currentPage + 1, [currentPage]);

  // Don't render if hideOnSinglePage and only one page
  if (hideOnSinglePage && total && total <= currentPageSize) {
    return null;
  }

  return (
    <div className={`admin-pagination ${className}`}>
      {/* Deep pagination warning */}
      {showDeepPaginationWarning ? (
        <Alert
          title="Deep Pagination Mode"
          description={`You've reached the pagination limit (${paginationInfo?.maxOffset} records). Use cursor-based navigation for better performance.`}
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {cursorModeSummary ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Tag color="processing">Deep pagination</Tag>
          <span style={{ color: '#555', fontSize: 12 }}>{cursorModeSummary}</span>
        </div>
      ) : null}

      <Space orientation="vertical" size="small" style={{ width: '100%' }}>
        {/* Total display */}
        {totalDisplay ? (
          <div style={{ color: 'var(--text-color)' }}>
            {totalDisplay}
          </div>
        ) : null}

        <Space wrap>
          {/* Standard Ant Design Pagination */}
          <AntPagination
            current={currentPage}
            pageSize={currentPageSize}
            total={paginationTotal}
            pageSizeOptions={pageSizeOptions}
            showSizeChanger={showSizeChanger}
            showQuickJumper={showQuickJumper}
            onChange={handlePageChange}
            onShowSizeChange={handlePageSizeChange}
            size={size === 'small' ? 'small' : undefined}
            disabled={disabled}
            hideOnSinglePage={false}
          />

          {/* Cursor-based navigation for deep pagination */}
          {showCursorNavigation && isDeepPagination && hasMore && nextCursor ? (
            <Button
              type="primary"
              icon={<FastForwardOutlined />}
              onClick={handleCursorNext}
              disabled={disabled}
            >
              Next Page
              {isDeepPagination ? ` (Page ${nextCursorPageLabel.toLocaleString()})` : ''}
            </Button>
          ) : null}
        </Space>
      </Space>
    </div>
  );
};

export default CustomPagination;
