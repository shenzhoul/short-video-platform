'use client';

import type { IUser } from '@interfaces/user';
import { getCreatorFollowers, getCreatorFollowings } from '@services/user.service';
import { useCallback, useEffect, useRef, useState } from 'react';

/** People fetched from each side per page. */
const PAGE_SIZE = 15;

/** How long typing settles before the server is asked. */
const SEARCH_DEBOUNCE_MS = 300;

export interface ShareRecipient extends Partial<IUser> {
  _id: string;
}

interface ShareRecipientsState {
  recipients: ShareRecipient[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
}

interface UseShareRecipientsOptions {
  /** The signed-in user, who is filtered out of their own share list. */
  currentUserId?: string | null;
  /** Nothing is fetched until this is true, so a feed of cards costs nothing. */
  enabled: boolean;
}

/**
 * The people a post can be shared with: everyone this user follows, plus
 * everyone who follows them.
 *
 * Merged rather than shown as two tabs, because from the sharer's point of view
 * it is one question — "who do I send this to" — and somebody who is both a
 * follower and a followee is one person, not two entries. De-duplication is on
 * the user id and nothing else: names are not unique and usernames can change.
 *
 * Search is server-side and debounced. The lists are paginated on the server
 * already, and a creator with thousands of followers must not have all of them
 * pulled into the browser so a filter can run over them.
 *
 * Both sides are paged in step. That is a deliberate simplification: it means a
 * page can come back smaller than requested once one side runs out, which is
 * fine for a list nobody scrolls to the bottom of, and it avoids maintaining two
 * independent cursors for a popover.
 */
export function useShareRecipients({ currentUserId, enabled }: UseShareRecipientsOptions) {
  const [keyword, setKeyword] = useState('');
  const [state, setState] = useState<ShareRecipientsState>({
    recipients: [],
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false
  });

  const pageRef = useRef(0);
  const requestIdRef = useRef(0);
  const seenIdsRef = useRef(new Set<string>());

  const fetchPage = useCallback(async (search: string, page: number) => {
    if (!currentUserId) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState(current => ({
      ...current,
      loading: page === 0,
      loadingMore: page > 0,
      error: null
    }));

    try {
      const query = {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(search ? { q: search } : {})
      };

      // Both sides in parallel: they are independent lists and waiting for one
      // before starting the other doubles the time the popover shows a spinner.
      const [followingResponse, followerResponse] = await Promise.all([
        getCreatorFollowings(currentUserId, query),
        getCreatorFollowers(currentUserId, query)
      ]);

      // A stale response from an earlier keyword must not overwrite a newer one.
      if (requestIdRef.current !== requestId) return;

      const following = (followingResponse?.data?.data || []) as ShareRecipient[];
      const followers = (followerResponse?.data?.data || []) as ShareRecipient[];

      if (page === 0) seenIdsRef.current = new Set<string>();

      const fresh: ShareRecipient[] = [];
      [...following, ...followers].forEach(user => {
        const id = user?._id?.toString();
        // Self is dropped here rather than by the server: the endpoints are
        // general-purpose lists, and "can I share with myself" is this
        // feature's question, not theirs.
        if (!id || id === currentUserId || seenIdsRef.current.has(id)) return;
        seenIdsRef.current.add(id);
        fresh.push({ ...user, _id: id });
      });

      const moreAvailable = following.length >= PAGE_SIZE || followers.length >= PAGE_SIZE;

      setState(current => ({
        recipients: page === 0 ? fresh : [...current.recipients, ...fresh],
        loading: false,
        loadingMore: false,
        error: null,
        hasMore: moreAvailable
      }));
      pageRef.current = page;
    } catch {
      if (requestIdRef.current !== requestId) return;
      setState(current => ({
        ...current,
        loading: false,
        loadingMore: false,
        // Deliberately generic: the popover shows a retry, and the underlying
        // transport error means nothing to the person trying to share a video.
        error: 'Could not load your friends. Try again.'
      }));
    }
  }, [currentUserId]);

  // First load, and every settled keyword change.
  useEffect(() => {
    if (!enabled || !currentUserId) return undefined;

    const timer = setTimeout(() => {
      void fetchPage(keyword.trim(), 0);
    }, keyword ? SEARCH_DEBOUNCE_MS : 0);

    return () => clearTimeout(timer);
  }, [currentUserId, enabled, fetchPage, keyword]);

  const loadMore = useCallback(() => {
    if (state.loading || state.loadingMore || !state.hasMore) return;
    void fetchPage(keyword.trim(), pageRef.current + 1);
  }, [fetchPage, keyword, state.hasMore, state.loading, state.loadingMore]);

  const retry = useCallback(() => {
    void fetchPage(keyword.trim(), 0);
  }, [fetchPage, keyword]);

  return {
    ...state,
    keyword,
    setKeyword,
    loadMore,
    retry
  };
}
