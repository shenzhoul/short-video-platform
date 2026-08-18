'use client';

import { getPostTopics, type IPostTopic } from '@services/search.service';
import { useEffect, useState } from 'react';

// The list is a server-side constant, so one fetch per page load is plenty.
let cachedTopics: IPostTopic[] | null = null;

/**
 * Content topics a post can be filed under, fetched from the API so the composer and category bar
 * always offer exactly the keys the server will accept.
 */
export function usePostTopics() {
  const [topics, setTopics] = useState<IPostTopic[]>(cachedTopics || []);

  useEffect(() => {
    if (cachedTopics) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await getPostTopics();
        const data = response?.data as IPostTopic[];
        if (cancelled || !Array.isArray(data)) return;
        cachedTopics = data;
        setTopics(data);
      } catch {
        // Leave the list empty; the topic select simply has nothing to offer.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return topics;
}
