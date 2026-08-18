/**
 * Table Component
 *
 * A feature-rich data table component with sorting, pagination, responsive design, and custom rendering.
 * Supports row selection, loading states, scrollable content, and various customization options.
 * Includes built-in pagination integration and flexible column configuration.
 *
 * @example
 * // Basic table with data
 * const columns = [
 *   { title: 'Name', dataIndex: 'name', key: 'name' },
 *   { title: 'Age', dataIndex: 'age', key: 'age', sorter: true },
 *   {
 *     title: 'Actions',
 *     key: 'actions',
 *     render: (_, record) => (
 *       <Button onClick={() => edit(record.id)}>Edit</Button>
 *     )
 *   }
 * ];
 *
 * <Table
 *   dataSource={users}
 *   columns={columns}
 *   rowKey="id"
 * />
 *
 * // Table with pagination and sorting
 * <Table
 *   dataSource={products}
 *   columns={productColumns}
 *   pagination={{
 *     current: currentPage,
 *     pageSize: 10,
 *     total: totalProducts,
 *     onChange: handlePageChange
 *   }}
 *   onChange={handleTableChange}
 *   loading={isLoading}
 * />
 *
 * // Scrollable table with fixed columns
 * <Table
 *   dataSource={largeDataset}
 *   columns={columnsWithFixed}
 *   scroll={{ x: 1200, y: 400 }}
 *   bordered
 *   size="small"
 * />
 */
'use client';

import { ReactNode, useEffect, useState } from 'react';

import Pagination, { type CursorInfo, type PaginationInfo } from './pagination';

export interface ColumnType<T> {
  title: ReactNode;
  dataIndex?: keyof T;
  key?: string;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  fixed?: 'left' | 'right';
  render?: (value: any, record: T, index: number) => ReactNode;
  sorter?: boolean | ((a: T, b: T) => number);
  sortDirections?: ('ascend' | 'descend')[];
  defaultSortOrder?: 'ascend' | 'descend';
  responsive?: ('sm' | 'md' | 'lg' | 'xl' | '2xl')[];
}

