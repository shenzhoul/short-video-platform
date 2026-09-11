'use client';

import { formatCompactCount } from '@components/content/post/home-feed-media';
import Dropdown from '@components/ui/dropdown-menu';
import Modal from '@components/ui/modal';
import SearchInput from '@components/ui/search-input';
import { toast } from '@douyin-clone/shared-toast';
import { useFollowCreator } from '@hooks/use-follow-creator';
import { FollowListSort, useFollowList } from '@hooks/use-follow-list';
import { IUser } from '@interfaces/user';
import { resolveAvatarUrl } from '@lib/avatar';
import { useProfile } from '@providers/profile.provider';
import { removeFollower as requestRemoveFollower } from '@services/user.service';
import Link from 'next/link';
import { type HTMLAttributes, useCallback, useEffect, useRef, useState } from 'react';
import { type TabItem, Tabs } from 'src/components/ui/tabs';
import { SortIcon } from 'src/icons';

const SORT_OPTIONS: Array<{ label: string; value: FollowListSort }> = [
  { label: 'Recently', value: 'recent' },
  { label: 'Earliest', value: 'earliest' }
];

export type FollowListTabKey = 'following' | 'follower';

interface Tab extends TabItem<FollowListTabKey> {
  text: string;
  total: number;
}

interface NavigationProps {
  tabs: Tab[];
  getTabProps: (item: Tab) => HTMLAttributes<HTMLElement>;
  isActive: (item: Tab) => boolean;
}

function Navigation({ tabs, getTabProps, isActive }: NavigationProps) {
  return (
    <nav role="tablist" className="relative box-border">
      <div className="flex h-12 max-lg:h-7 items-stretch gap-8 max-lg:gap-4">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            {...getTabProps(tab)}
            className={`inline-flex h-12 max-lg:h-7 shrink-0 cursor-pointer items-center border-b-[3px] max-lg:border-b-2 p-0 text-base max-lg:text-[12px] font-medium leading-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#fe2c55] ${isActive(tab)
              ? 'border-b-[#fe2c55] text-(--text-strong)'
              : 'border-b-transparent text-(--text-muted) hover:text-(--text-strong)'
              }`}
          >
            {tab.text} ({formatCompactCount(tab.total)})
          </button>
        ))}
      </div>
    </nav>
  );
}

interface FollowListRowProps {
  user: IUser;
  variant: FollowListTabKey;
  /** Only the profile owner may drop their own followers. */
  canRemoveFollower: boolean;
  onFollowChange: (userId: string, isFollowed: boolean) => void;
  onRemoved: (userId: string) => void;
  onNavigate: () => void;
}

