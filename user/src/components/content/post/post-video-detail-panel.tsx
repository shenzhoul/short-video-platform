'use client';

import { useFollowCreator } from '@hooks/use-follow-creator';
import { IComment } from '@interfaces/comment';
import { IPost } from '@interfaces/post';
import { useProfile } from '@providers/profile.provider';
import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import { FaChevronRight, FaTimes } from 'react-icons/fa';
import { HeartOutlineIcon } from 'src/icons';

import { formatCompactCount, getPostImages, getPostMedia, isVideoPost } from './home-feed-media';
import PostPhotoBadge from './post-photo-badge';
import PostPinnedBadge from './post-pinned-badge';
import PostTextContent from './post-text-content';

const CommentWrapper = dynamic(() => import('@components/comment/comment-wrapper'), { ssr: false });

export type PostVideoDetailTab = 'details' | 'videos' | 'comments' | 'ask-ai' | 'related';

interface PostVideoDetailPanelProps {
  post: IPost;
  activeTab: PostVideoDetailTab;
  creatorVideos: IPost[];
  creatorVideosLoading: boolean;
  creatorVideosHasMore: boolean;
  creatorVideosError: string | null;
  onLoadMoreCreatorVideos: () => void;
  onSelectVideo: (post: IPost) => void;
  onTabChange: (tab: PostVideoDetailTab) => void;
  /** Comment a notification deep-linked to, if any. */
  targetCommentId?: string | null;
  /** Aggregate fallback: the comment that opened the group. */
  targetCommentFallbackId?: string | null;
  onClose: () => void;
  rightOffset?: string;
  totalComment?: number;
  onTotalCommentChange?: (total: number) => void;
  /**
   * Fires only where a comment genuinely was created by this viewer
   * (`CommentWrapper.onCommentCreate`), never on a total-count change — which
   * is also what somebody else's comment arriving over the socket looks like.
   */
  onCommentCreate?: (comment: IComment) => void;
}

/**
 * The panel's tabs, in reference order.
 *
 * `compactLabel` is what the narrow layout draws. Only the AI tab has one: two
 * characters instead of six is what makes the difference between five labels
 * fitting a 167px panel and the row having to scroll, and "AI" is exactly what
 * the reference shows in that slot. `label` remains the accessible name, so the
 * button is still announced and still tooltips as "Ask AI".
 *
 * Nothing else is shortened. `Details`, `Videos`, `Comments` and `Related` are
 * drawn in full at every width.
 *
 * The row has two compact sizes because the panel is a *fraction* of the
 * viewport (0.38), not a fixed width: 8px fits the 167px panel a 440px viewport
 * gives, but a 390px viewport gives 148px and the same five labels need 126px
 * of it. 7px below 420px keeps them all drawn rather than letting the row
 * scroll — measured, not guessed.
 */
const tabs: Array<{ key: PostVideoDetailTab; label: string; compactLabel?: string }> = [
  { key: 'details', label: 'Details' },
  { key: 'videos', label: 'Videos' },
  { key: 'comments', label: 'Comments' },
  { key: 'related', label: 'Related' },
  { key: 'ask-ai', label: 'Ask AI', compactLabel: 'AI' }
];

