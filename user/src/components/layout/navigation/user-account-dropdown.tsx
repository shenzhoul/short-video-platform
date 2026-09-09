'use client';

import type { FollowListTabKey } from '@components/creator/creator-profile-follower-following';
import {
  CREATOR_PROFILE_TAB_PARAM,
  type CreatorProfileUrlTab
} from '@components/creator/creator-profile-types';
import Dropdown from '@components/ui/dropdown-menu';
import ToggleSwitch from '@components/ui/toggle-switch';
import { PROFILE_COLLECTION_LABELS } from '@constants/profile-labels';
import { toast } from '@douyin-clone/shared-toast';
import { useFollowStats } from '@hooks/use-follow-stats';
import { useLikedPostCount } from '@hooks/use-liked-post-count';
import { useLogout } from '@hooks/use-logout';
import { IUser } from '@interfaces/user';
import { resolveAvatarUrl } from '@lib/avatar';
import { useAuthModal } from '@providers/auth-modal.provider';
import { useFollowListModal } from '@providers/follow-list.provider';
import { useRouter } from 'next/navigation';
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
  const { openAuthModal } = useAuthModal();
  const { logout, loggingOut } = useLogout();
  const displayName = loggedIn ? (user?.name || user?.username || 'Guest') : 'Not logged in';
  const { openFollowList } = useFollowListModal();
  // Seeded from the profile response — which counts the follow rows rather than
  // reading the cached counters — then kept current by live snapshots. The same
  // source the profile header and the modal tabs use, so the three cannot
  // disagree.
  const { followersCount, followingCount } = useFollowStats({
    userId: user?._id,
    initial: {
      followersCount: user?.stats?.followers || 0,
      followingCount: user?.stats?.followings || 0
    }
  });
  const postCount = user?.stats?.totalPosts || 0;
  const profileHref = user?.username ? `/${user.username}` : '';

  /**
   * Gate for the menu entries that only make sense for an account.
   *
   * Opens the shared dialog rather than telling the visitor off with a toast:
   * the answer to "you need an account" is a place to sign in, and it appears
   * over this page rather than replacing it.
   */
  const requireLogin = () => {
    if (!loggedIn) {
      openAuthModal();
      return false;
    }
    return true;
  };

  /**
   * Open the shared follower/following modal on the signed-in user's own lists.
   *
   * No navigation: the modal is mounted beside the page, so it opens over
   * whatever the reader is looking at rather than sending them to their profile
   * to see the same thing. It also lives outside this dropdown, which is why the
   * dropdown closing behind it does not take it away.
   */
  const openOwnFollowList = (initialTab: FollowListTabKey) => {
    if (!requireLogin()) return;
    if (!user?._id) {
      toast.error('Your profile is not available yet');
      return;
    }
    // The signed-in user is the subject *here* because this is their own
    // account menu — not because the modal defaults to them.
    openFollowList({ subjectUserId: user._id, initialTab });
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
    loggedIn ? (
      <button
        type="button"
        className="ml-4 max-lg:ml-0.5 flex h-8 w-8 max-lg:h-6 max-lg:w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-(--hover-bg) text-(--text-strong) transition hover:opacity-85"
        aria-label={displayName}
      >
        <img src={resolveAvatarUrl(user?.avatar)} alt={displayName} className="h-full w-full object-cover" />
      </button>
    ) : (
      <button
        type="button"
        className="ml-4 max-lg:ml-0.5 max-lg:h-6 max-lg:w-auto max-lg:px-1.5 max-lg:text-[10px] max-lg:gap-1 shrink-0 inline-flex h-10 w-23 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#ff2f5f] px-4 text-sm font-semibold text-white transition hover:bg-[#ff4772]"
        onClick={() => openAuthModal()}
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
      /*
        Two caps, and the smaller wins.

        `max-w-[19rem]` is the compact panel itself — 304px, so the menu still
        reads as a panel anchored to the avatar rather than a sheet covering the
        page. The viewport cap is written against `--app-shell-nav-width`, the
        one owner of the rail's width, so the panel can never start left of the
        rail whatever the viewport is. The old `calc(100vw-16px)` measured
        against the whole viewport and therefore allowed exactly that.
      */
      menuClassName="!rounded-xl !border-none !bg-(--surface-raised) !p-0 !text-(--text-strong) !shadow-none max-lg:max-w-[min(13.5rem,calc(100vw-var(--app-shell-nav-width)-4rem))] max-w-[calc(100vw-var(--app-shell-nav-width)-1rem)]"
    >
      <div
        data-account-menu
        className="max-h-[calc(var(--app-viewport-height)-72px)] max-lg:max-h-[calc(var(--app-viewport-height)-3rem)] overflow-y-auto p-3 max-lg:p-1.5 scrollbar-custom"
      >
        <div className="flex items-center gap-3 max-lg:gap-1.5 px-1 max-lg:px-0.5 pb-3 max-lg:pb-1.5">
          <span className="flex h-13 w-13 max-lg:h-7 max-lg:w-7 shrink-0 overflow-hidden rounded-full bg-(--surface-soft)">
            <img src={resolveAvatarUrl(user?.avatar)} alt={displayName} className="h-full w-full object-cover" />
          </span>
          <div className="min-w-0">
            <div className="mb-2 max-lg:mb-0.5 truncate text-sm max-lg:text-[10px] font-semibold text-(--text-strong)">{displayName}</div>
            {loggedIn ? (
              <div className="flex items-center gap-3 max-lg:gap-1.5 text-sm max-lg:text-[9px] text-(--text-soft)">
                <button
                  type="button"
                  aria-label={`Show the ${followingCount} accounts you follow`}
                  className="flex cursor-pointer items-center gap-1 rounded whitespace-nowrap transition hover:text-(--text-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--text-muted)"
                  onClick={() => openOwnFollowList('following')}
                >
                  <span>Attention</span>
                  {/* Tabular figures so the row keeps its width as the number
                      grows — a live count must not resize the dropdown under
                      the pointer. */}
                  <span className="text-(--text-strong) tabular-nums">{followingCount}</span>
                </button>
                <span className="h-3 w-px bg-(--divider)" />
                <button
                  type="button"
                  aria-label={`Show your ${followersCount} followers`}
                  className="flex cursor-pointer items-center gap-1 rounded whitespace-nowrap transition hover:text-(--text-strong) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--text-muted)"
                  onClick={() => openOwnFollowList('follower')}
                >
                  <span>Fans</span>
                  <span className="text-(--text-strong) tabular-nums">{followersCount}</span>
                </button>
              </div>
            ) : (
              <p className="max-w-52.5 text-sm leading-5 text-(--text-soft)">
                After logging in, you can watch your favorite and collect works.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2 max-lg:space-y-1">
          <button
            type="button"
            className="flex h-10 max-lg:h-6 w-full cursor-pointer items-center justify-between rounded-lg max-lg:rounded-md bg-(--surface-soft) px-3 max-lg:px-1.5 text-sm max-lg:text-[10px] font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => goToProfileTab('liked')}
          >
            <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><LikeIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.liked : 'My liking'}</span>
            <span className="flex shrink-0 items-center text-sm max-lg:text-[10px] font-semibold text-(--text-strong)">
              {loggedIn ? <LikedPostCount enabled={loggedIn} /> : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' />
            </span>
          </button>
          <button
            type="button"
            className="flex h-10 max-lg:h-6 w-full cursor-pointer items-center justify-between rounded-lg max-lg:rounded-md bg-(--surface-soft) px-3 max-lg:px-1.5 text-sm max-lg:text-[10px] font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => requireLogin() && toast.info('My collection is coming soon')}
          >
            <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><CollectIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.collection : 'My collection.'}</span>
            <span className="flex shrink-0 items-center text-sm max-lg:text-[10px] font-semibold text-(--text-strong)">{loggedIn ? '0' : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' /></span>
          </button>
          <button
            type="button"
            className="flex h-10 max-lg:h-6 w-full cursor-pointer items-center justify-between rounded-lg max-lg:rounded-md bg-(--surface-soft) px-3 max-lg:px-1.5 text-sm max-lg:text-[10px] font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => requireLogin() && toast.info('Watch history is coming soon')}
          >
            <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><HistoryIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.watchHistory : 'Look at history.'}</span>
            <span className="flex shrink-0 items-center text-xs max-lg:text-[9px] font-semibold text-(--text-strong)">{loggedIn ? 'Within 30 days' : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' /></span>
          </button>
          <button
            type="button"
            className="flex h-10 max-lg:h-6 w-full cursor-pointer items-center justify-between rounded-lg max-lg:rounded-md bg-(--surface-soft) px-3 max-lg:px-1.5 text-sm max-lg:text-[10px] font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => requireLogin() && toast.info('Watch later is coming soon')}
          >
            <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><WatchLaterIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.watchLater : 'See again later.'}</span>
            <span className="flex shrink-0 items-center text-sm max-lg:text-[10px] font-semibold text-(--text-strong)">{loggedIn ? '0' : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' /></span>
          </button>
          <button
            type="button"
            className="flex h-10 max-lg:h-6 w-full cursor-pointer items-center justify-between rounded-lg max-lg:rounded-md bg-(--surface-soft) px-3 max-lg:px-1.5 text-sm max-lg:text-[10px] font-medium text-(--text-strong) transition hover:bg-(--surface-hover)"
            onClick={() => goToProfileTab('works')}
          >
            <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><PostIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.work : 'My work.'}</span>
            <span className="flex shrink-0 items-center text-sm max-lg:text-[10px] font-semibold text-(--text-strong)">{loggedIn ? postCount : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' /></span>
          </button>
        </div>

        <div className="mt-3 max-lg:mt-1.5 space-y-1 max-lg:space-y-0.5 border-t border-(--divider) pt-3 max-lg:pt-1.5">
          <button type="button" className="flex h-10 max-lg:h-6 w-full cursor-pointer items-center gap-2 max-lg:gap-1 rounded-lg max-lg:rounded-md px-3 max-lg:px-1.5 text-left text-sm max-lg:text-[10px] font-medium text-(--text-soft) transition hover:bg-(--surface-soft) hover:text-(--text-strong)">
            <AppointmentIcon className="text-[26px] max-lg:text-[14px] shrink-0" />
            {loggedIn ? PROFILE_COLLECTION_LABELS.appointment : 'My appointment.'}
          </button>
          <button type="button" className="flex h-10 max-lg:h-6 w-full cursor-pointer items-center gap-2 max-lg:gap-1 rounded-lg max-lg:rounded-md px-3 max-lg:px-1.5 text-left text-sm max-lg:text-[10px] font-medium text-(--text-soft) transition hover:bg-(--surface-soft) hover:text-(--text-strong)">
            <OrderIcon className="text-[26px] max-lg:text-[14px] shrink-0" />
            {loggedIn ? 'My order' : 'My orders.'}
          </button>
        </div>

        {loggedIn ? (
          <div className="mt-3 max-lg:mt-1.5 flex items-center justify-between gap-2 max-lg:gap-1 border-t border-(--divider) px-3 max-lg:px-1.5 pt-3 max-lg:pt-1.5">
            <button
              type="button"
              // Disabled while the sign-out is in flight; `useLogout` also
              // de-duplicates, so a double click cannot revoke twice.
              disabled={loggingOut}
              className="flex h-9 max-lg:h-6 shrink-0 cursor-pointer items-center gap-2 max-lg:gap-1 text-left text-sm max-lg:text-[10px] font-medium text-(--text-soft) transition hover:text-(--text-strong) disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                if (!loggedIn) {
                  openAuthModal();
                  return;
                }
                // Signs out in place: no logout page, no full reload, and the
                // visitor lands on `/` rather than on a confirmation screen.
                void logout();
              }}
            >
              <LogoutIcon className="text-[26px] max-lg:text-[14px] shrink-0" />
              {loggingOut ? 'Logging out…' : 'Logged out'}
            </button>
            <div className="flex shrink-0 items-center gap-2 max-lg:gap-1 text-xs max-lg:text-[9px] font-semibold text-(--text-soft)">
              <span>Save login</span>
              <ToggleSwitch aria-label="Save login" />
            </div>
          </div>
        ) : null}
      </div>
    </Dropdown>
  );
}