function FollowListRow({
  user,
  variant,
  canRemoveFollower,
  onFollowChange,
  onRemoved,
  onNavigate
}: FollowListRowProps) {
  const [removing, setRemoving] = useState(false);
  const followState = useFollowCreator(user._id, Boolean(user.isFollowed), undefined, onFollowChange);
  const displayName = user.name || user.username || 'Unknown';

  const removeThisFollower = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await requestRemoveFollower(user._id);
      onRemoved(user._id);
      toast.success('Follower removed');
    } catch (error: any) {
      toast.error(error?.message || 'Unable to remove this follower');
    } finally {
      setRemoving(false);
    }
  };

  const followLabel = followState.isFollowed
    ? (variant === 'follower' ? 'Mutual follow' : 'Following')
    : 'Follow';

  return (
    <div data-follow-list-row>
      <div className='flex items-center mx-0 my-4.25 max-lg:my-0 max-lg:py-1.5'>
        <div className='cursor-pointer shrink-0'>
          <Link href={`/${user.username}`} onClick={onNavigate} className='relative bg-transparent'>
            <span className='bg-transparent w-15 h-15 max-lg:w-8.5 max-lg:h-8.5 rounded-full box-border block relative overflow-hidden border border-solid border-(--border-faint)'>
              <img
                src={resolveAvatarUrl(user.avatar)}
                alt={displayName}
                className='rounded-full w-full h-full object-cover block relative'
              />
            </span>
          </Link>
        </div>
        <div className='w-0 flex-1 mx-3 max-lg:mx-2'>
          <div className='my-1 max-lg:my-0 flex'>
            <div className='truncate text-(--text)'>
              <Link href={`/${user.username}`} onClick={onNavigate} className='relative bg-transparent'>
                <span className='truncate cursor-pointer text-[16px] max-lg:text-[11px] overflow-hidden leading-6 max-lg:leading-4 text-(--text) hover:text-(--text-strong)'>
                  {displayName}
                </span>
              </Link>
            </div>
          </div>
          {user.bio ? (
            <div className='text-(--text) my-1 max-lg:my-0 truncate'>
              <span className='truncate text-[12px] max-lg:text-[9px] leading-5 max-lg:leading-3.5 overflow-hidden text-(--text-muted)'>
                {user.bio}
              </span>
            </div>
          ) : null}
        </div>
        <div className='flex shrink-0 items-center justify-center max-lg:gap-1'>
          {!followState.isOwner ? (
            <button
              type="button"
              onClick={() => void followState.toggleFollow()}
              disabled={followState.following}
              className={`h-9 max-lg:h-6 cursor-pointer transition min-w-22 max-lg:min-w-13 outline-none text-sm max-lg:text-[10px] leading-5.5 max-lg:leading-none mx-2 max-lg:mx-0 px-3 max-lg:px-2 whitespace-nowrap opacity-100 rounded-[10px] max-lg:rounded-md disabled:cursor-wait disabled:opacity-60 ${followState.isFollowed
                ? 'bg-(--btn-bg) text-(--text-muted) hover:bg-(--btn-bg-hover)'
                : 'bg-[#fe2c55] text-white hover:bg-[#e4264e]'}`}
            >
              {followLabel}
            </button>
          ) : null}
          {variant === 'follower' && canRemoveFollower ? (
            <button
              type="button"
              onClick={() => void removeThisFollower()}
              disabled={removing}
              className='h-9 max-lg:h-6 cursor-pointer transition hover:bg-(--btn-bg-hover) bg-(--btn-bg) text-(--text-muted) min-w-22 max-lg:min-w-13 outline-none text-sm max-lg:text-[10px] leading-5.5 max-lg:leading-none mx-2 max-lg:mx-0 px-3 max-lg:px-2 whitespace-nowrap opacity-100 rounded-[10px] max-lg:rounded-md disabled:cursor-wait disabled:opacity-60'
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      <div className='w-full h-px min-h-px block relative bg-(--border-faint)' />
    </div>
  );
}

interface FollowListPanelProps {
  userId?: string;
  type: FollowListTabKey;
  open: boolean;
  keyword: string;
  sort: FollowListSort;
  canRemoveFollower: boolean;
  onTotalChange: (type: FollowListTabKey, total: number) => void;
  onViewerFollowingDelta: (delta: number) => void;
  onFollowerRemoved: () => void;
  onClose: () => void;
}

function FollowListPanel({
  userId,
  type,
  open,
  keyword,
  sort,
  canRemoveFollower,
  onTotalChange,
  onViewerFollowingDelta,
  onFollowerRemoved,
  onClose
}: FollowListPanelProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const {
    users,
    total,
    hasMore,
    loading,
    error,
    loadMore,
    setUserFollowState
  } = useFollowList({
    userId,
    type,
    enabled: open,
    keyword,
    // The follower list has no meaningful "earliest" toggle in the UI, so it always uses the default.
    sort: type === 'following' ? sort : 'recent'
  });
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  useEffect(() => {
    setRemovedIds([]);
  }, [userId, type, keyword, sort]);

  useEffect(() => {
    if (typeof total === 'number') onTotalChange(type, total);
  }, [onTotalChange, total, type]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: '160px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const visibleUsers = users.filter(user => !removedIds.includes(user._id));
  const isEmpty = !loading && !error && visibleUsers.length === 0;

  // Following or unfollowing from either list changes the *viewer's* own following total.
  const handleRowFollowChange = (targetId: string, isFollowed: boolean) => {
    setUserFollowState(targetId, isFollowed);
    onViewerFollowingDelta(isFollowed ? 1 : -1);
  };

  return (
    <div className='mt-0 -mx-8.5 max-lg:-mx-3.5 -mb-5 max-lg:-mb-3.5 py-0 pr-7 pl-10 max-lg:px-3.5 overflow-x-hidden overflow-y-auto'>
      {visibleUsers.map(user => (
        <FollowListRow
          key={user._id}
          user={user}
          variant={type}
          canRemoveFollower={canRemoveFollower}
          onFollowChange={handleRowFollowChange}
          onRemoved={(id) => {
            setRemovedIds(current => [...current, id]);
            onFollowerRemoved();
          }}
          onNavigate={onClose}
        />
      ))}

      {loading ? (
        <div className='flex min-h-25 max-lg:min-h-14 items-center justify-center'>
          <div className='h-6 w-6 max-lg:h-4 max-lg:w-4 animate-spin rounded-full border-2 border-(--border-faint) border-t-(--text-strong)' />
        </div>
      ) : null}

      {error ? (
        <div className='min-h-25 max-lg:min-h-14 justify-center items-center flex text-xs max-lg:text-[10px] leading-5 text-[#ff5c5c]'>
          {error}
        </div>
      ) : null}

      {isEmpty ? (
        <div className='min-h-25 max-lg:min-h-14 justify-center items-center flex text-xs max-lg:text-[10px] leading-5 text-(--text-faint)'>
          {keyword
            ? 'No users match your search'
            : type === 'following' ? 'Not following anyone yet' : 'No followers yet'}
        </div>
      ) : null}

      <div ref={sentinelRef} className='h-1' aria-hidden />

      {!hasMore && !loading && visibleUsers.length > 0 ? (
        <div className='min-h-25 max-lg:min-h-8 justify-center items-center flex text-xs max-lg:text-[9px] leading-5 text-(--text-faint)'>
          No more for now
        </div>
      ) : null}
    </div>
  );
}

interface IProps {
  /** Whether the modal is open */
  open: boolean;
  /** Function to close the modal */
  onClose: () => void;
  activeTab: FollowListTabKey;
  onActiveTabChange: (tab: FollowListTabKey) => void;
  userId?: string;
  isOwnProfile?: boolean;
  followingTotal?: number;
  followerTotal?: number;
  /** Fired with +1/-1 when the viewer follows or unfollows someone from either list. */
  onViewerFollowingDelta?: (delta: number) => void;
  /** Fired when the owner drops one of their own followers. */
  onFollowerRemoved?: () => void;
  /** Reports an authoritative total loaded from the server (never a filtered search count). */
  onTotalsResolved?: (type: FollowListTabKey, total: number) => void;
}

export default function CreatorProfileFollowerFollowing({
  open,
  onClose,
  activeTab,
  onActiveTabChange,
  userId,
  isOwnProfile = false,
  followingTotal = 0,
  followerTotal = 0,
  onViewerFollowingDelta,
  onFollowerRemoved,
  onTotalsResolved
}: IProps) {
  const { current: currentUser } = useProfile();
  const [sort, setSort] = useState<FollowListSort>('recent');
  const [searchTerm, setSearchTerm] = useState('');
  const [keyword, setKeyword] = useState('');
  const [totals, setTotals] = useState<Record<FollowListTabKey, number | null>>({
    following: null,
    follower: null
  });

  const selectedSortLabel = SORT_OPTIONS.find(option => option.value === sort)?.label || SORT_OPTIONS[0].label;

  // Reset transient controls whenever the modal is reopened so it never shows a previous session's
  // search term or results.
  useEffect(() => {
    if (open) return;
    setSearchTerm('');
    setKeyword('');
    setSort('recent');
    setTotals({ following: null, follower: null });
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setKeyword(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const tabs: Tab[] = [
    { key: 'following', text: 'Following', total: totals.following ?? followingTotal },
    { key: 'follower', text: 'Follower', total: totals.follower ?? followerTotal }
  ];

  const handleTotalChange = useCallback((type: FollowListTabKey, total: number) => {
    // While searching, the server total counts only the matches, so it must not be mistaken for the
    // real relationship count.
    if (keyword) return;
    setTotals(current => current[type] === total ? current : { ...current, [type]: total });
    // These come straight from the follow records, so they also correct a drifted cached counter on
    // the profile header.
    onTotalsResolved?.(type, total);
  }, [keyword, onTotalsResolved]);

  const handleFollowerRemoved = useCallback(() => {
    onFollowerRemoved?.();
    setTotals(current => current.follower === null
      ? current
      : { ...current, follower: Math.max(0, current.follower - 1) });
  }, [onFollowerRemoved]);

  const handleViewerFollowingDelta = useCallback((delta: number) => {
    onViewerFollowingDelta?.(delta);
    // The "Following" tab counts the *profile owner's* followings, so it only shifts when the viewer
    // is looking at their own profile.
    if (!isOwnProfile) return;
    setTotals(current => current.following === null
      ? current
      : { ...current, following: Math.max(0, current.following + delta) });
  }, [isOwnProfile, onViewerFollowingDelta]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={false}
      noPadding
      width={560}
      /*
        Compact: a 300px dialog that grows with its list, centred on the content
        column rather than the whole viewport — the left margin of one rail
        width moves the centre right by half a rail, so the rail does not skew
        it. The width and height caps read the shell tokens, so it can never run
        under the rail or the header.
      */
      className='bg-(--bg-modal) shadow-[0_0_24px_rgba(0,0,0,.1)] rounded-2xl max-lg:rounded-xl max-lg:!w-[min(18.75rem,calc(100vw-var(--app-shell-nav-width)-1.5rem))] max-lg:ml-(--app-shell-nav-width)'
      closeButtonClassName='max-lg:top-1.5 max-lg:right-1.5 max-lg:h-6 max-lg:w-6 max-lg:[&_svg]:h-3.5 max-lg:[&_svg]:w-3.5'
    >
      <div className='h-168 max-h-[calc(100vh-144px)] max-lg:h-auto max-lg:max-h-[min(28rem,calc(var(--app-viewport-height)-var(--app-header-height)-2rem))] flex flex-col overflow-hidden'>
        <div className='flex-1 min-h-0 flex-col flex relative overflow-hidden px-10 py-9 max-lg:px-3.5 max-lg:py-3'>
          <Tabs tabs={tabs} value={activeTab} onChange={(key) => onActiveTabChange(key)}>
            {({ activeKey, getTabProps, isActive }) => (
              <>
                <Navigation
                  tabs={tabs}
                  getTabProps={getTabProps}
                  isActive={isActive}
                />

                <div className='flex my-3 max-lg:my-2 items-center'>
                  <SearchInput
                    variant='share-popover'
                    placeholder="Search for the user's name or Douyin ID"
                    value={searchTerm}
                    onChange={setSearchTerm}
                    className={`max-lg:h-7 max-lg:px-2 max-lg:rounded-md max-lg:[&_svg]:text-sm max-lg:[&_input]:text-[10px] max-lg:[&_input]:ml-1 ${activeKey === 'following' ? 'mr-6 max-lg:mr-2' : ''}`}
                  />
                  {activeKey === 'following' && (
                    <div className="shrink-0">
                      <Dropdown
                        triggerMode="hover"
                        position="right"
                        width={132}
                        className="shrink-0"
                        menuClassName="!mt-1 !rounded-xl !border-none !bg-(--surface-raised) !p-1.5 !text-(--text-strong) !shadow-[var(--shadow-popover)] max-lg:!w-24 max-lg:!p-1"
                        trigger={(
                          <button
                            type="button"
                            className="flex h-8 max-lg:h-7 cursor-pointer items-center gap-1 max-lg:gap-0.5 rounded-lg px-1.5 max-lg:px-1 text-[13px] max-lg:text-[10px] text-(--text-strong) whitespace-nowrap transition hover:bg-(--hover-bg) hover:text-(--text-strong) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#fe2c55]"
                          >
                            <SortIcon className="shrink-0 text-lg max-lg:text-sm" />
                            <span className="max-w-25 truncate">{selectedSortLabel}</span>
                          </button>
                        )}
                      >
                        <div className="flex flex-col py-0.5">
                          {SORT_OPTIONS.map(option => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setSort(option.value)}
                              className={`h-10 max-lg:h-7 cursor-pointer rounded-lg max-lg:rounded-md px-3 max-lg:px-2 text-left text-[13px] max-lg:text-[10px] transition hover:bg-(--hover-bg) ${sort === option.value ? 'text-[#fe2c55]' : ''}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </Dropdown>
                    </div>
                  )}
                </div>

                <FollowListPanel
                  key={activeKey}
                  userId={userId}
                  type={activeKey}
                  open={open}
                  keyword={keyword}
                  sort={sort}
                  canRemoveFollower={Boolean(isOwnProfile && currentUser?._id)}
                  onTotalChange={handleTotalChange}
                  onViewerFollowingDelta={handleViewerFollowingDelta}
                  onFollowerRemoved={handleFollowerRemoved}
                  onClose={onClose}
                />
              </>
            )}
          </Tabs>
        </div>
      </div>
    </Modal>
  );
}
