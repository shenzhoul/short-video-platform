'use client';

import { IPost } from '@interfaces/post';
import { IUser } from '@interfaces/user';
import {
  type ITagSearchResult,
  searchAll,
  type SearchAllResult,
  searchByType,
  type SearchPage
} from '@services/search.service';
import { useCallback, useEffect, useRef, useState } from 'react';

const PAGE_LIMIT = 20;

export type SearchTabKey = 'summary' | 'video' | 'user';

const TAB_TO_TYPE: Record<Exclude<SearchTabKey, 'summary'>, 'post' | 'user'> = {
  video: 'post',
  user: 'user'
};

interface SearchResultsState {
  summary: SearchAllResult | null;
  posts: IPost[];
  users: IUser[];
  tags: ITagSearchResult[];
  hasMore: boolean;
  total: number | null;
}

const EMPTY: SearchResultsState = {
  summary: null,
  posts: [],
  users: [],
  tags: [],
  hasMore: false,
  total: null
};

/**
 * Drives the search results page. The Summary tab loads one combined payload; the Videos and Users
 * tabs paginate their own vertical.
 */
export function useSearchResults(query: string, tab: SearchTabKey) {
  const [state, setState] = useState<SearchResultsState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  // Guards against a slow response for a previous query/tab overwriting the current one.
  const requestKeyRef = useRef('');

  const fetchPage = useCallback(async (reset: boolean) => {
    const trimmed = query.trim();
    if (!trimmed || loadingRef.current) return;

    const requestKey = `${trimmed}:${tab}`;
    if (reset) {
      offsetRef.current = 0;
      requestKeyRef.current = requestKey;
    } else if (requestKeyRef.current !== requestKey) {
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      if (tab === 'summary') {
        const response = await searchAll(trimmed);
        if (requestKeyRef.current !== requestKey) return;
        const summary = response?.data as SearchAllResult;
        setState({
          summary,
          posts: summary?.posts?.data || [],
          users: summary?.users?.data || [],
          tags: summary?.tags?.data || [],
          hasMore: false,
          total: null
        });
        return;
      }

      const response = await searchByType(trimmed, TAB_TO_TYPE[tab], PAGE_LIMIT, offsetRef.current);
      if (requestKeyRef.current !== requestKey) return;

      const page = (response?.data || {}) as SearchPage<IPost | IUser>;
      const incoming = page.data || [];
      offsetRef.current += incoming.length;

      setState(current => {
        const merge = <T extends { _id: string }>(existing: T[], next: T[]) => Array.from(
          new Map([...(reset ? [] : existing), ...next].map(item => [item._id, item])).values()
        );
        return {
          ...current,
          summary: null,
          posts: tab === 'video' ? merge(current.posts, incoming as IPost[]) : [],
          users: tab === 'user' ? merge(current.users, incoming as IUser[]) : [],
          tags: [],
          hasMore: Boolean(page.hasMore),
          total: typeof page.total === 'number' ? page.total : current.total
        };
      });
    } catch {
      if (requestKeyRef.current === requestKey) setError('Search failed. Please try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [query, tab]);

  useEffect(() => {
    setState(EMPTY);
    void fetchPage(true);
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !state.hasMore || tab === 'summary') return;
    void fetchPage(false);
  }, [fetchPage, state.hasMore, tab]);

  return { ...state, loading, error, loadMore };
}
