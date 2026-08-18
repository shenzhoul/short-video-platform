'use client';

import { formatCompactCount } from '@components/content/post/home-feed-media';
import { useSearchDiscovery } from '@hooks/use-search-discovery';
import { useSearchSuggestions } from '@hooks/use-search-suggestions';
import {
  clearSearchHistory,
  readSearchHistory,
  removeSearchHistory,
  subscribeSearchHistory,
  VISIBLE_HISTORY_LIMIT
} from '@lib/search-history';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { FiArrowUp, FiRefreshCw, FiTrash2, FiX } from 'react-icons/fi';
import { SearchIcon } from 'src/icons';

interface SearchSuggestionPanelProps {
  /** Current search-bar text. Empty shows discovery; non-empty shows autocomplete. */
  term?: string;
}

function HighlightedSuggestionText({ text, term }: { text: string; term: string }) {
  const normalizedTerm = term.trim();
  if (!normalizedTerm) return text;

  const normalizedText = text.toLowerCase();
  const normalizedMatch = normalizedTerm.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = normalizedText.indexOf(normalizedMatch);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    const matchEnd = matchIndex + normalizedMatch.length;
    parts.push(
      <span key={matchIndex} className="text-[#fe2c55]">
        {text.slice(matchIndex, matchEnd)}
      </span>
    );
    cursor = matchEnd;
    matchIndex = normalizedText.indexOf(normalizedMatch, cursor);
  }

  if (!parts.length) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/**
 * Rank marker for the hot-topic list.
 *
 * The leader gets a trending arrow rather than a "1" — it reads as movement, which is the point of a
 * hot list. Douyin treats that arrow as a trend marker, then starts the numbered ranks at 1.
 */
function HotTopicRank({ index }: { index: number }) {
  if (index === 0) {
    return (
      <span
        aria-label="Trending"
        className="flex h-4 w-4 shrink-0 items-center justify-center text-[13px] text-[#4d8cff]"
      >
        <FiArrowUp strokeWidth={3} />
      </span>
    );
  }

  const badgeClass = index === 1
    ? 'bg-[#ff9f1c] text-white [clip-path:polygon(50%_0,92%_24%,92%_76%,50%_100%,8%_76%,8%_24%)]'
    : index === 2
      ? 'bg-[#a7a8b2] text-white [clip-path:polygon(50%_0,92%_24%,92%_76%,50%_100%,8%_76%,8%_24%)]'
      : index === 3
        ? 'bg-[#d98f7c] text-white [clip-path:polygon(50%_0,92%_24%,92%_76%,50%_100%,8%_76%,8%_24%)]'
        : 'text-(--text-subtle)';

  return (
    <span className={`flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-semibold ${badgeClass}`}>
      {index}
    </span>
  );
}