export interface TablePaginationConfig {
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

export interface TableProps<T> {
  dataSource: T[];
  columns: ColumnType<T>[];
  rowKey?: string | ((record: T) => string);
  pagination?: TablePaginationConfig | false;
  loading?: boolean;
  scroll?: {
    x?: number | string | true;
    y?: number | string;
  };
  onChange?: (
    pagination: any,
    filters: any,
    sorter: any,
    extra: any
  ) => void;
  onRow?: (record: T, index: number) => {
    [key: string]: any;
    onClick?: () => void;
    className?: string;
  };
  bordered?: boolean;
  size?: 'small' | 'middle' | 'large';
  className?: string;
  noData?: ReactNode;
}

export function Table<T extends Record<string, any>>({
  dataSource = [],
  columns = [],
  rowKey = 'key',
  pagination = {},
  loading = false,
  scroll,
  onChange,
  onRow,
  bordered = true,
  size = 'middle',
  className = '',
  noData
}: TableProps<T>) {
  const isPaginationEnabled = pagination !== false;
  const paginationConfig: TablePaginationConfig | undefined = isPaginationEnabled && pagination && typeof pagination === 'object' ? pagination : isPaginationEnabled ? {} : undefined;

  const [internalPage, setInternalPage] = useState(paginationConfig?.current ?? 1);
  const [internalPageSize, setInternalPageSize] = useState(paginationConfig?.pageSize ?? 10);
  const [sortField, setSortField] = useState<keyof T | null>(null);
  const [sortOrder, setSortOrder] = useState<'ascend' | 'descend' | null>(null);

  const controlledPage = paginationConfig?.current;
  const controlledPageSize = paginationConfig?.pageSize;
  const isPageControlled = controlledPage !== undefined;
  const isPageSizeControlled = controlledPageSize !== undefined;

  const currentPage = controlledPage ?? internalPage;
  const currentPageSize = controlledPageSize ?? internalPageSize;

  // Calculate visible data based on pagination and sorting
  // Note: dataSource is expected to contain only items for the current page
  // when pagination is handled externally (e.g., via API). The Table component
  // does not slice the data - it displays dataSource as-is.
  const visibleData = [...dataSource];

  const handleSort = (column: ColumnType<T>) => {
    if (!column.sorter) return;

    const newSortOrder = sortField === column.dataIndex
      ? sortOrder === 'ascend' ? 'descend' : sortOrder === 'descend' ? null : 'ascend'
      : 'ascend';

    setSortField(newSortOrder ? column.dataIndex as keyof T : null);
    setSortOrder(newSortOrder);

    if (onChange) {
      onChange(
        { current: currentPage, pageSize: currentPageSize },
        {},
        { field: column.dataIndex, order: newSortOrder },
        { currentDataSource: dataSource, action: 'sort' }
      );
    }
  };

  // Handle pagination change
  const handlePaginationChange = (page: number, pageSize: number) => {
    if (!isPaginationEnabled) return;

    if (!isPageControlled) {
      setInternalPage(page);
    }

    if (!isPageSizeControlled) {
      setInternalPageSize(pageSize);
    }

    paginationConfig?.onChange?.(page, pageSize);

    if (onChange) {
      onChange(
        { current: page, pageSize },
        {},
        { field: sortField, order: sortOrder },
        { currentDataSource: dataSource, action: 'paginate' }
      );
    }
  };

  const handleCursorNext = () => {
    if (!isPaginationEnabled || !paginationConfig?.onCursorNext || !paginationConfig.nextCursor) {
      return;
    }

    const nextPage = currentPage + 1;

    if (!isPageControlled) {
      setInternalPage(nextPage);
    }

    paginationConfig.onCursorNext(paginationConfig.nextCursor);

    if (onChange) {
      onChange(
        { current: nextPage, pageSize: currentPageSize },
        {},
        { field: sortField, order: sortOrder },
        { currentDataSource: dataSource, action: 'cursor-next' }
      );
    }
  };

  // Generate row key
  const getRowKey = (record: T, index: number): string => {
    if (typeof rowKey === 'function') {
      return rowKey(record);
    }
    return record[rowKey]?.toString() || index.toString();
  };

  // Get cell class names based on column properties and table settings
  const getCellClassName = (column: ColumnType<T>, isHeader = false) => {
    const sizeClasses = {
      small: 'px-2 py-1',
      middle: 'px-3 py-2',
      large: 'px-4 py-3'
    };

    return [
      sizeClasses[size],
      column.align ? `text-${column.align}` : 'text-left',
      bordered ? 'border-b border-border' : '',
      column.fixed === 'left' ? 'sticky left-0 bg-surface z-10' : '',
      column.fixed === 'right' ? 'sticky right-0 bg-surface z-10' : '',
      column.responsive ? column.responsive.map(bp => `hidden ${bp}:table-cell`).join(' ') : '',
      isHeader ? 'font-semibold bg-surface-soft' : ''
    ].filter(Boolean).join(' ');
  };

  // Render sort indicators
  const renderSortIcon = (column: ColumnType<T>) => {
    if (!column.sorter) return null;

    return (
      <span className="inline-flex flex-col ml-1">
        <svg
          className={`w-3 h-3 ${sortField === column.dataIndex && sortOrder === 'ascend' ? 'text-blue-500' : ''}`}
          viewBox="0 0 24 24"
        >
          <path fill="currentColor" d="M7 14l5-5 5 5z" />
        </svg>
        <svg
          className={`w-3 h-3 -mt-1 ${sortField === column.dataIndex && sortOrder === 'descend' ? 'text-blue-500' : ''}`}
          viewBox="0 0 24 24"
        >
          <path fill="currentColor" d="M7 10l5 5 5-5z" />
        </svg>
      </span>
    );
  };
  const paginationClassName = [
    'justify-end',
    paginationConfig?.className
  ].filter(Boolean).join(' ');
  let shouldRenderPagination = Boolean(isPaginationEnabled && paginationConfig && dataSource.length > 0);

  if (shouldRenderPagination && !paginationConfig?.showSizeChanger && paginationConfig.current && paginationConfig.current <= 1 && (paginationConfig.hasMore === false || dataSource.length < (paginationConfig.pageSize || 10))) {
    shouldRenderPagination = false;
  }

  useEffect(() => {
    if (controlledPage !== undefined) {
      setInternalPage(controlledPage);
    }
  }, [controlledPage]);

  useEffect(() => {
    if (controlledPageSize !== undefined) {
      setInternalPageSize(controlledPageSize);
    }
  }, [controlledPageSize]);

  return (
    <div className={`relative overflow-hidden w-full ${className}`}>
      {/* Loading overlay */}
      {loading ? (
        <div className="absolute inset-0 bg-surface/50 flex items-center justify-center z-50">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        </div>
      ) : null}

      {/* Table wrapper */}
      <div
        className={`relative ${scroll?.x ? 'overflow-x-auto' : ''} ${scroll?.y ? 'overflow-y-auto' : ''}`}
        style={{ maxHeight: typeof scroll?.y === 'number' ? `${scroll.y}px` : scroll?.y }}
      >
        <table
          className="w-full border-collapse"
          style={{ minWidth: typeof scroll?.x === 'number' ? `${scroll.x}px` : scroll?.x === true ? '100%' : undefined }}
        >
          {/* Header */}
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column.key || column.dataIndex?.toString() || index}
                  className={[
                    getCellClassName(column, true),
                    column.sorter ? 'cursor-pointer select-none' : ''
                  ].filter(Boolean).join(' ')}
                  style={{ width: column.width }}
                  onClick={column.sorter ? () => handleSort(column) : undefined}
                >
                  <div className={`flex items-center ${column.align === 'center' ? 'justify-center' : 'justify-between'} gap-2 whitespace-nowrap`}>
                    <span>{column.title}</span>
                    {renderSortIcon(column)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {visibleData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-8 opacity-70">
                  {noData || 'No results found'}
                </td>
              </tr>
            ) : (
              visibleData.map((record, index) => {
                const rowProps = onRow ? onRow(record, index) : {};
                return (
                  <tr
                    key={getRowKey(record, index)}
                    className={`hover:bg-surface-soft ${rowProps.className || ''}`}
                    {...rowProps}
                  >
                    {columns.map((column, columnIndex) => (
                      <td
                        key={column.key || column.dataIndex?.toString() || columnIndex}
                        className={getCellClassName(column)}
                      >
                        {column.render
                          ? column.render(column.dataIndex ? record[column.dataIndex as keyof T] : record, record, index)
                          : column.dataIndex
                            ? record[column.dataIndex]
                            : null}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {shouldRenderPagination ? (
        <div className="mt-4">
          <Pagination
            current={currentPage}
            pageSize={currentPageSize}
            total={paginationConfig?.total ?? dataSource.length}
            onChange={handlePaginationChange}
            onCursorNext={paginationConfig?.onCursorNext ? handleCursorNext : undefined}
            hasMore={paginationConfig?.hasMore}
            nextCursor={paginationConfig?.nextCursor ?? null}
            paginationInfo={paginationConfig?.paginationInfo}
            showCursorNavigation={paginationConfig?.showCursorNavigation}
            showSizeChanger={paginationConfig?.showSizeChanger ?? true}
            showQuickJumper={paginationConfig?.showQuickJumper}
            showTotal={paginationConfig?.showTotal}
            showLink={paginationConfig?.showLink}
            baseLinkUrl={paginationConfig?.baseLinkUrl}
            disableLinkRedirect={paginationConfig?.disableLinkRedirect}
            className={paginationClassName}
          />
        </div>
      ) : null}
    </div>
  );
}

export default Table;
