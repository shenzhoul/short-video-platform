'use client';

import { formatCompactCount } from '@components/content/post/home-feed-media';
import CreatorProfileBio from '@components/creator/creator-profile-bio';
import type { FollowListTabKey } from '@components/creator/creator-profile-follower-following';
import ProfileMessageButton from '@components/message/profile-message-button';
import CoverUpload from '@components/shared/cover-upload';
import HoverRevealPanel from '@components/ui/hover-reveal-panel';
import SearchInput from '@components/ui/search-input';
import ToggleSwitch from '@components/ui/toggle-switch';
import { toast } from '@douyin-clone/shared-toast';
import { useFollowCreator } from '@hooks/use-follow-creator';
import { useFollowStats } from '@hooks/use-follow-stats';
import { ICreator } from '@interfaces/creator';
import { DEFAULT_AVATAR_URL, resolveAvatarUrl } from '@lib/avatar';
import { useFollowListModal } from '@providers/follow-list.provider';
import { FiAlertTriangle, FiGrid, FiLink } from 'react-icons/fi';
import { DownloadIcon, EditIcon, HelpCircleIcon, MaleIcon, MoreIcon } from 'src/icons';

import { CreatorProfileCurrentUser } from './creator-profile-types';

interface CreatorProfileHeaderProps {
  creator: ICreator;
  currentUser?: CreatorProfileCurrentUser | null;
  canEditProfile: boolean;
  previewName: string;
  previewBio: string;
  previewAvatar: string;
  previewCover: string;
  previewCoverBgColor: string;
  onOpenEdit: () => void;
  onOpenAvatarPreview: () => void;
  onPreviewCoverChange: (url: string) => void;
  onPreviewCoverBgColorChange: (color: string) => void;
}

interface ShareFriend {
  name: string;
  avatar: string;
  status?: string;
}

function SaveLoginHelpPanel() {
  return (
    <div className="whitespace-nowrap rounded-xl bg-(--surface-raised) px-4 py-3 text-[13px] leading-5 text-(--text-strong) shadow-(--shadow-popover)">
      Save login information; next login requires no verification
    </div>
  );
}

function MoreActionsPanel() {
  return (
    <div className="w-25 rounded-xl bg-(--surface-raised) p-1.5 text-[14px] text-(--text-strong) shadow-(--shadow-popover)">
      <button type="button" className="mb-1 block h-10 w-full cursor-pointer rounded-lg px-4 text-center text-[12px] transition hover:bg-(--hover-bg)">
        Report
      </button>
      <button type="button" className="block h-10 w-full cursor-pointer rounded-lg px-4 text-center text-[12px] transition hover:bg-(--hover-bg)">
        Block
      </button>
    </div>
  );
}

function ShareHomepagePanel({
  friends,
  onCopyLink
}: {
  friends: ShareFriend[];
  onCopyLink: () => void;
}) {
  return (
    <div className="w-75 overflow-hidden rounded-xl bg-(--surface-raised) text-(--text-strong) shadow-(--shadow-popover)">
      <div className="border-b border-(--border-soft) px-3 py-3">
        <SearchInput variant="share-popover" placeholder="Search" />
      </div>
      <div className="px-3 pt-3 text-[13px] font-medium text-(--text-muted)">Share with friends</div>
      <div className="m-0 p-0">
        {friends.map((friend) => (
          <div key={friend.name} className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-(--hover-bg)">
            <img src={friend.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] leading-5 text-(--text-strong)">{friend.name}</div>
              {friend.status ? <div className="truncate text-[12px] leading-4 text-(--text-muted)">{friend.status}</div> : null}
            </div>
            <button
              type="button"
              className="h-8 min-w-17 cursor-pointer rounded-lg bg-[#fe2c55] px-4 text-[14px] text-white transition hover:bg-[#e4264e]"
            >
              Share
            </button>
          </div>
        ))}
      </div>
      <div className="py-7 text-center text-[12px] font-medium text-(--text-faint)">No more for now</div>
      <div className="flex items-center gap-2 border-t border-(--border-soft) p-3">
        <button
          type="button"
          onClick={onCopyLink}
          className="flex h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-(--surface-muted) text-[13px] text-(--text-strong) transition hover:bg-(--hover-bg)"
        >
          <FiLink className="text-[15px]" />
          Copy the link
        </button>
        <button type="button" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-(--surface-muted) text-(--text-strong) transition hover:bg-(--hover-bg)" aria-label="Share QR code">
          <FiGrid className="text-[16px]" />
        </button>
        <button type="button" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-(--surface-muted) text-(--text-strong) transition hover:bg-(--hover-bg)" aria-label="More share options">
          <FiAlertTriangle className="text-[16px]" />
        </button>
      </div>
    </div>
  );
}

