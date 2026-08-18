/**
 * Cursor information for pagination
 */
export interface CursorInfo {
  /** Document ID for cursor-based pagination */
  id: string;
  /** Timestamp for cursor-based pagination */
  createdAt: number;
}

/**
 * Pagination guidance information
 */
export interface PaginationInfo {
  /** Maximum offset allowed for traditional pagination */
  maxOffset: number;
  /** Whether cursor-based pagination is available */
  cursorPaginationAvailable: boolean;
}

/**
 * Pageable data interface with optional enhanced pagination support
 *
 * This interface supports both traditional offset-based pagination
 * and modern cursor-based pagination with additional metadata.
 */
export interface PageableData<T> {
  /** Array of data items */
  data: T[];
  /** Total number of items available */
  total: number;
  /** Cursor information for next page (cursor-based pagination) */
  nextCursor?: CursorInfo | null;
  /** Whether there are more items available */
  hasMore?: boolean;
  /** Pagination guidance and information */
  paginationInfo?: PaginationInfo;
}
