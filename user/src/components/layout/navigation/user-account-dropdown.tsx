'use client';

import {
  CREATOR_PROFILE_TAB_PARAM,
  type CreatorProfileUrlTab
} from '@components/creator/creator-profile-types';
import Dropdown from '@components/ui/dropdown-menu';
import ToggleSwitch from '@components/ui/toggle-switch';
import { useLikedPostCount } from '@hooks/use-liked-post-count';
import { IUser } from '@interfaces/user';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import {
  AppointmentIcon,
  ArrowRightIcon,
  AvatarIcon,
  CollectIcon,
  HistoryIcon,
  LikeIcon,
  LogoutIcon,
  OrderIcon,
  PostIcon,
  WatchLaterIcon
} from 'src/icons';

interface UserAccountDropdownProps {
  loggedIn: boolean;
  user?: IUser | null;
}

/**
 * Rendered inside the dropdown panel, which Dropdown only mounts while open — so the count is
 * fetched when the menu is opened rather than on every page load.
 */
function LikedPostCount({ enabled }: { enabled: boolean }) {
  const count = useLikedPostCount(enabled);
  return <span>{count ?? ''}</span>;
}

export default function UserAccountDropdown({ loggedIn, user }: UserAccountDropdownProps) {
  const router = useRouter();
  const displayName = loggedIn ? (user?.name || user?.username || 'Guest') : 'Not logged in';
  const followingCount = user?.stats?.followings || 0;
  const followerCount = user?.stats?.followers || 0;
  const postCount = user?.stats?.totalPosts || 0;
  const profileHref = user?.username ? `/${user.username}` : '';

  const requireLogin = () => {
    if (!loggedIn) {
      toast.error('Please login to use this menu');
      return false;
    }
    return true;
  };

  const goToProfileTab = (tab: CreatorProfileUrlTab) => {
    if (!requireLogin()) return;
    if (!profileHref) {
      toast.error('Your profile is not available yet');
      return;
    }
    router.push(`${profileHref}?${CREATOR_PROFILE_TAB_PARAM}=${tab}`);
  };

  const trigger = (
    loggedIn && user?.avatar ? (
      <button
        type="button"
        className="ml-4 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-(--hover-bg) text-(--text-strong) transition hover:opacity-85"
        aria-label={displayName}
      >
        <img src={user.avatar} alt={displayName} className="h-full w-full object-cover" />
      </button>
    ) : loggedIn ? (
      <button
        type="button"
        className="ml-4 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-(--hover-bg) text-(--text-strong) transition hover:opacity-85"
        aria-label={displayName}
      >
        <AvatarIcon className='text-xl' />
      </button>
    ) : (
      <button
        type="button"
        className="ml-4 inline-flex h-10 w-23 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#ff2f5f] px-4 text-sm font-semibold text-white transition hover:bg-[#ff4772]"
        onClick={() => {
          window.location.href = '/auth/login';
        }}
      >
        <AvatarIcon className='text-xl' />
        Login
      </button>
    )
  );

  return (
    <Dropdown
      trigger={trigger}
      triggerMode="hover"
      width={334}
      menuClassName="!rounded-xl !border-none !bg-(--surface-raised) !p-0 !text-(--text-strong) !shadow-none"
    >
      <div className="max-h-[calc(100vh-72px)] overflow-y-auto p-3 scrollbar-custom">
        <div className="flex items-center gap-3 px-1 pb-3">
          <span className="flex h-13 w-13 overflow-hidden rounded-full bg-(--surface-soft)">
            {user?.avatar ? (
              <img src={user.avatar} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-[rgba(127,127,127,.32)] opacity-80">
                <AvatarIcon className='text-[52px] text-(--text-soft)' />
              </span>
            )}
          </span>
          <div className="min-w-0">
            <div className="mb-2 truncate text-sm font-semibold text-(--text-strong)">{displayName}</div>
            {loggedIn ? (
              <div className="flex items-center gap-3 text-sm text-(--text-soft)">
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1 whitespace-nowrap transition hover:text-(--text-strong)"
                  onClick={() => requireLogin() && toast.info('Attention is coming soon')}
                >
                  <span>Attention</span>
                  <span className="text-(--text-strong)">{followingCount}</span>
                </button>
                <span className="h-3 w-px bg-(--divider)" />
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1 whitespace-nowrap transition hover:text-(--text-strong)"
                  onClick={() => requireLogin() && toast.info('Fans is coming soon')}
                >
                  <span>Fans</span>
                  <span className="text-(--text-strong)">{followerCount}</span>
                </button>
              </div>
            ) : (
              <p className="max-w-52.5 text-sm leading-5 text-(--text-soft)">
                After logging in, you can watch your favorite and collect works.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            className="flex h-10 w-full cursor-pointer items-center justify-between rounded-lg bg-(--surface-soft) px-3 text-sm font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => goToProfileTab('liked')}
          >
            <span className="flex items-center gap-2"><LikeIcon className="text-2xl" /> {loggedIn ? 'I like it' : 'My liking'}</span>
            <span className="flex items-center text-sm font-semibold text-(--text-strong)">
              {loggedIn ? <LikedPostCount enabled={loggedIn} /> : ''} <ArrowRightIcon className='text-xl opacity-45' />
            </span>
          </button>
          <button
            type="button"
            className="flex h-10 w-full cursor-pointer items-center justify-between rounded-lg bg-(--surface-soft) px-3 text-sm font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => requireLogin() && toast.info('My collection is coming soon')}
          >
            <span className="flex items-center gap-2"><CollectIcon className="text-2xl" /> {loggedIn ? 'My collection' : 'My collection.'}</span>
            <span className="flex items-center text-sm font-semibold text-(--text-strong)">{loggedIn ? '0' : ''} <ArrowRightIcon className='text-xl opacity-45' /></span>
          </button>
          <button
            type="button"
            className="flex h-10 w-full cursor-pointer items-center justify-between rounded-lg bg-(--surface-soft) px-3 text-sm font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => requireLogin() && toast.info('Watch history is coming soon')}
          >
            <span className="flex items-center gap-2"><HistoryIcon className="text-2xl" /> {loggedIn ? 'Watch history' : 'Look at history.'}</span>
            <span className="flex items-center text-xs font-semibold text-(--text-strong)">{loggedIn ? 'Within 30 days' : ''} <ArrowRightIcon className='text-xl opacity-45' /></span>
          </button>
          <button
            type="button"
            className="flex h-10 w-full cursor-pointer items-center justify-between rounded-lg bg-(--surface-soft) px-3 text-sm font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => requireLogin() && toast.info('Watch later is coming soon')}
          >
            <span className="flex items-center gap-2"><WatchLaterIcon className="text-2xl" /> {loggedIn ? 'We&apos;ll look at it later' : 'See again later.'}</span>
            <span className="flex items-center text-sm font-semibold text-(--text-strong)">{loggedIn ? '0' : ''} <ArrowRightIcon className='text-xl opacity-45' /></span>
          </button>
          <button
            type="button"
            className="flex h-10 w-full cursor-pointer items-center justify-between rounded-lg bg-(--surface-soft) px-3 text-sm font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => goToProfileTab('works')}
          >
            <span className="flex items-center gap-2"><PostIcon className="text-2xl" /> {loggedIn ? 'My work' : 'My work.'}</span>
            <span className="flex items-center text-sm font-semibold text-(--text-strong)">{loggedIn ? postCount : ''} <ArrowRightIcon className='text-xl opacity-45' /></span>
          </button>
        </div>

        <div className="mt-3 space-y-1 border-t border-(--divider) pt-3">
          <button type="button" className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-(--text-soft) transition hover:bg-(--surface-soft) hover:text-(--text-strong)">
            <AppointmentIcon className="text-[26px]" />
            {loggedIn ? 'My appointment' : 'My appointment.'}
          </button>
          <button type="button" className="flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-(--text-soft) transition hover:bg-(--surface-soft) hover:text-(--text-strong)">
            <OrderIcon className="text-[26px]" />
            {loggedIn ? 'My order' : 'My orders.'}
          </button>
        </div>

        {loggedIn ? (
          <div className="mt-3 flex items-center justify-between border-t border-(--divider) px-3 pt-3">
            <button
              type="button"
              className="flex h-9 cursor-pointer items-center gap-2 text-left text-sm font-medium text-(--text-soft) transition hover:text-(--text-strong)"
              onClick={() => {
                window.location.href = loggedIn ? '/auth/logout' : '/auth/login';
              }}
            >
              <LogoutIcon className="text-[26px]" />
              Logged out
            </button>
            <div className="flex items-center gap-2 text-xs font-semibold text-(--text-soft)">
              <span>Save login</span>
              <ToggleSwitch aria-label="Save login" />
            </div>
          </div>
        ) : null}
      </div>
    </Dropdown>
  );
}