export default function SearchSuggestionPanel({ term = '' }: SearchSuggestionPanelProps) {
  const router = useRouter();
  const [history, setHistory] = useState<string[]>([]);
  const [suggestionOffset, setSuggestionOffset] = useState(0);
  const keyword = term.trim();
  const isTyping = keyword.length > 0;

  // A leading `#` or `@` states an intent, and mixing the three semantics would blur it: `#div` is
  // asking for hashtags, `@dev` for accounts, and bare text for all three.
  const intent = keyword.startsWith('#') ? 'tag' : keyword.startsWith('@') ? 'user' : 'text';
  const bareKeyword = keyword.replace(/^[#@]/, '');

  // Three independent fetches. One source coming back empty must never suppress another — a query
  // like "dev" matches an account long before any hashtag exists for it, and it can equally match a
  // post title that is neither.
  const querySuggestions = useSearchSuggestions(keyword, 'query', isTyping && intent === 'text');
  const userSuggestions = useSearchSuggestions(bareKeyword, 'user', isTyping && intent !== 'tag');
  const tagSuggestions = useSearchSuggestions(bareKeyword, 'tag', isTyping && intent !== 'user');
  // History is local-only, so it is passed to the server to personalise suggestions rather than
  // being read from a stored search log.
  const { hotTopics, suggested } = useSearchDiscovery(history, !isTyping);
  // The store keeps every term; only the newest few are shown, so deleting one reveals the next.
  const visibleHistory = history.slice(0, VISIBLE_HISTORY_LIMIT);
  const isSuggesting = querySuggestions.loading || tagSuggestions.loading || userSuggestions.loading;
  const hasSuggestions = Boolean(
    querySuggestions.queries.length || tagSuggestions.tags.length || userSuggestions.users.length
  );
  const offset = suggested.length ? suggestionOffset % suggested.length : 0;
  const visibleSuggestions = offset
    ? [...suggested.slice(offset), ...suggested.slice(0, offset)]
    : suggested;

  useEffect(() => {
    setHistory(readSearchHistory());
    return subscribeSearchHistory(() => setHistory(readSearchHistory()));
  }, []);

  const goToSearch = (query: string) => {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <div className="w-151 max-w-[calc(100vw-220px)] overflow-hidden rounded-lg border border-(--border) bg-(--surface-raised) px-3 py-4 text-[14px] leading-5 text-(--text) shadow-(--shadow-popover)">
      {isTyping ? (
        <>
          <h3 className="mb-3 text-[13px] font-semibold text-(--text-muted)">Suggestions</h3>
          {isSuggesting && !hasSuggestions ? (
            <p className="py-4 text-center text-[13px] text-(--text-faint)">Searching...</p>
          ) : null}
          <div className="space-y-1">
            {/* Plain phrases taken from post content use the search icon because they are text
                queries, not accounts or hashtags. */}
            {querySuggestions.queries.map(entry => (
              <button
                key={entry.text}
                type="button"
                onClick={() => goToSearch(entry.query)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition hover:bg-(--hover-bg)"
              >
                <SearchIcon className="shrink-0 text-lg text-(--text-muted)" />
                <span className="truncate">
                  <HighlightedSuggestionText text={entry.text} term={keyword} />
                </span>
              </button>
            ))}
          </div>

          {intent !== 'tag' && userSuggestions.users.length ? (
            <>
              <h3 className="mb-2 mt-4 text-[13px] font-semibold text-(--text-muted)">Users</h3>
              <div className="space-y-1">
                {userSuggestions.users.map(user => (
                  <button
                    key={user._id}
                    type="button"
                    onClick={() => goToSearch(user.name || user.username || '')}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition hover:bg-(--hover-bg)"
                  >
                    <img
                      src={user.avatar || '/no_avatar.jpeg'}
                      alt=""
                      className="h-7 w-7 shrink-0 rounded-full object-cover"
                    />
                    <span className="truncate font-medium">
                      <HighlightedSuggestionText text={user.name || user.username || ''} term={bareKeyword} />
                    </span>
                    <span className="shrink-0 text-[12px]">
                      <HighlightedSuggestionText text={`@${user.username}`} term={bareKeyword} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {intent !== 'user' ? (
            <>
              <h3 className="mb-2 mt-4 text-[13px] font-semibold text-(--text-muted)">Hashtags</h3>
              <div className="space-y-1">
                {tagSuggestions.tags.map(tag => (
                  <button
                    key={tag.tag}
                    type="button"
                    onClick={() => goToSearch(`#${tag.tag}`)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition hover:bg-(--hover-bg)"
                  >
                    <span className="truncate font-medium">
                      <HighlightedSuggestionText text={`#${tag.tag}`} term={bareKeyword} />
                    </span>
                    <span className="shrink-0 text-[12px] text-(--text-muted)">
                      {formatCompactCount(tag.postCount)} posts
                    </span>
                  </button>
                ))}
                {!tagSuggestions.loading && !tagSuggestions.tags.length ? (
                  <p className="px-2 py-2 text-[13px] text-(--text-faint)">No matching hashtags</p>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          {visibleHistory.length ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[14px] font-bold leading-5 text-(--text-muted)">Historical records</h3>
                <button
                  type="button"
                  onClick={clearSearchHistory}
                  className="flex cursor-pointer items-center gap-1 text-[12px] leading-5 text-(--text-subtle) transition hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55]"
                >
                  <FiTrash2 className="text-[14px]" />
                  <span>Clear the records</span>
                </button>
              </div>
              <div className="mb-6 flex flex-wrap gap-x-2 gap-y-2">
                {visibleHistory.map(item => (
                  <span
                    key={item}
                    className="group relative flex h-6 max-w-44 items-center rounded-md bg-(--active-bg) px-2.5 py-0.5 text-[12px] font-medium leading-5 text-(--text) transition hover:bg-(--hover-bg) hover:text-(--text-strong) focus-within:bg-(--hover-bg) focus-within:text-(--text-strong)"
                  >
                    <button
                      type="button"
                      onClick={() => goToSearch(item)}
                      className="max-w-37 cursor-pointer truncate focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#fe2c55]"
                    >
                      {item}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSearchHistory(item)}
                      aria-label={`Remove ${item} from history`}
                      className="pointer-events-none absolute right-0 top-0 z-10 flex h-4 w-4 -translate-y-1/2 translate-x-1/2 cursor-pointer items-center justify-center text-(--text-subtle) opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:text-(--text-strong) focus-visible:outline-2 focus-visible:outline-[#fe2c55]"
                    >
                      <FiX className="text-[13px]" />
                    </button>
                  </span>
                ))}
              </div>
            </>
          ) : null}

          {suggested.length ? (
            <>
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-[14px] font-bold leading-5 text-(--text-muted)">You might be searching</h3>
                <button
                  type="button"
                  onClick={() => setSuggestionOffset(offset => offset + 2)}
                  className="flex cursor-pointer items-center gap-1 text-[12px] leading-5 text-(--text-subtle) transition hover:text-(--text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55]"
                >
                  <FiRefreshCw className="text-[13px]" />
                  <span>Change it up</span>
                </button>
              </div>
              <div className="mb-5 grid grid-cols-3 gap-x-7 gap-y-2">
                {visibleSuggestions.map((entry, index) => (
                  <button
                    key={entry.text}
                    type="button"
                    onClick={() => goToSearch(entry.query)}
                    className={`flex min-w-0 cursor-pointer items-center text-left text-[14px] font-normal leading-6 transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#fe2c55] ${index < 2 ? 'text-[#fe2c55] hover:text-[#ff5575]' : 'text-(--text) hover:text-(--text-strong)'}`}
                  >
                    <span className="truncate">{entry.text}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <h3 className="mb-2.5 text-[14px] font-bold leading-5 text-(--text-muted)">Hot topics</h3>
          {hotTopics.length ? (
            <div className="space-y-2">
              {hotTopics.map((entry, index) => (
                <button
                  key={entry.text}
                  type="button"
                  onClick={() => goToSearch(entry.query)}
                  className="flex min-h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-left text-[14px] font-normal leading-6 text-(--text) transition hover:bg-(--active-bg) hover:text-(--text-strong) focus-visible:bg-(--active-bg) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#fe2c55]"
                >
                  <HotTopicRank index={index} />
                  <span className="truncate">{entry.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="py-4 text-[13px] text-(--text-faint)">
              Topics will appear here as posts are published.
            </p>
          )}
        </>
      )}
    </div>
  );
}
