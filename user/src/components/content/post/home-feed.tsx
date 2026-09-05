'use client';

import { useHomeFeedInfiniteScroll } from '@hooks/use-home-feed-infinite-scroll';
import { useHomeFeedPlayback } from '@hooks/use-home-feed-playback';
import { isTopicKeyRetired, usePostTopicsCatalogue } from '@hooks/use-post-topics';
import { useRecommendationDetailFeed } from '@hooks/use-recommendation-detail-feed';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FaHeart, FaRss, FaUserPlus } from 'react-icons/fa';
import InfiniteScroll from 'react-infinite-scroll-component';

import HomeFeedCard from './home-feed-card';
import HomeFeedCategoryBar from './home-feed-category-bar';
import PostDetailModal from './post-detail-modal';

interface HomeFeedProps {
  initialData?: {
    data: import('@interfaces/post').IPost[];
    hasMore: boolean;
    sessionId?: string;
    nextCursor?: string | null;
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
  const catalogue = usePostTopicsCatalogue();
  const {
    posts, hasMore, loading, loadMore, refresh, sessionId, sessionForPost, error, updatePostInteraction
  } = useHomeFeedInfiniteScroll({
    initialData,
    enabled: true,
    topicKey
  });

  /**
   * Drop a selection an admin has since disabled.
   *
   * The API ignores an unknown or disabled `topicKey` and answers with the unfiltered feed, so
   * leaving the selection in place would show every post under a category chip that is no longer
   * even in the bar — the person would believe they were still filtered. Clearing it puts the bar
   * and the feed back in agreement on "All of them", and `useHomeFeedInfiniteScroll` reloads the
   * first unfiltered page because `topicKey` changed.
   *
   * `isTopicKeyRetired` only answers true after a successful catalogue load, so a first paint still
   * awaiting the list, or a failed refetch holding the previous one, never clears a valid choice.
   */
  useEffect(() => {
    if (isTopicKeyRetired(topicKey, catalogue)) setTopicKey('');
  }, [catalogue, topicKey]);

  const [hoveredCompactPostId, setHoveredCompactPostId] = useState<string | null>(null);
  const playback = useHomeFeedPlayback(posts, updatePostInteraction);
  // Post Detail's next/previous for a Home/direct-link open follows the
  // recommendation detail session, not grid order (rules/instructions §5.1,
  // §5.3) — `for-you`/`following-feed`/creator-scoped sources never reach
  // here, so this is unconditionally the right sequence for whatever modal
  // Home ever opens.
  const detailFeed = useRecommendationDetailFeed({
    enabled: Boolean(playback.detailPost),
    currentPost: playback.detailPost
  });

  // With a category selected the bar must stay mounted, otherwise an empty category leaves the user
  // with no way back to "All of them".
  const isFiltered = Boolean(topicKey);
  if (!isFiltered && !loading && posts.length === 0 && !error) return <EmptyFeed />;
  if (!isFiltered && error && posts.length === 0) return <FeedError message={error} onRetry={loadMore} />;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <HomeFeedCategoryBar topics={catalogue.topics} activeTopicKey={topicKey} onTopicChange={setTopicKey} />

      <div id="home-feed-scroll" className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
            {/*
              Container queries, not viewport breakpoints.

              `sm:`/`xl:` measure the window, which does not change when the
              message workspace takes a column — the grid would keep five
              columns and simply squash them. `@`-variants measure the scroller
              instead, so the column count falls out of the width actually
              available and cards rewrap when messages open exactly as they do
              when the window itself is narrowed.

              The thresholds are calibrated against the shell, not picked from
              the default scale: the content column is the viewport minus the
              160px navigation, and the workspace removes a further 360px. 88rem
              sits between a 1920px viewport with messages closed (110rem) and
              the same viewport with them open (87.5rem), which is what makes
              that case fall from five columns to three.
            */}
            <div className="grid grid-cols-1 items-start gap-x-4 gap-y-5 pb-6 @min-[42rem]:grid-cols-2 @min-[64rem]:grid-cols-3 @min-[88rem]:grid-cols-5">
              {/*
                The featured post takes the whole row until there is room for
                the reference's five-column arrangement, where it occupies three
                columns and two rows with the smaller cards packed around it.
              */}
              {posts[0] ? (
                <div className="min-w-0 @min-[42rem]:col-span-2 @min-[64rem]:col-span-3 @min-[88rem]:col-span-3 @min-[88rem]:row-span-2">
                  <HomeFeedCard
                    post={posts[0]}
                    featured
                    popupPipState={playback.popupPipState}
                    compactHoverActive={Boolean(hoveredCompactPostId) || Boolean(playback.detailPost)}
                    featuredResumeTime={playback.featuredResumeTime}
                    onFeaturedTimeUpdate={playback.updateFeaturedPlaybackTime}
                    onOpenDetail={playback.openDetailPost}
                    recommendationSessionId={sessionForPost(posts[0]._id) || sessionId}
                  />
                </div>
              ) : null}

              {posts.slice(1).map((post) => (
                <HomeFeedCard
                  key={post._id}
                  post={post}
                  popupPipState={playback.popupPipState}
                  onCompactHoverChange={setHoveredCompactPostId}
                  onOpenDetail={playback.openDetailPost}
                  recommendationSessionId={sessionForPost(post._id) || sessionId}
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
              <p className="mb-4 text-sm">This session&apos;s recommendations are exhausted.</p>
              <button
                type="button"
                onClick={refresh}
                className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-sm text-white transition-colors hover:bg-primary-dark"
              >
                Refresh recommendations
              </button>
            </div>
        ) : null}
        </div>
      </div>

      {playback.detailPost ? (
        <PostDetailModal
          post={playback.detailPost}
          posts={detailFeed.feedPosts}
          source={playback.detailSource}
          recommendationSessionId={detailFeed.sessionId}
          hasMoreAhead={detailFeed.hasMoreAhead}
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
