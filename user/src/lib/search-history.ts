'use client';

const STORAGE_KEY = 'douyin-clone-search-history';
/**
 * How many terms are kept on disk.
 *
 * Far more than the panel shows: the visible list is a window onto the full history, so deleting a
 * visible chip reveals the next stored one instead of shrinking the list. Still bounded, because
 * localStorage is a fixed budget shared with the rest of the app.
 */
const MAX_ENTRIES = 200;
/** How many of the stored terms the panel renders at once, newest first. */
export const VISIBLE_HISTORY_LIMIT = 10;
const CHANGE_EVENT = 'douyin-clone-search-history-change';

/**
 * Recent search terms, kept client-side only.
 *
 * Deliberately not server-backed: history is per-device convenience, and storing it would mean a
 * collection, an API, and a privacy surface for no user-visible gain at this stage.
 */
export function readSearchHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function write(entries: string[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/** Adds a term, moving an existing match to the front rather than duplicating it. */
export function addSearchHistory(term: string) {
  if (typeof window === 'undefined') return;
  const query = term.trim();
  if (!query) return;

  const existing = readSearchHistory();
  const deduped = existing.filter(item => item.toLowerCase() !== query.toLowerCase());
  write([query, ...deduped].slice(0, MAX_ENTRIES));
}

export function removeSearchHistory(term: string) {
  if (typeof window === 'undefined') return;
  write(readSearchHistory().filter(item => item !== term));
}

export function clearSearchHistory() {
  if (typeof window === 'undefined') return;
  write([]);
}

export function subscribeSearchHistory(callback: () => void) {
  if (typeof window === 'undefined') return () => { };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) callback();
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener('storage', handleStorage);
  };
}
