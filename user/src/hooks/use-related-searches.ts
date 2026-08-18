'use client';

import { getRelatedSearches, type ITagSearchResult } from '@services/search.service';
import { useEffect, useState } from 'react';

/**
 * Hashtags related to the current search query.
 *
 * Server-side this stays tied to the query rather than falling back to global trending, so the
 * panel does not suggest unrelated topics next to a specific search.
 */
export function useRelatedSearches(query: string) {
  const [related, setRelated] = useState<ITagSearchResult[]>([]);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setRelated([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await getRelatedSearches(term);
        if (cancelled) return;
        setRelated(Array.isArray(response?.data) ? response.data : []);
      } catch {
        if (!cancelled) setRelated([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query]);

  return related;
}
