'use client';

import HomeFeedCard from '@components/content/post/home-feed-card';
import { formatCompactCount } from '@components/content/post/home-feed-media';
import PostDetailModal from '@components/content/post/post-detail-modal';
import { useFollowCreator } from '@hooks/use-follow-creator';
import { useHomeFeedPlayback } from '@hooks/use-home-feed-playback';
import { useRelatedSearches } from '@hooks/use-related-searches';
import { type SearchTabKey, useSearchResults } from '@hooks/use-search-results';
import { IPost } from '@interfaces/post';
import { IUser } from '@interfaces/user';
import { addSearchHistory } from '@lib/search-history';
import type { ITagSearchResult } from '@services/search.service';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { SearchIcon } from 'src/icons';

const TABS: Array<{ key: SearchTabKey; label: string }> = [
  { key: 'summary', label: 'Summary' },
  { key: 'video', label: 'Videos' },
  { key: 'user', label: 'Users' }
];

function TagChips({ tags }: { tags: ITagSearchResult[] }) {
  if (!tags.length) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-(--text-muted)">Related hashtags</h2>
      <div className="flex flex-wrap gap-2">
        {tags.map(tag => (
          <Link
            key={tag.tag}
            href={`/search?q=${encodeURIComponent(`#${tag.tag}`)}`}
            className="flex items-center gap-2 rounded-full bg-(--surface-muted) px-4 py-2 text-sm text-(--text-strong) transition hover:bg-(--hover-bg)"
          >
            <span className="font-semibold">#{tag.tag}</span>
            <span className="text-xs text-(--text-muted)">{formatCompactCount(tag.postCount)} posts</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function UserRow({ user }: { user: IUser }) {
  const followState = useFollowCreator(user._id, Boolean(user.isFollowed));
  const displayName = user.name || user.username || 'Unknown';

  return (
    <div className="flex items-center gap-3 py-3">
      <Link href={`/${user.username}`} className="shrink-0">
        <img
          src={user.avatar || '/no_avatar.jpeg'}
          alt={displayName}
          className="h-14 w-14 rounded-full object-cover"
        />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/${user.username}`} className="block truncate text-base font-medium text-(--text-strong) hover:underline">
          {displayName}
        </Link>
        <div className="truncate text-xs text-(--text-muted)">
          {formatCompactCount(user.stats?.followers)} followers
          <span className="mx-2">·</span>
          {formatCompactCount(user.stats?.totalLikes)} likes
        </div>
        {user.bio ? <div className="truncate text-xs text-(--text-muted)">{user.bio}</div> : null}
      </div>
      {!followState.isOwner ? (
        <button
          type="button"
          onClick={() => void followState.toggleFollow()}
          disabled={followState.following}
          className={`h-9 shrink-0 cursor-pointer rounded-lg px-4 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${followState.isFollowed
            ? 'bg-(--btn-bg) text-(--text-muted) hover:bg-(--btn-bg-hover)'
            : 'bg-[#fe2c55] text-white hover:bg-[#e4264e]'}`}
        >
          {followState.isFollowed ? 'Following' : 'Follow'}
        </button>
      ) : null}
    </div>
  );
}

interface SearchResultsProps {
  query: string;
}

export default function SearchResults({ query }: SearchResultsProps) {
  const [tab, setTab] = useState<SearchTabKey>('summary');
  const {
    posts, users, tags, hasMore, loading, error, loadMore
  } = useSearchResults(query, tab);
  const relatedSearches = useRelatedSearches(query);
  const playback = useHomeFeedPlayback(posts);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim()) addSearchHistory(query);
  }, [query]);

  useEffect(() => {
    setTab('summary');
  }, [query]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '320px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const renderPostGrid = (items: IPost[]) => (
    <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
      {items.map(post => (
        <HomeFeedCard
          key={post._id}
          post={post}
          popupPipState={playback.popupPipState}
          popupPlaylist={playback.popupPlaylist}
          onOpenDetail={playback.openDetailPost}
        />
      ))}
    </div>
  );

  const isEmpty = !loading && !error && !posts.length && !users.length && !tags.length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <nav role="tablist" className="flex shrink-0 items-center gap-8 border-b border-(--border-soft) px-6">
        {TABS.map(item => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={`h-12 cursor-pointer border-b-[3px] text-base font-medium transition ${tab === item.key
              ? 'border-b-[#fe2c55] text-(--text-strong)'
              : 'border-b-transparent text-(--text-muted) hover:text-(--text-strong)'}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 home-feed-scrollbar">
          {tab === 'summary' ? (
            <>
              <TagChips tags={tags} />
              {users.length ? (
                <section className="mb-6">
                  <h2 className="mb-1 text-sm font-semibold text-(--text-muted)">Users</h2>
                  <div className="divide-y divide-(--border-faint)">
                    {users.map(user => <UserRow key={user._id} user={user} />)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('user')}
                    className="mt-2 cursor-pointer text-sm text-(--text-muted) transition hover:text-(--text-strong)"
                  >
                    See all users
                  </button>
                </section>
            ) : null}
              {posts.length ? (
                <section>
                  <h2 className="mb-3 text-sm font-semibold text-(--text-muted)">Videos</h2>
                  {renderPostGrid(posts)}
                  <button
                    type="button"
                    onClick={() => setTab('video')}
                    className="mt-4 cursor-pointer text-sm text-(--text-muted) transition hover:text-(--text-strong)"
                  >
                    See all videos
                  </button>
                </section>
            ) : null}
            </>
        ) : null}

          {tab === 'video' ? renderPostGrid(posts) : null}

          {tab === 'user' ? (
            <div className="mx-auto max-w-3xl divide-y divide-(--border-faint)">
              {users.map(user => <UserRow key={user._id} user={user} />)}
            </div>
        ) : null}

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-(--border-faint) border-t-(--text-strong)" />
            </div>
        ) : null}

          {error ? <p className="py-8 text-center text-sm text-[#ff5c5c]">{error}</p> : null}

          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="text-base font-semibold text-(--text-strong)">No results for &quot;{query}&quot;</p>
              <p className="mt-1 text-sm text-(--text-muted)">Try a different keyword or hashtag.</p>
            </div>
        ) : null}

          <div ref={sentinelRef} className="h-1" aria-hidden />
        </div>

        {relatedSearches.length ? (
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-(--border-soft) px-5 py-5 home-feed-scrollbar xl:block">
            <h2 className="mb-3 text-base font-semibold text-(--text-strong)">Related searches</h2>
            <div className="space-y-1">
              {relatedSearches.map(tag => (
                <Link
                  key={tag.tag}
                  href={`/search?q=${encodeURIComponent(`#${tag.tag}`)}`}
                  className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-(--text) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
                >
                  <SearchIcon className="shrink-0 text-base text-(--text-muted)" />
                  <span className="truncate">#{tag.tag}</span>
                </Link>
              ))}
            </div>
          </aside>
        ) : null}
      </div>

      {playback.detailPost ? (
        <PostDetailModal
          post={playback.detailPost}
          posts={posts}
          popupPlaylist={playback.popupPlaylist}
          initialTime={playback.detailInitialTime}
          onInteractionChange={playback.handleInteractionChange}
          onClose={playback.closeDetailPost}
          onNavigate={playback.navigateDetailPost}
        />
      ) : null}
    </div>
  );
}