export default function CreatorProfileHeader({
  creator,
  currentUser,
  canEditProfile,
  previewName,
  previewBio,
  previewAvatar,
  previewCover,
  previewCoverBgColor,
  onOpenEdit,
  onOpenAvatarPreview,
  onPreviewCoverChange,
  onPreviewCoverBgColorChange
}: CreatorProfileHeaderProps) {
  const likeCount = creator.stats?.totalLikes || 0;
  const followState = useFollowCreator(creator._id, Boolean(creator.isFollowed));

  // Seeded from the profile response, which counts the follow rows themselves,
  // and kept current by live snapshots. The account dropdown reads the very same
  // hook, so the two places a person sees their own totals cannot disagree.
  //
  // Live frames only ever arrive for the signed-in user, which is correct:
  // another creator's counters are not this viewer's to watch.
  const { followersCount: followerCount, followingCount, applyDelta } = useFollowStats({
    userId: creator._id,
    initial: {
      followersCount: creator.stats?.followers || 0,
      followingCount: creator.stats?.followings || 0
    }
  });

  // The one modal for the whole app, mounted beside the page. Opening it from
  // here and from the account dropdown reaches the same instance rather than
  // two copies that would then need keeping in step.
  const { openFollowList: openSharedFollowList } = useFollowListModal();
  const openFollowList = (tab: FollowListTabKey) => {
    // The creator whose profile this is — not the viewer.
    openSharedFollowList({ subjectUserId: creator._id, initialTab: tab });
  };

  const shareFriends: ShareFriend[] = [
    {
      name: currentUser?.username || 'Longkhongmap',
      avatar: DEFAULT_AVATAR_URL
    },
    {
      name: 'ShenZhouI',
      avatar: resolveAvatarUrl(previewAvatar),
      status: 'Online yesterday'
    },
    {
      name: 'Minimalist IAN',
      avatar: DEFAULT_AVATAR_URL
    },
    {
      name: 'Turning shadows to prayers',
      avatar: resolveAvatarUrl(previewCover || previewAvatar)
    }
  ];

  const copyProfileLink = async () => {
    if (typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Profile link copied');
    } catch {
      toast.error('Unable to copy link');
    }
  };

  return (
    <>
      <CoverUpload
        previewUrl={previewCover}
        coverBgColor={previewCoverBgColor}
        editable={canEditProfile}
        onUploaded={(data) => {
          if (data.fileInfo?.url) {
            onPreviewCoverChange(data.fileInfo.url);
          }
          if (data.fileInfo?.coverBgColor) {
            onPreviewCoverBgColorChange(data.fileInfo.coverBgColor);
          }
        }}
      />
      {/*
        Only the hero *content* is constrained by the message workspace.

        The cover above is deliberately left full-bleed, so its artwork still
        runs to the edge of the viewport behind the header — cutting it at the
        content boundary exposed a strip of page background in the top right.
        This wrapper puts the avatar, creator info and actions back inside the
        narrowed column so none of them can end up beneath the panel.
      */}
      <div className='w-[calc(100%-var(--message-workspace-width,0px))] transition-[width] duration-200 ease-out motion-reduce:transition-none'>
        <div className='pointer-events-none relative z-60 -mt-40 max-lg:-mt-9 max-w-380 w-full flex max-lg:flex-col max-lg:items-start mx-auto mb-5.25 max-lg:mb-2 max-lg:px-2'>
          <div className='w-28 max-lg:w-14 flex-none'>
            <button
              type="button"
              className='pointer-events-auto bg-transparent cursor-pointer relative w-28 h-28 max-lg:w-14 max-lg:h-14 box-content rounded-full overflow-hidden block border border-solid border-(--text-muted) text-(--text-strong) whitespace-nowrap text-center align-middle items-center justify-center'
              onClick={onOpenAvatarPreview}
              aria-label="Preview avatar"
            >
              <img src={resolveAvatarUrl(previewAvatar)} className='rounded-full w-full h-full object-cover block relative border-none' />
            </button>
          </div>
          <div className='min-h-30 max-lg:min-h-0 w-full min-w-0 flex-1 flex-wrap flex items-center content-center ml-8 max-lg:ml-0 max-lg:mt-1.5'>
            <div className='flex relative w-full'>
              <h1 className='m-0 text-xl max-lg:text-[15px] leading-7 max-lg:leading-5 pointer-events-auto'>
                <span className='block max-w-75 max-lg:max-w-[calc(100vw-7rem)] flex-none overflow-hidden text-ellipsis whitespace-nowrap text-(--text) text-xl max-lg:text-[15px] font-medium leading-7 max-lg:leading-5'>
                  {previewName}
                </span>
              </h1>
              {canEditProfile ? (
                <span className='pointer-events-auto cursor-pointer py-0.5' onClick={onOpenEdit}>
                  <EditIcon className='text-2xl max-lg:text-base text-(--text-muted)' />
                </span>
            ) : null}
            </div>
            <div className='w-full mt-1 max-lg:mt-0.5 flex flex-wrap gap-y-1 max-lg:gap-y-0.5'>
              <button
                type="button"
                className='pointer-events-auto flex items-center cursor-pointer after:content-[] after:inline-block after:w-0 after:h-4 max-lg:after:h-3 after:mx-4 max-lg:after:mx-2 after:border-l after:border-[#363741]'
                onClick={() => openFollowList('following')}
              >
                <div className='mr-1.5 max-lg:mr-1 text-sm max-lg:text-[11px] leading-5.5 max-lg:leading-4 text-(--text-muted) hover:text-(--text-strong)'>
                  Following
                </div>
                <div className='text-[16px] max-lg:text-[11px] leading-6 max-lg:leading-4 text-(--text)'>
                  {formatCompactCount(followingCount)}
                </div>
              </button>
              <button
                type="button"
                className='pointer-events-auto flex items-center cursor-pointer after:content-[] after:inline-block after:w-0 after:h-4 max-lg:after:h-3 after:mx-4 max-lg:after:mx-2 after:border-l after:border-[#363741]'
                onClick={() => openFollowList('follower')}
              >
                <div className='mr-1.5 max-lg:mr-1 text-sm max-lg:text-[11px] leading-5.5 max-lg:leading-4 text-(--text-muted) hover:text-(--text-strong)'>
                  Follower
                </div>
                <div className='text-[16px] max-lg:text-[11px] leading-6 max-lg:leading-4 text-(--text)'>
                  {formatCompactCount(followerCount)}
                </div>
              </button>
              <div className='flex items-center pointer-events-auto'>
                <div className='mr-1.5 text-sm leading-5.5 text-(--text-muted)'>
                  Received praise
                </div>
                <div className='text-[16px] max-lg:text-[11px] leading-6 max-lg:leading-4 text-(--text)'>
                  {formatCompactCount(likeCount)}
                </div>
              </div>
            </div>
            <p className='pointer-events-auto w-full h-5 max-lg:h-auto flex max-lg:flex-wrap max-lg:gap-y-0.5 items-center mt-3 max-lg:mt-1'>
              <span className='mr-5 max-lg:mr-2 text-[12px] max-lg:text-[10px] leading-5 max-lg:leading-3.5 text-(--text-muted)'>
                Douyin ID: {creator.username}
              </span>
              <span className='mr-5 max-lg:mr-2 text-[12px] max-lg:text-[10px] leading-5 max-lg:leading-3.5 text-(--text-muted)'>
                IP location: Guangdong
              </span>
              <span className='h-5 max-lg:h-4 text-(--text-soft) bg-(--surface-muted) rounded-sm items-center mr-1 px-2 max-lg:px-1 py-0 flex text-[12px] max-lg:text-[10px] leading-5 max-lg:leading-4'>
                <MaleIcon className='text-xs mr-1' /> 28 years old
              </span>
              <span className='h-5 max-lg:h-4 text-(--text-soft) bg-(--surface-muted) rounded-sm items-center mr-1 px-2 max-lg:px-1 py-0 flex text-[12px] max-lg:text-[10px] leading-5 max-lg:leading-4'>
                Guangdong Â· Shenzhen
              </span>
            </p>
            <CreatorProfileBio bio={previewBio} />
          </div>
          {/*
          Capped to its own content rather than a fixed 470px.

          The two rows this column is designed to hold — "Share homepage" above,
          the action buttons below — need 486px for the current labels, so the
          old fixed cap left the buttons hanging 16px past the profile column.
          Harmless while nothing was over there; once the message workspace took
          that space the Download action sat underneath it. `max-content` keeps
          the column bounded without re-breaking if a label changes length.
        */}
          <div className='pointer-events-auto max-w-max max-lg:max-w-full flex-wrap content-between h-28 max-lg:h-auto max-lg:gap-x-2 max-lg:gap-y-1 items-center flex absolute max-lg:static right-0 bottom-2 max-lg:mt-1.5 max-lg:w-full'>
            {(!currentUser || currentUser._id !== creator._id) && (
            <div className='w-full flex-row-reverse flex relative'>
              <HoverRevealPanel
                panel={<MoreActionsPanel />}
                className="flex items-center"
                panelPositionClassName="right-[-10px] top-full pt-2"
              >
                <button type="button" className='h-6.5 w-9 m-0 p-0 cursor-pointer flex items-center justify-center'>
                  <MoreIcon className='text-2xl' />
                </button>
              </HoverRevealPanel>
              <HoverRevealPanel
                panel={<ShareHomepagePanel friends={shareFriends} onCopyLink={copyProfileLink} />}
                className="flex items-center"
                panelPositionClassName="right-[-28px] top-full pt-3"
              >
                <button type="button" className='h-6.5 w-auto m-0 ml-2 p-0 text-(--text-strong) cursor-pointer'>
                  <span className='relative flex items-center text-(--text) hover:text-(--text-strong)'>
                    Share homepage
                  </span>
                </button>
              </HoverRevealPanel>
            </div>
          )}
            {canEditProfile ? (
              <div className='w-full max-lg:w-auto flex-row-reverse max-lg:flex-row flex relative'>
                <div className='ml-auto max-lg:ml-0 z-1 h-full inline-flex items-center justify-center'>
                  <HoverRevealPanel
                    panel={<SaveLoginHelpPanel />}
                    panelPositionClassName="right-[-180px] top-full pt-2"
                  >
                    <div className='cursor-pointer w-4 h-4'>
                      <HelpCircleIcon className='text-[16px]' />
                    </div>
                  </HoverRevealPanel>
                  <div className='w-19 max-lg:w-auto h-5.5 max-lg:h-4 spacing tracking-[0.6px] ml-2 max-lg:ml-1 mr-2 max-lg:mr-1 text-xs max-lg:text-[10px] leading-5 max-lg:leading-4 whitespace-nowrap text-(--text-soft)'>Save login</div>
                  <ToggleSwitch aria-label="Save login" />
                </div>
              </div>
          ) : null}
            <div className='flex ml-auto max-lg:ml-0'>
              {(!currentUser || currentUser._id !== creator._id) && (
              <div className='flex'>
                <button
                  type="button"
                  onClick={async () => {
                    const wasFollowed = followState.isFollowed;
                    const step = wasFollowed ? -1 : 1;
                    // Optimistic, because this creator's live snapshot goes to
                    // them and not to us. Rolled back if the request fails, so a
                    // refused follow cannot leave an invented number on screen.
                    applyDelta({ followersCount: step });
                    try {
                      await followState.toggleFollow();
                    } catch (error) {
                      applyDelta({ followersCount: -step });
                      throw error;
                    }
                  }}
                  disabled={followState.following}
                  className={`rounded-xl min-w-22 h-8.25 m-o mr-2 text-[14px] font-medium leading-5.5 cursor-pointer inline-flex py-1.5 px-4 items-center justify-center border-0 border-solid border-transparent whitespace-nowrap disabled:cursor-wait disabled:opacity-60 ${followState.isFollowed
                    ? 'bg-(--field-bg) text-(--text-soft) hover:bg-[rgba(242,242,244,.12)]'
                    : 'bg-[rgba(254,44,85,1)] text-white hover:bg-[rgba(210,27,70,1)]'}`}
                >
                  <span className='flex items-center'>
                    {followState.isFollowed ? 'Following' : 'Follow'}
                  </span>
                </button>
                <ProfileMessageButton
                  creatorId={creator._id?.toString()}
                  className='rounded-xl min-w-22 h-8.25 m-o mr-2 bg-(--field-bg) text-(--text-soft) text-[14px] font-medium leading-5.5 cursor-pointer inline-flex py-1.5 px-4 items-center justify-center border-0 border-solid border-transparent whitespace-nowrap hover:bg-[rgba(242,242,244,.12)] disabled:cursor-wait disabled:opacity-60'
                />
              </div>
            )}
              {currentUser ? (
                <div className='h-8.25 max-lg:h-6 rounded-4xl m-o ml-2 max-lg:ml-1 transition-all duration-300 ease-in-out overflow-hidden'>
                  <div className='bg-(--field-bg) text-(--text-soft) rounded-xl justify-between flex-row items-center text-[13px] flex overflow-hidden'>
                    <div className='py-1.5 max-lg:py-0.5 pr-0 pl-3 max-lg:pl-1.5 w-45 max-lg:w-auto max-lg:text-[10px] whitespace-nowrap flex justify-center'>
                      Download the PC client
                    </div>
                    <a className='bg-(--glass-bg) text-(--text-strong) font-bold py-1.5 max-lg:py-0.5 px-3 max-lg:px-1.5 max-lg:text-[10px] h-full cursor-pointer whitespace-nowrap items-center flex transition-all duration-300 ease-in-out hover:bg-[rgba(255,44,85,1)]'>
                      <DownloadIcon className='text-sm pr-0.5' />
                      <span>Download</span>
                    </a>
                  </div>
                </div>
            ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
