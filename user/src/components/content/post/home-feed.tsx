'use client';

import { useHomeFeedInfiniteScroll } from '@hooks/use-home-feed-infinite-scroll';
import { useHomeFeedPlayback } from '@hooks/use-home-feed-playback';
import Link from 'next/link';
import { useState } from 'react';
import { FaHeart, FaRss, FaUserPlus } from 'react-icons/fa';
import InfiniteScroll from 'react-infinite-scroll-component';

import HomeFeedCard from './home-feed-card';
import HomeFeedCategoryBar from './home-feed-category-bar';
import PostDetailModal from './post-detail-modal';

interface HomeFeedProps {
  initialData?: {
    data: import('@interfaces/post').IPost[];
    hasMore: boolean;
    nextCursor?: { id: string; createdAt: number } | null;
    total: number;
  } | null;
}

function EmptyFeed() {
  return (
    <div className="p-8 text-center">
      <FaRss className="mx-auto mb-4 text-6xl text-gray-300" />
      <h2 className="mb-2 text-2xl font-semibold">Your Feed is Empty</h2>
      <p className="mb-6 opacity-60">Follow creators to see their latest posts in your personalized feed</p>
      <Link href="/creators" className="inline-flex items-center rounded-lg bg-primary px-6 py-3 text-white transition-colors hover:bg-primary-dark">
        <FaUserPlus className="mr-2" />
        Discover Creators
      </Link>
    </div>
  );
}

function FeedError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-2xl p-8 text-center">
      <div className="mb-4 text-red-500">
        <FaRss className="mx-auto mb-2 text-4xl" />
        <h2 className="text-xl font-semibold">Failed to Load Feed</h2>
        <p className="mt-2 opacity-60">{message}</p>
      </div>
      <button type="button" onClick={onRetry} className="rounded bg-primary px-4 py-2 text-white transition-colors hover:bg-primary-dark">
        Try Again
      </button>
    </div>
  );
}

export default function HomeFeed({ initialData }: HomeFeedProps) {
  const [topicKey, setTopicKey] = useState('');
  const { posts, hasMore, loading, loadMore, error, updatePostInteraction } = useHomeFeedInfiniteScroll({
    initialData,
    enabled: true,
    topicKey
  });
  const [hoveredCompactPostId, setHoveredCompactPostId] = useState<string | null>(null);
  const playback = useHomeFeedPlayback(posts, updatePostInteraction);

  // With a category selected the bar must stay mounted, otherwise an empty category leaves the user
  // with no way back to "All of them".
  const isFiltered = Boolean(topicKey);
  if (!isFiltered && !loading && posts.length === 0 && !error) return <EmptyFeed />;
  if (!isFiltered && error && posts.length === 0) return <FeedError message={error} onRetry={loadMore} />;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <HomeFeedCategoryBar activeTopicKey={topicKey} onTopicChange={setTopicKey} />

      <div id="home-feed-scroll" className="home-feed-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 pb-8">
          <InfiniteScroll
            dataLength={posts.length}
            hasMore={hasMore}
            loader={null}
            next={loadMore}
            scrollableTarget="home-feed-scroll"
            endMessage={<p style={{ textAlign: 'center' }} />}
            scrollThreshold={0.9}
          >
            <div className="grid grid-cols-1 items-start gap-x-4 gap-y-5 pb-6 sm:grid-cols-2 xl:grid-cols-5">
              {posts[0] ? (
                <div className="min-w-0 sm:col-span-2 xl:col-span-3 xl:row-span-2">
                  <HomeFeedCard
                    post={posts[0]}
                    featured
                    popupPipState={playback.popupPipState}
                    popupPlaylist={playback.popupPlaylist}
                    compactHoverActive={Boolean(hoveredCompactPostId) || Boolean(playback.detailPost)}
                    featuredResumeTime={playback.featuredResumeTime}
                    onFeaturedTimeUpdate={playback.updateFeaturedPlaybackTime}
                    onOpenDetail={playback.openDetailPost}
                  />
                </div>
              ) : null}

              {posts.slice(1).map((post) => (
                <HomeFeedCard
                  key={post._id}
                  post={post}
                  popupPipState={playback.popupPipState}
                  popupPlaylist={playback.popupPlaylist}
                  onCompactHoverChange={setHoveredCompactPostId}
                  onOpenDetail={playback.openDetailPost}
                />
              ))}
            </div>
          </InfiniteScroll>

          {loading && posts.length === 0 ? (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
              <p className="opacity-60">Loading your personalized feed...</p>
            </div>
        ) : null}

          {isFiltered && !loading && posts.length === 0 ? (
            <div className="py-16 text-center opacity-70">
              <p className="text-sm font-semibold">No posts in this category yet</p>
              <button
                type="button"
                onClick={() => setTopicKey('')}
                className="mt-2 cursor-pointer text-sm text-(--text-muted) transition hover:text-(--text-strong)"
              >
                Back to all posts
              </button>
            </div>
          ) : null}

          {!hasMore && posts.length > 0 ? (
            <div className="py-8 text-center opacity-70">
              <FaHeart className="mx-auto mb-2 text-2xl" />
              <p>You&apos;re all caught up!</p>
              <p className="text-sm">Check back later for new posts from your followed creators.</p>
            </div>
        ) : null}
        </div>
      </div>

      {playback.detailPost ? (
        <PostDetailModal
          post={playback.detailPost}
          posts={posts}
          popupPlaylist={playback.popupPlaylist}
          initialTime={playback.detailInitialTime}
          initialDetailPanelTab={playback.detailInitialTab}
          targetCommentId={playback.detailTargetCommentId}
          targetCommentFallbackId={playback.detailTargetCommentFallbackId}
          onPlaybackTimeChange={(currentTime) => {
            if (playback.detailPost?._id === posts[0]?._id) playback.updateFeaturedPlaybackTime(currentTime);
          }}
          onClose={playback.closeDetailPost}
          onNavigate={playback.navigateDetailPost}
          onInteractionChange={playback.handleInteractionChange}
        />
      ) : null}
    </div>
  );
}
