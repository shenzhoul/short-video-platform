'use client';

import { IUser } from '@interfaces/user';
import {
  getSearchSuggestions,
  type IDiscoveryEntry,
  type ITagSearchResult,
  type SuggestionType
} from '@services/search.service';
import { useEffect, useState } from 'react';

const DEBOUNCE_MS = 280;

interface SuggestionState {
  /** Plain search phrases, e.g. "Amazing Diving Trip in Bali". Never hashtags. */
  queries: IDiscoveryEntry[];
  tags: ITagSearchResult[];
  users: IUser[];
  loading: boolean;
}

const EMPTY = { queries: [], tags: [], users: [] };

/**
 * One suggestion source, fetched independently.
 *
 * The three sources — plain text, accounts and hashtags — answer different intents, so the search
 * bar calls this once per source rather than deriving one from another. That independence is the
 * point: an empty hashtag result must never suppress a matching account, and typing "div" has to be
 * able to suggest a phrase as well as `#diving`.
 *
 * Debounced so typing "chatgpt" issues one request per source rather than seven.
 */
export function useSearchSuggestions(term: string, type: SuggestionType, enabled = true) {
  const [state, setState] = useState<SuggestionState>({ ...EMPTY, loading: false });

  useEffect(() => {
    const keyword = term.trim();
    // An empty keyword is still fetched while enabled: a bare `#` or `@` in the composer should
    // offer a starting list rather than an empty dropdown.
    if (!enabled) {
      setState({ ...EMPTY, loading: false });
      return;
    }

    let cancelled = false;
    setState(current => ({ ...current, loading: true }));

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await getSearchSuggestions(keyword, type);
          if (cancelled) return;
          const data = response?.data || [];
          setState({
            ...EMPTY,
            ...(type === 'tag' ? { tags: data as ITagSearchResult[] } : {}),
            ...(type === 'user' ? { users: data as IUser[] } : {}),
            ...(type === 'query' ? { queries: data as IDiscoveryEntry[] } : {}),
            loading: false
          });
        } catch {
          if (!cancelled) setState({ ...EMPTY, loading: false });
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      // The request may never have been issued (cleanup can beat the debounce), so loading has to
      // be released here too or it stays true forever once the term changes mid-debounce.
      setState(current => (current.loading ? { ...current, loading: false } : current));
    };
  }, [enabled, term, type]);

  return state;
}
