import type { CursorInfo, PaginatedApiResponse, PaginationInfo } from '@interfaces/pagination';

type SearchParamsInput = Record<string, string | string[] | undefined> | URLSearchParams | undefined;

const DEFAULT_SKIP_KEYS = ['page', 'pageSize', 'offset', 'limit'];
const DEFAULT_FILTER_SKIP_KEYS = ['page', 'pageSize', 'limit', 'offset', 'cursor', 'lastCreatedAt', 'sortBy', 'sort'];
const DEFAULT_ID_KEYS = ['_id', 'id'];
const DEFAULT_CREATED_AT_KEYS = ['createdAt', 'updatedAt'];

const isUrlSearchParams = (value: SearchParamsInput): value is URLSearchParams =>
  typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams;

const pickFirstValue = (record: any, keys: string[]) => {
  if (!record) return undefined;

  for (const key of keys) {
    const candidate = record[key];
    if (candidate !== undefined && candidate !== null) {
      return candidate;
    }
  }

  return undefined;
};

export const buildPaginatedQueryParams = (
  searchParams: SearchParamsInput,
  limit: number,
  offset: number,
  options?: {
    skipKeys?: string[];
  }
) => {
  const query: Record<string, any> = {
    limit,
    offset
  };

  const skipKeySet = new Set<string>([...DEFAULT_SKIP_KEYS, ...(options?.skipKeys ?? [])]);

  if (!searchParams) {
    return query;
  }

  if (isUrlSearchParams(searchParams)) {
    searchParams.forEach((value, key) => {
      if (skipKeySet.has(key)) return;
      if (value === undefined || value === null || value === '') return;
      query[key] = value;
    });

    return query;
  }

  Object.entries(searchParams).forEach(([key, value]) => {
    if (skipKeySet.has(key) || value === undefined || value === null || value === '') {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > 0) {
        [query[key]] = value;
      }
      return;
    }

    query[key] = value;
  });

  return query;
};

const getFirstParamValue = (searchParams: SearchParamsInput, key: string): string | null => {
  if (!searchParams) {
    return null;
  }

  if (isUrlSearchParams(searchParams)) {
    const value = searchParams.get(key);
    return value ?? null;
  }

  const record = searchParams as Record<string, string | string[] | undefined>;
  const raw = record[key];

  if (raw === undefined || raw === null) {
    return null;
  }

  if (Array.isArray(raw)) {
    const candidate = raw.find((item) => item !== undefined && item !== null && item !== '');
    return candidate !== undefined && candidate !== null ? String(candidate) : null;
  }

  return String(raw);
};

const collectFilterParams = (searchParams: SearchParamsInput, skipKeys: Set<string>) => {
  const filters: Record<string, string> = {};

  if (!searchParams) {
    return filters;
  }

  if (isUrlSearchParams(searchParams)) {
    searchParams.forEach((value, key) => {
      if (skipKeys.has(key)) return;
      if (value === undefined || value === null || value === '') return;
      if (!(key in filters)) {
        filters[key] = value;
      }
    });
    return filters;
  }

  Object.entries(searchParams).forEach(([key, value]) => {
    if (skipKeys.has(key) || value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      if (value.length > 0 && value[0] !== undefined && value[0] !== null && value[0] !== '') {
        filters[key] = String(value[0]);
      }
      return;
    }

    const stringValue = String(value);
    if (stringValue !== '') {
      filters[key] = stringValue;
    }
  });

  return filters;
};

