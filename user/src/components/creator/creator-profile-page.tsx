'use client';

import PostDetailModal from '@components/content/post/post-detail-modal';
import CreatorProfileAvatarPreview from '@components/creator/creator-profile-avatar-preview';
import CreatorProfileHeader from '@components/creator/creator-profile-header';
import {
  CREATOR_PROFILE_TAB_PARAM,
  CreatorProfilePageProps,
  CreatorProfileTabItem,
  isCreatorProfileUrlTab
} from '@components/creator/creator-profile-types';
import CreatorProfileWorkItem from '@components/creator/creator-profile-work-item';
import CreatorProfileWorksToolbar from '@components/creator/creator-profile-works-toolbar';
import EditProfileModal from '@components/creator/edit-profile';
import { POST_PAGE_LIMIT } from '@constants/pagination';
import { PROFILE_COLLECTION_LABELS } from '@constants/profile-labels';
import { useCreatorBatchManagement } from '@hooks/use-creator-batch-management';
import { useCreatorPostSearch } from '@hooks/use-creator-post-search';
import { useHomeFeedPlayback } from '@hooks/use-home-feed-playback';
import { useLikedPosts } from '@hooks/use-liked-posts';
import type { PostInteractionChangeHandler } from '@hooks/use-post-interactions';
import { resolveAvatarUrl } from '@lib/avatar';
import { useCallback, useEffect, useRef, useState } from 'react';

function getProfileTabs(canEditProfile: boolean, worksTotal: number): CreatorProfileTabItem[] {
  const ownerProfileTabs: CreatorProfileTabItem[] = [
    { key: 'works', label: 'Works', count: worksTotal },
    { key: 'recommended', label: 'Recommended' },
    { key: 'liked', label: PROFILE_COLLECTION_LABELS.liked, locked: !canEditProfile },
    { key: 'collection', label: 'Collection', locked: true },
    { key: 'watch-history', label: PROFILE_COLLECTION_LABELS.watchHistory, locked: true },
    { key: 'watch-later', label: PROFILE_COLLECTION_LABELS.watchLater, locked: true },
    { key: 'appointment', label: PROFILE_COLLECTION_LABELS.appointment, locked: true }
  ];

  return canEditProfile ? ownerProfileTabs : ownerProfileTabs.slice(0, 3);
}

function getProfileFilters(canEditProfile: boolean) {
  return canEditProfile
    ? ['Works', 'Private works', 'Collection', 'Short plays']
    : ['Works', 'Collection', 'Short plays'];
}

