export interface CursorInfo {
  id: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface PaginationInfo {
  maxOffset: number;
  cursorPaginationAvailable: boolean;
}

type ReadonlySearchParams = {
  get(name: string): string | null;
};

export function parseCursorFromParams(params?: ReadonlySearchParams | null): CursorInfo | null {
  if (!params) return null;

  const cursorId = params.get('cursor');
  if (!cursorId) return null;

  const cursor: CursorInfo = { id: cursorId };

  const createdAtParam = params.get('lastCreatedAt');
  if (createdAtParam) {
    const createdAtMs = Number(createdAtParam);
    if (!Number.isNaN(createdAtMs)) {
      cursor.createdAt = createdAtMs;
    }
  }

  const updatedAtParam = params.get('lastUpdatedAt');
  if (updatedAtParam) {
    const updatedAtMs = Number(updatedAtParam);
    if (!Number.isNaN(updatedAtMs)) {
      cursor.updatedAt = updatedAtMs;
    }
  }

  return cursor;
}

export function setCursorParams(params: URLSearchParams, cursor: CursorInfo | null | undefined) {
  if (!cursor) {
    params.delete('cursor');
    params.delete('lastCreatedAt');
    params.delete('lastUpdatedAt');
    return;
  }

  params.set('cursor', cursor.id);

  if (cursor.createdAt) {
    params.set('lastCreatedAt', cursor.createdAt.toString());
  } else {
    params.delete('lastCreatedAt');
  }

  if (cursor.updatedAt) {
    params.set('lastUpdatedAt', cursor.updatedAt.toString());
  } else {
    params.delete('lastUpdatedAt');
  }
}

export function clearCursorParams(params: URLSearchParams) {
  params.delete('cursor');
  params.delete('lastCreatedAt');
  params.delete('lastUpdatedAt');
}

export function normalizeCursor(rawCursor: any): CursorInfo | null {
  if (!rawCursor) return null;

  const id = typeof rawCursor === 'string' ? rawCursor : rawCursor.id;
  if (!id) return null;

  const normalized: CursorInfo = { id };

  const rawCreatedAt = rawCursor.createdAt ?? rawCursor.lastCreatedAt;
  if (rawCreatedAt) {
    const created = typeof rawCreatedAt === 'number' ? rawCreatedAt : new Date(rawCreatedAt).getTime();
    if (!Number.isNaN(created)) normalized.createdAt = created;
  }

  const rawUpdatedAt = rawCursor.updatedAt ?? rawCursor.lastUpdatedAt;
  if (rawUpdatedAt) {
    const updated = typeof rawUpdatedAt === 'number' ? rawUpdatedAt : new Date(rawUpdatedAt).getTime();
    if (!Number.isNaN(updated)) normalized.updatedAt = updated;
  }

  return normalized;
}
