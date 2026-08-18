/**
 * Global pagination interfaces for cursor-based pagination implementation
 * Used across all table components in the application
 */

export interface CursorInfo {
  id: string;
  createdAt: number;
  isPinned?: boolean;
  pinnedAt?: number | null;
}

export interface PaginationInfo {
  maxOffset: number;
  cursorPaginationAvailable: boolean;
}

/**
 * Enhanced API response structure that supports both traditional and cursor-based pagination
 * @template T - The type of data items in the response
 */
export interface PaginatedApiResponse<T = any> {
  data: T[];
  total?: number; // undefined when using cursor pagination
  hasMore?: boolean; // true when more records available (cursor mode)
  nextCursor?: CursorInfo | null; // cursor for next page
  paginationInfo: PaginationInfo; // pagination guidance information
}
