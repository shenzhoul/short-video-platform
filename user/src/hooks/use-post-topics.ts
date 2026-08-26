'use client';

import { getPostTopics, type IPostTopic } from '@services/search.service';
import { useCallback, useEffect, useState } from 'react';

/**
 * How long a fetched catalogue is reused before the next mount refetches it.
 *
 * The catalogue is admin-editable now, so it cannot be cached for the life of the tab: adding,
 * renaming or disabling a category has to reach people who already have the app open. Five minutes
 * keeps navigation between the composer and the feed from refetching on every mount while still
 * converging on the admin's change without anyone clearing anything by hand.
 */
const TOPICS_TTL_MS = 5 * 60 * 1000;

let cachedTopics: IPostTopic[] | null = null;
let cachedAt = 0;

const isStale = () => !cachedTopics || Date.now() - cachedAt > TOPICS_TTL_MS;

export interface PostTopicsCatalogue {
  topics: IPostTopic[];
  /**
   * Timestamp of the last *successful* load, or 0 if the catalogue has never loaded.
   *
   * This is the signal that separates "the server confirmed this category is gone" from "we have
   * not heard back yet" and from "the refetch failed and this list is stale". A failed refetch
   * deliberately leaves it unchanged, so nothing downstream can mistake a network error for the
   * admin having removed a category.
   */
  loadedAt: number;
}

/**
 * Content topics a post can be filed under, fetched from the API so the composer and category bar
 * always offer exactly the keys the server will accept.
 *
 * Returns the cached list immediately when there is one, then replaces it if the refetch produced
 * something different — so a stale-but-usable list never blanks the picker while it revalidates.
 */
export function usePostTopicsCatalogue(): PostTopicsCatalogue {
  const [catalogue, setCatalogue] = useState<PostTopicsCatalogue>(() => ({
    topics: cachedTopics || [],
    loadedAt: cachedTopics ? cachedAt : 0
  }));

  const refresh = useCallback(async (isCancelled: () => boolean) => {
    try {
      const response = await getPostTopics();
      const data = response?.data as IPostTopic[];
      if (!Array.isArray(data)) return;

      cachedTopics = data;
      cachedAt = Date.now();
      if (!isCancelled()) setCatalogue({ topics: data, loadedAt: cachedAt });
    } catch {
      // Keep whatever is already cached; the picker is better stale than empty, and `loadedAt`
      // stays put so a failure is never read as a category having been removed. A first-ever
      // failure leaves the list empty, which is the same as before.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    if (isStale()) {
      void refresh(isCancelled);
    } else if (cachedTopics) {
      setCatalogue({ topics: cachedTopics, loadedAt: cachedAt });
    }

    // A tab left open past the TTL picks up an admin's change when the person returns to it,
    // rather than showing a catalogue that no longer exists until they navigate.
    const onFocus = () => {
      if (isStale()) void refresh(isCancelled);
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return catalogue;
}

/**
 * The topic list on its own, for the pickers that only need something to render.
 */
export function usePostTopics(): IPostTopic[] {
  return usePostTopicsCatalogue().topics;
}

/**
 * Decide whether a selected topic key has been retired by an admin.
 *
 * Returns true only when a *successful* catalogue load has confirmed the key is not among the
 * active topics. Every other case answers false on purpose:
 *
 * - nothing selected — there is nothing to retire;
 * - the catalogue has never loaded (`loadedAt === 0`) — the empty list is ignorance, not an answer,
 *   so a selection restored on first paint is never dropped while the first request is in flight;
 * - a refetch failed — `loadedAt` did not move and the list is the previous successful one, so a
 *   key still present in it is still treated as valid.
 */
export function isTopicKeyRetired(
  topicKey: string,
  { topics, loadedAt }: PostTopicsCatalogue
): boolean {
  if (!topicKey || !loadedAt) return false;
  return !topics.some((topic) => topic.key === topicKey);
}
