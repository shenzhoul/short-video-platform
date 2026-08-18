'use client';

import { IUser } from '@interfaces/user';
import { getCreatorFollowers, getCreatorFollowings } from '@services/user.service';
import { useCallback, useEffect, useRef, useState } from 'react';

export type FollowListType = 'following' | 'follower';
export type FollowListSort = 'recent' | 'earliest';

const PAGE_LIMIT = 20;

interface UseFollowListOptions {
  userId?: string;
  type: FollowListType;
  /** Only fetches while true, so a closed modal costs nothing. */
  enabled: boolean;
  keyword?: string;
  sort?: FollowListSort;
}

interface FollowListPage {
  data: IUser[];
  total?: number;
  hasMore: boolean;
}

export function useFollowList({ userId, type, enabled, keyword = '', sort = 'recent' }: UseFollowListOptions) {
  const queryKey = `${userId}:${type}:${keyword}:${sort}`;
  const [users, setUsers] = useState<IUser[]>([]);
  // Tagged with the query it was loaded for. State resets happen in an effect, one commit after the
  // query changes, so an untagged total would briefly read as belonging to the new query — which
  // matters because a searched total counts only matches, not the real relationship count.
  const [loadedTotal, setLoadedTotal] = useState<{ key: string; value: number } | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  // Identifies the query the in-flight request belongs to, so a slow response for a stale
  // keyword/sort/tab cannot overwrite results for the query the user is now looking at.
  const requestKeyRef = useRef('');

  const fetchPage = useCallback(async (reset: boolean) => {
    if (!userId || loadingRef.current) return;
    const requestKey = queryKey;
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
      const request = type === 'following' ? getCreatorFollowings : getCreatorFollowers;
      const response = await request(userId, {
        limit: PAGE_LIMIT,
        offset: offsetRef.current,
        sort: sort === 'earliest' ? 'asc' : 'desc',
        ...(keyword ? { q: keyword } : {})
      });
      if (requestKeyRef.current !== requestKey) return;

      const page = (response?.data || {}) as FollowListPage;
      const incoming = page.data || [];
      offsetRef.current += incoming.length;
      setUsers(current => {
        const base = reset ? incoming : [...current, ...incoming];
        return Array.from(new Map(base.map(item => [item._id, item])).values());
      });
      if (typeof page.total === 'number') setLoadedTotal({ key: requestKey, value: page.total });
      setHasMore(Boolean(page.hasMore));
    } catch {
      if (requestKeyRef.current === requestKey) {
        setError(`Unable to load ${type === 'following' ? 'following' : 'followers'}.`);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [keyword, queryKey, sort, type, userId]);

  useEffect(() => {
    if (!enabled || !userId) return;
    setUsers([]);
    setHasMore(false);
    void fetchPage(true);
  }, [enabled, fetchPage, userId]);

  const loadMore = useCallback(() => {
    if (!enabled || loadingRef.current || !hasMore) return;
    void fetchPage(false);
  }, [enabled, fetchPage, hasMore]);

  /** Keeps a row's follow state in sync after the viewer follows/unfollows from the list. */
  const setUserFollowState = useCallback((targetId: string, isFollowed: boolean) => {
    setUsers(current => current.map(item => item._id === targetId ? { ...item, isFollowed } : item));
  }, []);

  const total = loadedTotal && loadedTotal.key === queryKey ? loadedTotal.value : null;

  return { users, total, hasMore, loading, error, loadMore, setUserFollowState };
}