export const normalizeCursor = (cursor: unknown): CursorInfo | null => {
  if (!cursor) return null;

  if (typeof cursor === 'string') {
    return {
      id: cursor,
      createdAt: Date.now()
    };
  }

  if (typeof cursor === 'object') {
    const candidate = cursor as Record<string, any>;

    const id = pickFirstValue(candidate, DEFAULT_ID_KEYS) ?? candidate.id ?? candidate._id;

    if (!id) return null;

    const createdAtSource = pickFirstValue(candidate, DEFAULT_CREATED_AT_KEYS) ?? candidate.createdAt ?? candidate.updatedAt ?? Date.now();
    const createdAt = typeof createdAtSource === 'number'
      ? createdAtSource
      : typeof createdAtSource === 'string'
        ? Number.isNaN(Number(createdAtSource))
          ? Date.parse(createdAtSource)
          : Number(createdAtSource)
        : Date.now();

    return {
      id: String(id),
      createdAt: Number.isFinite(createdAt) && !Number.isNaN(createdAt) ? createdAt : Date.now()
    };
  }

  return null;
};

export const buildCursorFromRecord = (
  record: any,
  options?: {
    idKeys?: string[];
    createdAtKeys?: string[];
  }
): CursorInfo | null => {
  if (!record) return null;

  const idKeys = options?.idKeys ?? DEFAULT_ID_KEYS;
  const createdAtKeys = options?.createdAtKeys ?? DEFAULT_CREATED_AT_KEYS;

  const id = pickFirstValue(record, idKeys);
  if (!id) return null;

  const createdAtValue = pickFirstValue(record, createdAtKeys) ?? Date.now();

  return normalizeCursor({
    id,
    createdAt: createdAtValue
  });
};

/**
 * Generic cursor extractor using standard cursor keys.
 * Use this for most entities (posts, products, etc.) that follow standard naming conventions.
 *
 * @param record - Any record object with id and timestamp fields
 * @returns CursorInfo object or null if record is invalid
 */
export const extractCursorFromRecord = <T>(record: T): CursorInfo | null =>
  buildCursorFromRecord(record, {
    idKeys: DEFAULT_ID_KEYS,
    createdAtKeys: DEFAULT_CREATED_AT_KEYS
  });

export interface ParsePaginationSearchParamsOptions {
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSortBy?: string;
  defaultSort?: 'asc' | 'desc';
  filterSkipKeys?: string[];
}

export interface ParsedPaginationSearchParams {
  page: number;
  pageSize: number;
  offset: number;
  sortBy: string;
  sort: 'asc' | 'desc';
  filters: Record<string, string>;
  cursor: CursorInfo | null;
  rawCursor: {
    id: string | null;
    lastCreatedAt: string | null;
  };
}