function CreatorVideoGrid({
  post,
  following,
  followPending,
  isOwnProfile,
  followerCount,
  onToggleFollow,
  posts,
  hasMore,
  loading,
  error,
  loadMore,
  onSelectVideo
}: {
  post: IPost;
  following: boolean;
  followPending: boolean;
  isOwnProfile: boolean;
  followerCount: number;
  onToggleFollow: () => void;
  posts: IPost[];
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  loadMore: () => void;
  onSelectVideo: (post: IPost) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '240px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  return (
    <div className='px-4 max-lg:px-1.5'>
      <div className='h-auto m-0 py-[calc(0.714286vw+5.71429px)] max-lg:py-1.5'>
        <div className='flex items-center justify-between gap-2'>
          <div className='min-w-0 max-w-none flex flex-1 items-center'>
            <div className='min-w-0 flex-1'>
              <a href={`/${post.user?.username}`} data-panel-creator-id={post.user?._id} className='h-11.5 max-lg:h-auto max-lg:gap-px min-w-0 flex flex-col justify-between relative'>
                <div className='max-w-none h-5.5 max-lg:h-[15px] min-w-0 text-white/90 text-sm max-lg:text-[11px] max-lg:leading-[15px] flex items-center hover:text-white'>
                  <span>@</span>
                  <span className='truncate'>{post.user?.name}</span>
                  <FaChevronRight className='text-xs max-lg:text-[8px] text-white/60 ml-0.5' />
                </div>
                <div className='text-white/90 text-sm max-lg:text-[9px] max-lg:leading-[13px] h-5 max-lg:h-[13px] flex items-center whitespace-nowrap hover:text-white'>
                  {formatCompactCount(followerCount)} followers
                  <span className='border-white text-[16px] font-medium w-0 h-2.5 max-lg:h-1.5 border-l border-solid ml-2 max-lg:ml-1 mr-2 max-lg:mr-1 block' />
                  {formatCompactCount(post.user?.stats?.totalLikes)} likes
                </div>
              </a>
            </div>
          </div>
          <div className='flex items-center m-0 -mr-2 max-lg:mr-0'>
            {!isOwnProfile ? (
              <button
                type="button"
                onClick={onToggleFollow}
                disabled={followPending}
                className={`shrink-0 cursor-pointer whitespace-nowrap rounded-lg max-lg:rounded max-lg:h-[18px] px-4 max-lg:px-1.5 py-2 max-lg:py-0 text-xs max-lg:text-[9px] max-lg:leading-[18px] font-semibold transition disabled:cursor-wait disabled:opacity-60 ${following ? 'bg-white/12 text-white hover:bg-white/16' : 'bg-[#fe2c55] text-white hover:bg-[#e9274d]'}`}
                aria-pressed={following}
              >
                {following ? 'Following' : '+ Follow'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 max-lg:gap-[3px]">
        {posts.map((video) => {
          const isCurrent = video._id === post._id;
          const poster = getPostMedia(video);
          // The grid holds every post a creator has, not only videos, so each
          // tile says which kind it is. Photos get a mark; videos keep the
          // playing indicator they already had.
          const photoPost = !isVideoPost(video);
          const imageCount = photoPost ? getPostImages(video).length : 0;
          const kind = photoPost ? 'photo' : 'video';
          const title = video.text || video.tagline || `Creator ${kind}`;
          return (
            <button
              key={video._id}
              type="button"
              data-post-id={video._id}
              data-creator-id={video.user?._id}
              onClick={() => onSelectVideo(video)}
              className="group relative aspect-3/4 cursor-pointer overflow-hidden rounded-xl max-lg:rounded-[3px] border border-white/10 bg-black/35 text-left"
              aria-label={isCurrent ? 'Currently playing' : `Open ${kind}: ${title}`}
            >
              <img src={poster} alt={title} className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${isCurrent ? 'scale-110 blur-xl brightness-50' : ''}`} />
              {video.isPinned ? <PostPinnedBadge className="absolute left-2 max-lg:left-px top-2 max-lg:top-px z-20 max-lg:h-2.5! max-lg:max-w-[calc(100%-2px)] max-lg:rounded-[2px]! max-lg:px-[2px]! max-lg:text-[6px]! max-lg:leading-[10px]!" /> : null}
              {photoPost ? <PostPhotoBadge imageCount={imageCount} className="absolute right-2 max-lg:right-px top-2 max-lg:top-px z-20 max-lg:h-2.5! max-lg:gap-0! max-lg:rounded-[2px]! max-lg:px-[2px]! max-lg:text-[6px]! max-lg:leading-[10px]! max-lg:[&_.anticon]:text-[7px]" /> : null}
              {isCurrent ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 max-lg:gap-0.5 bg-black/20 max-lg:bg-black/45 text-center">
                  <span className="currently-playing-bars flex h-6 max-lg:h-2.5 items-end gap-0.5 max-lg:gap-px" aria-hidden title="Currently playing" aria-label="Currently playing">
                    <i className="h-3 w-1 rounded-full bg-white" />
                    <i className="h-5 w-1 rounded-full bg-white" />
                    <i className="h-4 w-1 rounded-full bg-white" />
                  </span>
                  <span className="text-[11px] max-lg:hidden font-semibold text-white/90">Currently playing</span>
                </div>
              ) : (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/25 to-transparent px-2 max-lg:px-1 pb-2 max-lg:pb-0.5 pt-10 max-lg:pt-4">
                  <span className='flex items-center max-lg:text-[7px]'>
                    <HeartOutlineIcon className="text-2xl max-lg:text-[9px] text-white" />
                    <span>{formatCompactCount(video.totalLike)}</span>
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {error ? <p className="py-5 max-lg:py-2 text-center text-xs max-lg:text-[9px] text-red-300">{error}</p> : null}
      {loading ? <div className="ml-auto mr-auto mt-6 mb-6 max-lg:mt-3 max-lg:mb-3 h-6 w-6 max-lg:h-4 max-lg:w-4 animate-spin rounded-full border-2 max-lg:border border-white/20 border-t-white" /> : null}
      <div ref={sentinelRef} className="h-1" aria-hidden />
      {!hasMore && posts.length > 0 ? <p className="py-5 max-lg:py-2.5 text-center text-xs max-lg:text-[9px] text-white/35">All videos loaded</p> : null}
    </div>
  );
}

export default function PostVideoDetailPanel({
  post,
  activeTab,
  creatorVideos,
  creatorVideosLoading,
  creatorVideosHasMore,
  creatorVideosError,
  onLoadMoreCreatorVideos,
  onSelectVideo,
  onTabChange,
  onClose,
  rightOffset = '0px',
  totalComment,
  onTotalCommentChange,
  onCommentCreate,
  targetCommentId = null,
  targetCommentFallbackId = null
}: PostVideoDetailPanelProps) {
  /**
   * Keep the selected tab inside the scroller.
   *
   * The five tabs need more width than half a 440px stage, so on a compact
   * viewport the strip scrolls. The selection often arrives from somewhere
   * other than a tap on the strip itself — the action rail's Comment button, a
   * notification deep link — and without this it could land off-screen with no
   * sign that it was the active one. `scroll-mr` on the tabs keeps it clear of
   * the close button.
   */
  const tabStripRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const strip = tabStripRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    strip.querySelector<HTMLElement>('[data-panel-tab="active"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  const { current: currentUser } = useProfile();
  const initialIsFollowed = Boolean(post.user?.isFollowed);
  const followState = useFollowCreator(post.user?._id, initialIsFollowed);
  // The server count already reflects the state the post was loaded with, so only the viewer's own
  // change since then shifts it.
  const followerCount = Math.max(
    0,
    (post.user?.stats?.followers || 0)
    + (followState.isFollowed ? 1 : 0)
    - (initialIsFollowed ? 1 : 0)
  );
  const creatorName = post.user?.name || post.user?.username || 'Unknown';
  const description = post.text || post.tagline || 'No description available.';
  const timeText = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  return (
    <aside
      className="@container/detailpanel absolute inset-y-0 z-70 flex flex-col justify-between overflow-hidden border-l border-white/10 bg-[#191a23] text-white shadow-[-24px_0_60px_rgba(0,0,0,.22)]"
      style={{ right: rightOffset, width: 'var(--post-video-detail-panel-width, 28.5714%)' }}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="relative h-15 max-lg:h-9 shrink-0 border-b border-white/8 px-4 max-lg:flex max-lg:items-center max-lg:gap-0.5 max-lg:px-1">
        <nav
          ref={tabStripRef}
          className="flex h-15 max-lg:h-9 min-w-0 flex-1 items-center justify-between pr-13 max-lg:pr-0 max-lg:overflow-x-auto max-lg:[scrollbar-width:none] max-lg:[&::-webkit-scrollbar]:hidden text-[14px] font-normal leading-5 min-[1440px]:text-[16px]"
          aria-label="Video details"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              aria-label={tab.label}
              title={tab.label}
              data-panel-tab={activeTab === tab.key ? 'active' : undefined}
              className={`relative flex h-15 max-lg:h-9 shrink-0 whitespace-nowrap items-center justify-center border-b-[3px] max-lg:border-b-2 max-lg:px-0 text-[16px] @max-[10.5rem]/detailpanel:text-[7px] @max-[8.6rem]/detailpanel:text-[6px] max-lg:text-[8px] font-normal leading-14.25 max-lg:leading-9 transition-colors cursor-pointer text-white/45 hover:text-white/90 hover:border-white/5 ${activeTab === tab.key
                ? 'border-[#ff2c55]! text-white! cursor-default!'
                : 'border-transparent text-white/60'
                }`}
            >
              {tab.compactLabel ? (
                <>
                  <span className="max-lg:hidden">{tab.label}</span>
                  <span className="lg:hidden">{tab.compactLabel}</span>
                </>
              ) : <span>{tab.label}</span>}
            </button>
          ))}
        </nav>

        <button
          type="button"
          onClick={onClose}
          className="absolute max-lg:static right-4 top-1/2 z-100 flex h-9 w-9 max-lg:h-4.5 max-lg:w-4.5 max-lg:shrink-0 -translate-y-1/2 max-lg:translate-y-0 cursor-pointer items-center justify-center rounded-full text-xl max-lg:text-[9px] text-white/45 hover:text-white/90"
          aria-label="Close details panel"
        >
          <FaTimes />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'details' ? (
          <div className="px-4 max-lg:px-2 py-5 max-lg:py-2 space-y-2 max-lg:space-y-1 max-lg:text-[10px]">
            <div className="flex items-center gap-3 max-lg:gap-1.5">
              <div className="min-w-0">
                <div className="mb-2 max-lg:mb-0.5 text-lg max-lg:text-[11px] max-lg:leading-[15px] font-bold">
                  @{post.user?.username || creatorName}{timeText ? <span className="ml-2 max-lg:ml-1 text-xs max-lg:text-[9px] font-semibold text-white/85">· {timeText}</span> : null}
                </div>
              </div>
            </div>
            <PostTextContent
              text={description}
              className="whitespace-pre-wrap text-[15px] max-lg:text-[10px] font-medium leading-7 max-lg:leading-[14px] text-white/92"
            />
          </div>
        ) : null}

        {activeTab === 'videos' ? (
          <CreatorVideoGrid
            post={post}
            following={followState.isFollowed}
            followPending={followState.following}
            isOwnProfile={followState.isOwner}
            followerCount={followerCount}
            onToggleFollow={() => void followState.toggleFollow()}
            posts={creatorVideos}
            loading={creatorVideosLoading}
            hasMore={creatorVideosHasMore}
            error={creatorVideosError}
            loadMore={onLoadMoreCreatorVideos}
            onSelectVideo={onSelectVideo}
          />
        ) : null}

        {activeTab === 'comments' ? (
          <CommentWrapper
            contentId={post._id}
            contentType="post"
            user={currentUser}
            initialVisible
            canReply
            autoload
            initialTotalComments={totalComment ?? post.totalComment ?? 0}
            onTotalChange={onTotalCommentChange}
            onCommentCreate={onCommentCreate}
            targetCommentId={targetCommentId}
            postOwnerId={post.user?._id || (post as any).userId || null}
            viewerId={currentUser?._id || null}
            targetCommentFallbackId={targetCommentFallbackId}
            className="max-h-none! h-full"
          />
        ) : null}

        {activeTab === 'ask-ai' ? (
          <div className="px-4 py-5 flex min-h-72 flex-col items-center justify-center text-center">
            <div className="mb-3 max-lg:mb-1.5 rounded-full bg-white/8 px-4 max-lg:px-2 py-2 max-lg:py-1 text-sm max-lg:text-[10px] font-bold">Ask AI</div>
            <p className="max-w-64 text-sm max-lg:text-[10px] leading-6 max-lg:leading-[14px] text-white/50">AI questions about this video will be available here.</p>
          </div>
        ) : null}

        {activeTab === 'related' ? (
          <div className="px-4 py-5 flex min-h-72 flex-col items-center justify-center text-center">
            <p className="text-sm max-lg:text-[10px] font-semibold text-white/70">No related videos yet</p>
            <p className="mt-1 max-lg:mt-0.5 text-xs max-lg:text-[9px] text-white/40">Recommendations will appear as you keep watching.</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
