'use client';

import { useFollowCreator } from '@hooks/use-follow-creator';
import { IPost } from '@interfaces/post';
import { useProfile } from '@providers/profile.provider';
import dynamic from 'next/dynamic';
import { useEffect, useRef } from 'react';
import { FaChevronRight, FaTimes } from 'react-icons/fa';
import { HeartOutlineIcon } from 'src/icons';

import { formatCompactCount, getPostMedia } from './home-feed-media';
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
}

const tabs: Array<{ key: PostVideoDetailTab; label: string }> = [
  { key: 'details', label: 'Details' },
  { key: 'videos', label: 'Videos' },
  { key: 'comments', label: 'Comments' },
  { key: 'ask-ai', label: 'Ask AI' },
  { key: 'related', label: 'Related' }
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
    <div className='px-4'>
      <div className='h-auto m-0 py-[calc(0.714286vw+5.71429px)]'>
        <div className='flex items-center justify-between'>
          <div className='max-w-none flex items-center'>
            <div className='flex-1'>
              <a href={`/${post.user?.username}`} className='h-11.5 flex flex-col justify-between relative'>
                <div className='max-w-none h-5.5 truncate text-white/90 text-sm flex items-center hover:text-white'>
                  <span>@</span>
                  <span>{post.user?.name}</span>
                  <FaChevronRight className='text-xs text-white/60 ml-0.5' />
                </div>
                <div className='text-white/90 text-sm h-5 flex items-center hover:text-white'>
                  {formatCompactCount(followerCount)} followers
                  <span className='border-white text-[16px] font-medium w-0 h-2.5 border-l border-solid ml-2 mr-2 block' />
                  {formatCompactCount(post.user?.stats?.totalLikes)} likes
                </div>
              </a>
            </div>
          </div>
          <div className='flex items-center m-0 -mr-2'>
            {!isOwnProfile ? (
              <button
                type="button"
                onClick={onToggleFollow}
                disabled={followPending}
                className={`shrink-0 cursor-pointer rounded-lg px-4 py-2 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${following ? 'bg-white/12 text-white hover:bg-white/16' : 'bg-[#fe2c55] text-white hover:bg-[#e9274d]'}`}
                aria-pressed={following}
              >
                {following ? 'Following' : '+ Follow'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {posts.map((video) => {
          const isCurrent = video._id === post._id;
          const poster = getPostMedia(video);
          return (
            <button
              key={video._id}
              type="button"
              onClick={() => onSelectVideo(video)}
              className="group relative aspect-3/4 cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-black/35 text-left"
              aria-label={isCurrent ? 'Currently playing' : `Play ${video.text || video.tagline || 'video'}`}
            >
              <img src={poster} alt={video.text || video.tagline || 'Creator video'} className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] ${isCurrent ? 'scale-110 blur-xl brightness-50' : ''}`} />
              {video.isPinned ? <PostPinnedBadge className="absolute left-2 top-2 z-20" /> : null}
              {isCurrent ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/20 text-center">
                  <span className="currently-playing-bars flex h-6 items-end gap-0.5" aria-hidden>
                    <i className="h-3 w-1 rounded-full bg-white" />
                    <i className="h-5 w-1 rounded-full bg-white" />
                    <i className="h-4 w-1 rounded-full bg-white" />
                  </span>
                  <span className="text-[11px] font-semibold text-white/90">Currently playing</span>
                </div>
              ) : (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 via-black/25 to-transparent px-2 pb-2 pt-10">
                  <span className='flex items-center'>
                    <HeartOutlineIcon className="text-2xl text-white" />
                    <span>{formatCompactCount(video.totalLike)}</span>
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {error ? <p className="py-5 text-center text-xs text-red-300">{error}</p> : null}
      {loading ? <div className="ml-auto mr-auto mt-6 mb-6 h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" /> : null}
      <div ref={sentinelRef} className="h-1" aria-hidden />
      {!hasMore && posts.length > 0 ? <p className="py-5 text-center text-xs text-white/35">All videos loaded</p> : null}
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
  targetCommentId = null,
  targetCommentFallbackId = null
}: PostVideoDetailPanelProps) {
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
      className="absolute inset-y-0 z-70 flex flex-col justify-between overflow-hidden border-l border-white/10 bg-[#191a23] text-white shadow-[-24px_0_60px_rgba(0,0,0,.22)]"
      style={{ right: rightOffset, width: 'var(--post-video-detail-panel-width, 28.5714%)' }}
      onWheel={(event) => event.stopPropagation()}
    >
      <header className="relative h-15 shrink-0 border-b border-white/8 px-4">
        <nav
          className="flex h-15 flex-1 items-center justify-between pr-13 text-[14px] font-normal leading-5 min-[1440px]:text-[16px]"
          aria-label="Video details"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={`relative flex h-15 items-center justify-center border-b-[3px] text-[16px] font-normal leading-14.25 transition-colors cursor-pointer text-white/45 hover:text-white/90 hover:border-white/5 ${activeTab === tab.key
                ? 'border-[#ff2c55]! text-white! cursor-default!'
                : 'border-transparent text-white/60'
                }`}
            >
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-1/2 z-100 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center text-xl text-white/45 hover:text-white/90"
          aria-label="Close details panel"
        >
          <FaTimes />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'details' ? (
          <div className="px-4 py-5 space-y-2">
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <div className="mb-2 text-lg font-bold">
                  @{post.user?.username || creatorName}{timeText ? <span className="ml-2 text-xs font-semibold text-white/85">· {timeText}</span> : null}
                </div>
              </div>
            </div>
            <PostTextContent
              text={description}
              className="whitespace-pre-wrap text-[15px] font-medium leading-7 text-white/92"
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
            targetCommentId={targetCommentId}
            postOwnerId={post.user?._id || (post as any).userId || null}
            viewerId={currentUser?._id || null}
            targetCommentFallbackId={targetCommentFallbackId}
            className="max-h-none! h-full"
          />
        ) : null}

        {activeTab === 'ask-ai' ? (
          <div className="px-4 py-5 flex min-h-72 flex-col items-center justify-center text-center">
            <div className="mb-3 rounded-full bg-white/8 px-4 py-2 text-sm font-bold">Ask AI</div>
            <p className="max-w-64 text-sm leading-6 text-white/50">AI questions about this video will be available here.</p>
          </div>
        ) : null}

        {activeTab === 'related' ? (
          <div className="px-4 py-5 flex min-h-72 flex-col items-center justify-center text-center">
            <p className="text-sm font-semibold text-white/70">No related videos yet</p>
            <p className="mt-1 text-xs text-white/40">Recommendations will appear as you keep watching.</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