export const parsePaginationSearchParams = (
  searchParams: SearchParamsInput,
  options: ParsePaginationSearchParamsOptions = {}
): ParsedPaginationSearchParams => {
  const defaultPageSize = options.defaultPageSize ?? 12;
  const defaultPage = options.defaultPage ?? 1;
  const defaultSortBy = options.defaultSortBy ?? '';
  const defaultSort = options.defaultSort ?? 'desc';
  const skipKeys = new Set<string>([...DEFAULT_FILTER_SKIP_KEYS, ...(options.filterSkipKeys ?? [])]);

  const pageParam = getFirstParamValue(searchParams, 'page');
  const pageSizeParam = getFirstParamValue(searchParams, 'pageSize');
  const offsetParam = getFirstParamValue(searchParams, 'offset');
  const sortByParam = getFirstParamValue(searchParams, 'sortBy');
  const sortParam = getFirstParamValue(searchParams, 'sort');
  const cursorId = getFirstParamValue(searchParams, 'cursor');
  const lastCreatedAt = getFirstParamValue(searchParams, 'lastCreatedAt');

  const pageNumber = (() => {
    const parsed = pageParam ? parseInt(pageParam, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPage;
  })();

  const pageSize = (() => {
    const parsed = pageSizeParam ? parseInt(pageSizeParam, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPageSize;
  })();

  const computedOffset = (pageNumber - 1) * pageSize;
  const offset = (() => {
    if (!offsetParam) return computedOffset;
    const parsed = Number(offsetParam);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return computedOffset;
  })();

  const sortBy = sortByParam ?? defaultSortBy;
  const sort: 'asc' | 'desc' = sortParam === 'asc' ? 'asc' : sortParam === 'desc' ? 'desc' : defaultSort;

  const filters = collectFilterParams(searchParams, skipKeys);

  const cursor = cursorId
    ? normalizeCursor({
      id: cursorId,
      createdAt: lastCreatedAt ?? undefined
    })
    : null;

  return {
    page: pageNumber,
    pageSize,
    offset,
    sortBy,
    sort,
    filters,
    cursor,
    rawCursor: {
      id: cursorId,
      lastCreatedAt
    }
  };
};

export const normalizePaginationInfo = (
  payload: any,
  fallbackTotal: number,
  fallbackLimit: number
): PaginationInfo => {
  const info = payload?.paginationInfo;

  if (info && typeof info === 'object') {
    const { maxOffset, cursorPaginationAvailable } = info as PaginationInfo;
    return {
      maxOffset: typeof maxOffset === 'number' ? maxOffset : fallbackTotal,
      cursorPaginationAvailable: typeof cursorPaginationAvailable === 'boolean'
        ? cursorPaginationAvailable
        : Boolean(payload?.nextCursor)
    };
  }

  return {
    maxOffset: fallbackTotal || fallbackLimit,
    cursorPaginationAvailable: Boolean(payload?.nextCursor)
  };
};

export const synthesizeCursorFromItems = <T>(
  items: T[],
  itemToCursor: (item: T) => CursorInfo | null
): CursorInfo | null => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const cursor = itemToCursor(items[index]);
    if (cursor) {
      return cursor;
    }
  }

  return null;
};

export interface EnhancePaginatedResponseOptions<T> {
  offset: number;
  limit: number;
  itemToCursor?: (item: T) => CursorInfo | null;
}

export const enhancePaginatedResponse = <T>(
  payload: any,
  options: EnhancePaginatedResponseOptions<T>
): PaginatedApiResponse<T> => {
  const { offset, limit, itemToCursor } = options;
  const safePayload = payload ?? {};
  const data: T[] = Array.isArray(safePayload.data) ? safePayload.data : [];

  const explicitTotal = typeof safePayload.total === 'number' && Number.isFinite(safePayload.total)
    ? safePayload.total
    : null;

  const baseTotal = explicitTotal ?? (offset + data.length);

  let paginationInfo = normalizePaginationInfo(safePayload, baseTotal, limit);
  const baseCursor = normalizeCursor(safePayload.nextCursor ?? null);

  let hasMore: boolean;
  if (typeof safePayload.hasMore === 'boolean') {
    hasMore = safePayload.hasMore;
  } else if (explicitTotal !== null) {
    hasMore = (offset + data.length) < explicitTotal;
  } else if (paginationInfo.cursorPaginationAvailable || baseCursor) {
    hasMore = true;
  } else {
    hasMore = data.length >= limit;
  }

  let effectiveCursor = baseCursor;
  const isDeepPagination = typeof paginationInfo.maxOffset === 'number' && (offset + limit) > paginationInfo.maxOffset;

  if (!effectiveCursor && hasMore && isDeepPagination && itemToCursor) {
    const syntheticCursor = synthesizeCursorFromItems(data, itemToCursor);
    if (syntheticCursor) {
      effectiveCursor = syntheticCursor;
      paginationInfo = {
        ...paginationInfo,
        cursorPaginationAvailable: true
      };
    }
  }

  let total = explicitTotal ?? baseTotal;

  // Only use maxOffset if no explicit total is provided
  if (!explicitTotal && typeof paginationInfo.maxOffset === 'number') {
    total = Math.max(total, paginationInfo.maxOffset);
  }

  total = Math.max(total, offset + data.length);

  if (hasMore) {
    total = Math.max(total, offset + limit);
  }

  return {
    data,
    total,
    hasMore,
    nextCursor: effectiveCursor,
    paginationInfo
  };
};