/** Keeps the active tab shareable/back-navigable without triggering a server round trip. */
function updateProfileTabUrl(tab: string) {
  const url = new URL(window.location.href);
  if (tab === 'works') url.searchParams.delete(CREATOR_PROFILE_TAB_PARAM);
  else url.searchParams.set(CREATOR_PROFILE_TAB_PARAM, tab);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function CreatorProfilePage({
  creator,
  currentUser,
  initialPostData
}: CreatorProfilePageProps) {
  const [openEdit, setOpenEdit] = useState(false);
  const [openAvatarPreview, setOpenAvatarPreview] = useState(false);
  const [activeTab, setActiveTab] = useState('works');
  const [, setHoveredPostId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollStage, setScrollStage] = useState(0);
  const [previewName, setPreviewName] = useState(creator?.name || creator?.username || '');
  const [previewBio, setPreviewBio] = useState(creator?.bio || '');
  const [previewAvatar, setPreviewAvatar] = useState(resolveAvatarUrl(creator?.avatar));
  const [previewCover, setPreviewCover] = useState(creator?.cover || '');
  const [previewCoverBgColor, setPreviewCoverBgColor] = useState(creator?.coverBgColor || 'hsl(313deg 26.38% 15%)');
  const canEditProfile = currentUser?._id === creator._id;
  const {
    posts: works,
    total: worksTotal,
    hasMore: worksHasMore,
    loading: worksLoading,
    loadMore: loadMoreWorks,
    deletePosts,
    isDeleting,
    updatePostInteraction
  } = useCreatorPostSearch({
    // The profile being viewed, never inferred from the session. This is what
    // scopes every page after the server-rendered first one to the same creator.
    creatorId: creator._id,
    // The same page size the server render used. Left at the hook's default the
    // grid paged 20 then 12 at a time — harmless for correctness, because the
    // cursor carries the position, but it makes "which page is this" a
    // different answer on the server and the client for no reason.
    limit: POST_PAGE_LIMIT,
    initialPosts: initialPostData?.data || [],
    initialTotal: initialPostData?.total,
    initialHasMore: initialPostData?.hasMore,
    initialNextCursor: initialPostData?.nextCursor
  });
  const liked = useLikedPosts({
    enabled: canEditProfile && activeTab === 'liked',
    // The same page size the works grid uses, so "which page is this" has one
    // answer on this screen rather than two.
    limit: POST_PAGE_LIMIT
  });
  const isLikedTab = activeTab === 'liked';
  const posts = isLikedTab ? liked.posts : works;

  /**
   * Paging state for whichever grid is on screen.
   *
   * Both tabs render the same grid from the same `posts` array, so they must
   * page through the same sentinel. Wiring the observer to the works hook alone
   * is what left "I like it" at its first page: `useLikedPosts` exposed
   * `hasMore` and `loadMore` and nothing ever called them, so 67 liked posts
   * stopped at 20 and the footer printed the terminal message underneath.
   */
  const activeHasMore = isLikedTab ? liked.hasMore : worksHasMore;
  const activeLoading = isLikedTab ? liked.loading : worksLoading;
  const loadMoreLiked = liked.loadMore;
  const loadMoreActive = useCallback(() => {
    if (isLikedTab) loadMoreLiked();
    else loadMoreWorks();
  }, [isLikedTab, loadMoreLiked, loadMoreWorks]);

  // Pages the active grid as the viewer reaches its end. `rootMargin` starts the
  // request a screen early so the list grows before the viewer hits the bottom.
  const worksSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = worksSentinelRef.current;
    if (!sentinel || !activeHasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMoreActive();
    }, { rootMargin: '400px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMoreActive, activeHasMore]);
  const unlikeLikedPosts = liked.unlikePosts;
  const updateLikedPostInteraction = liked.updatePostInteraction;
  const upsertLikedPost = liked.upsertLikedPost;
  const handleUnlikeLikedPosts = useCallback(async (ids: string[]) => {
    const unlikedIds = await unlikeLikedPosts(ids);
    const unlikedIdSet = new Set(unlikedIds);
    works.forEach((post) => {
      if (!unlikedIdSet.has(post._id) || !post.isLiked) return;
      updatePostInteraction(post._id, {
        isLiked: false,
        totalLike: Math.max(0, post.totalLike - 1)
      });
    });
    return unlikedIds;
  }, [unlikeLikedPosts, updatePostInteraction, works]);
  const handleLikedPostInteraction = useCallback<PostInteractionChangeHandler>((postId, patch) => {
    updateLikedPostInteraction(postId, patch);
    updatePostInteraction(postId, patch);
  }, [updateLikedPostInteraction, updatePostInteraction]);
  const handleWorksPostInteraction = useCallback<PostInteractionChangeHandler>((postId, patch) => {
    const post = works.find((item) => item._id === postId);
    updatePostInteraction(postId, patch);
    if (patch.isLiked === true && post && !post.isLiked) {
      upsertLikedPost(post, patch);
      return;
    }
    updateLikedPostInteraction(postId, patch);
  }, [updateLikedPostInteraction, updatePostInteraction, upsertLikedPost, works]);
  const updateActivePostInteraction = isLikedTab
    ? handleLikedPostInteraction
    : handleWorksPostInteraction;
  const batchManagement = useCreatorBatchManagement({
    posts,
    execute: isLikedTab ? handleUnlikeLikedPosts : deletePosts
  });
  const playback = useHomeFeedPlayback(posts, updateActivePostInteraction);
  const profileTabs = getProfileTabs(canEditProfile, worksTotal);
  const profileFilters = getProfileFilters(canEditProfile);
  const handleTabChange = (tab: string) => {
    if (tab !== 'works' && tab !== 'liked') return;
    if (tab === activeTab) return;
    batchManagement.reset();
    if (playback.detailPost) playback.closeDetailPost();
    setActiveTab(tab);
    updateProfileTabUrl(tab);
  };
  const handleScroll = () => {
    const top = scrollContainerRef.current?.scrollTop || 0;
    const nextStage = top > 160 ? 2 : top > 48 ? 1 : 0;
    setScrollStage((currentStage) => (currentStage === nextStage ? currentStage : nextStage));
  };

  // Read on the client rather than during render so server and client markup match; the profile is
  // server-rendered and `window` is not available there.
  useEffect(() => {
    const syncTabFromUrl = () => {
      const tab = new URL(window.location.href).searchParams.get(CREATOR_PROFILE_TAB_PARAM);
      if (!isCreatorProfileUrlTab(tab)) return;
      // The liked tab only ever loads content for the profile owner.
      if (tab === 'liked' && !canEditProfile) return;
      setActiveTab((current) => (current === tab ? current : tab));
    };

    syncTabFromUrl();
    window.addEventListener('popstate', syncTabFromUrl);
    return () => window.removeEventListener('popstate', syncTabFromUrl);
  }, [canEditProfile]);

  useEffect(() => {
    const root = document.documentElement;
    const previousHeader = root.style.getPropertyValue('--header-bg');
    if (scrollStage > 0) root.style.setProperty('--header-bg', 'var(--page-bg)');
    else root.style.removeProperty('--header-bg');

    return () => {
      if (previousHeader) root.style.setProperty('--header-bg', previousHeader);
      else root.style.removeProperty('--header-bg');
    };
  }, [scrollStage]);

  return (
    <>
      <div className='min-h-0 w-full flex flex-col flex-1'>
        {/*
          Given back the width the message workspace took from the page.

          The shell narrows every page so feeds reflow, but on a profile only the
          *content* should lose that width — the cover artwork has to keep running
          to the edge of the viewport, exactly as it does with messages closed.
          The hero content and the works column below re-apply the narrowing
          themselves, so they still reflow.
        */}
        <div
          ref={scrollContainerRef}
          className='-mt-14 max-lg:-mt-8 scrollbar-none overflow-auto flex-1 w-[calc(100%+var(--message-workspace-width,0px))]'
          onScroll={handleScroll}
        >
          <div className='w-full max-w-none lg:min-w-170.5 min-h-[calc(var(--app-viewport-height)-60px)] relative pt-14 max-lg:pt-8 mx-0 my-auto'>
            <CreatorProfileHeader
              creator={creator}
              currentUser={currentUser}
              canEditProfile={canEditProfile}
              previewName={previewName}
              previewBio={previewBio}
              previewAvatar={previewAvatar}
              previewCover={previewCover}
              previewCoverBgColor={previewCoverBgColor}
              onOpenEdit={() => setOpenEdit(true)}
              onOpenAvatarPreview={() => setOpenAvatarPreview(true)}
              onPreviewCoverChange={setPreviewCover}
              onPreviewCoverBgColorChange={setPreviewCoverBgColor}
            />
            {/* The works column is message-aware; the cover above it is not. */}
            <div className='bg-profile w-[calc(100%-var(--message-workspace-width,0px))] transition-[width] duration-200 ease-out motion-reduce:transition-none'>
              <div className='max-w-380 mx-auto max-lg:px-2.5'>
                <CreatorProfileWorksToolbar
                  canEditProfile={canEditProfile}
                  filters={isLikedTab ? [] : profileFilters}
                  previewAvatar={previewAvatar}
                  scrollStage={scrollStage}
                  tabs={profileTabs}
                  activeTab={activeTab}
                  managementVariant={isLikedTab ? 'unlike' : 'delete'}
                  batchMode={batchManagement.active}
                  selectedCount={batchManagement.selectedCount}
                  allSelected={batchManagement.allSelected}
                  isProcessing={isLikedTab ? liked.isUnliking : isDeleting}
                  onTabChange={handleTabChange}
                  onToggleBatchMode={batchManagement.toggleActive}
                  onToggleSelectAll={batchManagement.toggleSelectAll}
                  onExecuteSelected={batchManagement.executeSelected}
                />
                <div className='relative'>
                  <div className='w-full'>
                    <div className='w-full pt-2'>
                      {posts.length > 0 ? (
                        <>
                          {/*
                            Three columns on a compact viewport, six from
                            `lg` — the same six the fake inline-block grid used
                            to produce, at the same width: `grid-cols-6 gap-4`
                            gives (100% - 5x16px)/6, which is exactly the
                            `calc(16.66% - 13.34px)` the tiles carried.
                          */}
                          {/*
                            One gap value, not two. The compact grid used
                            `gap-x-2.5 gap-y-3` — 10px across, 12px down — which
                            reads as a misalignment rather than a rhythm at
                            three columns. `gap-2.5` is the same 10px in both
                            directions, and the tile width is unchanged.
                          */}
                          <ul className="grid w-full grid-cols-3 gap-4 max-lg:gap-2.5 lg:grid-cols-6 leading-0">
                            {posts.map((post) => (
                              <CreatorProfileWorkItem
                                key={post._id}
                                post={post}
                                metricVariant={isLikedTab || !canEditProfile ? 'likes' : 'views'}
                                popupPipState={playback.popupPipState}
                                onCompactHoverChange={setHoveredPostId}
                                onOpenDetail={playback.openDetailPost}
                                batchMode={batchManagement.active}
                                selected={batchManagement.isSelected(post._id)}
                                onToggleSelection={batchManagement.toggleSelection}
                                // Works is this creator's own collection, where
                                // pinning decides the order. "I like it" holds
                                // other people's posts, where their pin means
                                // nothing — and used to show "Pinned on top"
                                // anyway.
                                showPinnedBadge={!isLikedTab}
                              />
                            ))}
                          </ul>
                          {/*
                            The grid pages. It used to print "No more for now"
                            unconditionally under a list that could never grow —
                            harmless on a catalogue where every creator has ten
                            posts against a twenty-post page, and silently
                            unreachable content for anyone with more.
                          */}
                          {activeHasMore ? (
                            <div ref={worksSentinelRef} className='h-8' aria-hidden />
                          ) : null}
                          {/*
                            The terminal message is the server's word, never the
                            client's guess. It used to print unconditionally on
                            the liked tab, under a list that had only ever asked
                            for its first page.
                          */}
                          <div className='mt-15.5 flex justify-center text-[12px] font-semibold leading-5 text-(--text-disabled)'>
                            {activeLoading
                              ? 'Loading more...'
                              : activeHasMore
                                ? ''
                                : 'No more for now'}
                          </div>
                        </>
                      ) : (
                        <div className='flex h-80 items-center justify-center text-[13px] font-semibold text-(--text-faint)'>
                          {isLikedTab && liked.loading ? 'Loading liked posts...' : isLikedTab ? 'No liked posts yet' : 'No works yet'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <EditProfileModal
        open={openEdit}
        onClose={() => setOpenEdit(false)}
        user={{
          ...creator,
          avatar: previewAvatar,
          name: previewName,
          bio: previewBio
        }}
        onAvatarUploaded={setPreviewAvatar}
        onProfileUpdated={(profile) => {
          setPreviewName(profile.name);
          setPreviewBio(profile.bio || '');
        }}
      />
      <CreatorProfileAvatarPreview
        avatar={previewAvatar}
        displayName={previewName}
        username={creator.username}
        open={openAvatarPreview}
        onClose={() => setOpenAvatarPreview(false)}
      />
      {playback.detailPost ? (
        <PostDetailModal
          post={playback.detailPost}
          posts={posts}
          initialTime={playback.detailInitialTime}
          onPlaybackTimeChange={() => undefined}
          onClose={playback.closeDetailPost}
          onNavigate={playback.navigateDetailPost}
          onInteractionChange={playback.handleInteractionChange}
        />
      ) : null}
    </>
  );
}
