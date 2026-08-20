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
import { useCreatorBatchManagement } from '@hooks/use-creator-batch-management';
import { useCreatorPostSearch } from '@hooks/use-creator-post-search';
import { useHomeFeedPlayback } from '@hooks/use-home-feed-playback';
import { useLikedPosts } from '@hooks/use-liked-posts';
import type { PostInteractionChangeHandler } from '@hooks/use-post-interactions';
import { useCallback, useEffect, useRef, useState } from 'react';

function getProfileTabs(canEditProfile: boolean, worksTotal: number): CreatorProfileTabItem[] {
  const ownerProfileTabs: CreatorProfileTabItem[] = [
    { key: 'works', label: 'Works', count: worksTotal },
    { key: 'recommended', label: 'Recommended' },
    { key: 'liked', label: 'I like it', locked: !canEditProfile },
    { key: 'collection', label: 'Collection', locked: true },
    { key: 'watch-history', label: 'Watch history', locked: true },
    { key: 'watch-later', label: 'We\'ll look at it later', locked: true },
    { key: 'appointment', label: 'My appointment', locked: true }
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
  const [previewAvatar, setPreviewAvatar] = useState(creator?.avatar || '');
  const [previewCover, setPreviewCover] = useState(creator?.cover || '');
  const [previewCoverBgColor, setPreviewCoverBgColor] = useState(creator?.coverBgColor || 'hsl(313deg 26.38% 15%)');
  const canEditProfile = currentUser?._id === creator._id;
  const {
    posts: works,
    total: worksTotal,
    deletePosts,
    isDeleting,
    updatePostInteraction
  } = useCreatorPostSearch({
    initialPosts: initialPostData?.data || [],
    initialTotal: initialPostData?.total,
    initialHasMore: initialPostData?.hasMore,
    initialNextCursor: initialPostData?.nextCursor
  });
  const liked = useLikedPosts({
    enabled: canEditProfile && activeTab === 'liked'
  });
  const isLikedTab = activeTab === 'liked';
  const posts = isLikedTab ? liked.posts : works;
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
          className='-mt-14 scrollbar-none overflow-auto flex-1 w-[calc(100%+var(--message-workspace-width,0px))]'
          onScroll={handleScroll}
        >
          <div className='w-full max-w-none min-w-170.5 min-h-[calc(100vh-60px)] relative pt-14 mx-0 my-auto'>
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
              <div className='max-w-380 mx-auto'>
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
                          <ul className="w-full leading-0">
                            {posts.map((post) => (
                              <CreatorProfileWorkItem
                                key={post._id}
                                post={post}
                                metricVariant={isLikedTab || !canEditProfile ? 'likes' : 'views'}
                                popupPipState={playback.popupPipState}
                                popupPlaylist={playback.popupPlaylist}
                                onCompactHoverChange={setHoveredPostId}
                                onOpenDetail={playback.openDetailPost}
                                batchMode={batchManagement.active}
                                selected={batchManagement.isSelected(post._id)}
                                onToggleSelection={batchManagement.toggleSelection}
                              />
                            ))}
                          </ul>
                          <div className='mt-15.5 flex justify-center text-[12px] font-semibold leading-5 text-(--text-disabled)'>
                            No more for now
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
          popupPlaylist={playback.popupPlaylist}
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
