'use client';

import { getSearchDiscovery, type IDiscoveryEntry } from '@services/search.service';
import { useEffect, useState } from 'react';

interface DiscoveryState {
  hotTopics: IDiscoveryEntry[];
  suggested: IDiscoveryEntry[];
}

const EMPTY: DiscoveryState = { hotTopics: [], suggested: [] };

// Trending is recomputed hourly server-side, so caching for the session is plenty and keeps the
// popup from refetching every time it opens.
let cached: DiscoveryState | null = null;

/**
 * Hot Topics and "You might be searching" for the search popup.
 *
 * `recentTerms` come from the viewer's local history and let the server bias suggestions toward
 * what they have been looking for.
 */
export function useSearchDiscovery(recentTerms: string[], enabled: boolean) {
  const [state, setState] = useState<DiscoveryState>(cached || EMPTY);
  // Only the first few terms influence the result, so this keeps the effect from refiring on every
  // history mutation.
  const recentKey = recentTerms.slice(0, 3).join(',');

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await getSearchDiscovery(recentKey ? recentKey.split(',') : []);
        const data = response?.data as DiscoveryState;
        if (cancelled || !data) return;
        cached = { hotTopics: data.hotTopics || [], suggested: data.suggested || [] };
        setState(cached);
      } catch {
        // Keep whatever was already shown; discovery is decorative.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, recentKey]);

  return state;
}
