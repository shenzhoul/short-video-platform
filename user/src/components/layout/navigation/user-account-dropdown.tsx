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
import { useCreatorPostSearch } from '@hooks/use-creator-post-search';
import { useFollowStats } from '@hooks/use-follow-stats';
import { useLikedPosts } from '@hooks/use-liked-posts';
import { useLogout } from '@hooks/use-logout';
import { IPost } from '@interfaces/post';
import { IUser } from '@interfaces/user';
import { resolveAvatarUrl } from '@lib/avatar';
import { captureTops, glideFromTops, prefersReducedMotion } from '@lib/layout-glide';
import { subscribePostInteraction } from '@lib/post-interaction-bus';
import { useAuthModal } from '@providers/auth-modal.provider';
import { useFollowListModal } from '@providers/follow-list.provider';
import { useRouter } from 'next/navigation';
import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState
} from 'react';
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

import AccountMenuPostPreview from './account-menu-post-preview';

interface UserAccountDropdownProps {
  loggedIn: boolean;
  user?: IUser | null;
}

type AccountMenuSection = 'liked' | 'works';

/** How many posts each account menu row previews. */
const ACCOUNT_MENU_PREVIEW_LIMIT = 3;

/** Shared with the strip keyframes in `globals.css`, so the rows and the strip move as one. */
const SECTION_SWITCH_MS = 260;

const COLLECTION_ROW_CLASSES = 'flex h-10 max-lg:h-6 w-full cursor-pointer items-center justify-between rounded-lg max-lg:rounded-md bg-(--surface-soft) px-3 max-lg:px-1.5 text-sm max-lg:text-[10px] font-medium text-(--text-strong) transition hover:bg-(--surface-hover)';

/** The two rows that own a preview also take keyboard focus visibly, since focus switches the preview. */
const PREVIEW_ROW_FOCUS_CLASSES = 'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--text-muted)';

/** The blocks the section-switch glide moves. */
function queryMenuBlocks(menuBody: HTMLElement | null): HTMLElement[] {
  return Array.from(menuBody?.querySelectorAll<HTMLElement>('[data-account-menu-block]') ?? []);
}

function AccountMenu({ loggedIn, user }: UserAccountDropdownProps) {
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

  /*
    Open state is lifted here so a preview tile can close the menu before it
    navigates, and so each opening can reset the section and re-read the lists.
  */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const [activeSection, setActiveSection] = useState<AccountMenuSection>('liked');
  const activeSectionRef = useRef<AccountMenuSection>('liked');
  activeSectionRef.current = activeSection;
  const previewIdBase = useId();
  const likedPreviewId = `${previewIdBase}-liked`;
  const worksPreviewId = `${previewIdBase}-works`;
  const menuBodyRef = useRef<HTMLDivElement>(null);
  /** Block positions captured just before a section switch; consumed by the glide. */
  const glideFromRef = useRef<Map<HTMLElement, number> | null>(null);

  /*
    The same hooks the profile page uses for its "I like it" and Works tabs,
    with menu-sized options: one page of three, newest-first works, and inline
    errors instead of toasts. No cache of the menu's own.
  */
  const liked = useLikedPosts({
    enabled: loggedIn && menuOpen,
    limit: ACCOUNT_MENU_PREVIEW_LIMIT,
    notifyOnError: false
  });
  const works = useCreatorPostSearch({
    creatorId: loggedIn ? user?._id : undefined,
    limit: ACCOUNT_MENU_PREVIEW_LIMIT,
    creatorOrder: 'latest',
    notifyOnError: false
  });

  /*
    Re-read both lists each time the menu opens, so a like, an unlike, a new post
    or a deleted one made anywhere since is what the menu shows. Moving between
    the two sections never requests anything. Held in a ref because the works
    hook's `handleFilter` is a new function on every render.
  */
  const reloadWorksRef = useRef<() => void>(() => undefined);
  reloadWorksRef.current = () => works.handleFilter({});
  const refreshLiked = liked.refresh;
  const reloadPreviews = useCallback(() => {
    refreshLiked();
    reloadWorksRef.current();
  }, [refreshLiked]);
  const retryWorks = useCallback(() => reloadWorksRef.current(), []);

  /**
   * Every opening starts on "I like it" and re-reads the previews.
   *
   * Only a genuine closed-to-open transition counts. The hover dropdown reports
   * "open" again whenever the pointer re-enters during its short close grace
   * period, and treating that as a new opening would snap "My work" back to
   * "I like it" under a pointer that merely grazed the panel's edge.
   */
  const handleMenuOpenChange = useCallback((next: boolean) => {
    const opening = next && !menuOpenRef.current;
    menuOpenRef.current = next;
    if (opening) {
      glideFromRef.current = null;
      setActiveSection('liked');
      if (loggedIn) reloadPreviews();
    }
    setMenuOpen(next);
  }, [loggedIn, reloadPreviews]);

  /*
    An unlike made anywhere while the menu is open removes that post from the
    preview through the same updater the profile tab uses. Only for a post the
    preview holds: the detail modal also publishes `isLiked: false` for posts that
    were never liked, and those must not touch the count.
  */
  const likedIdsRef = useRef<Set<string>>(new Set());
  likedIdsRef.current = new Set(liked.posts.map((post) => post._id));
  const updateLikedPost = liked.updatePostInteraction;
  useEffect(() => subscribePostInteraction((postId, patch) => {
    if (patch.isLiked === false && likedIdsRef.current.has(postId)) updateLikedPost(postId, patch);
  }), [updateLikedPost]);

  /*
    Section switches glide.

    Mounting one preview and removing the other reflows everything between the
    two rows by the height of a preview (152px at 1440px wide). Done in one
    frame, that jump is all anyone sees. So the positions of the menu's blocks
    are captured just before the switch and each block is played from where it
    was to where it lands, at the strip's own duration and easing.
  */
  const showSection = useCallback((section: AccountMenuSection) => {
    if (!loggedIn || section === activeSectionRef.current) return;
    glideFromRef.current = prefersReducedMotion() ? null : captureTops(queryMenuBlocks(menuBodyRef.current));
    setActiveSection(section);
  }, [loggedIn]);

  useLayoutEffect(() => {
    const previousTops = glideFromRef.current;
    glideFromRef.current = null;
    if (!previousTops) return;
    glideFromTops(previousTops, queryMenuBlocks(menuBodyRef.current), {
      duration: SECTION_SWITCH_MS,
      easing: 'ease-out'
    });
  }, [activeSection]);

  /*
    A tap must never switch sections.

    A touch fires compatibility hover and focus events *before* its click. If
    either opened "My work", the liked preview above it would collapse in
    between, the row would move out from under the finger, and the click would
    land on whatever moved into its place — measured at 390x844: tapping
    "My work" stayed on the page instead of opening the Works tab. So hover only
    counts for a real pointer, and focus only counts when no pointer caused it.

    Focus is told apart with a flag set on `pointerdown` rather than
    `:focus-visible`: engines disagree about when that matches (and some do not
    support it), while a keyboard Tab never produces a pointerdown anywhere.
  */
  const pointerPressedRef = useRef(false);

  const handleRowPointerEnter = useCallback((section: AccountMenuSection, pointerType: string) => {
    if (pointerType === 'touch') return;
    showSection(section);
  }, [showSection]);

  const handleRowPointerDown = useCallback(() => {
    pointerPressedRef.current = true;
  }, []);

  const handleRowFocus = useCallback((section: AccountMenuSection) => {
    if (pointerPressedRef.current) {
      pointerPressedRef.current = false;
      return;
    }
    showSection(section);
  }, [showSection]);

  const handleRowBlur = useCallback(() => {
    pointerPressedRef.current = false;
  }, []);

  /**
   * Open a previewed post in the application's own post detail.
   *
   * The same address a notification row uses (`/?modal_id=<id>`): Home hosts the
   * detail modal for any `modal_id` and gives it the direct-link recommendation
   * session, which is the right next/previous for a post picked from a menu with
   * no feed of its own. The menu closes first so it is not left open behind the
   * modal.
   */
  const openPreviewPost = useCallback((post: IPost) => {
    if (!post?._id) return;
    handleMenuOpenChange(false);
    router.push(`/?modal_id=${encodeURIComponent(post._id)}`);
  }, [handleMenuOpenChange, router]);

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

  const likedPreviewOpen = loggedIn && activeSection === 'liked';
  const worksPreviewOpen = loggedIn && activeSection === 'works';
  // The collections' real sizes, never the three posts previewed.
  const likedCount = liked.hasLoaded ? liked.total : '';
  const worksCount = works.hasLoaded ? works.total : postCount;

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
      open={menuOpen}
      onOpenChange={handleMenuOpenChange}
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
        ref={menuBodyRef}
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

        {/*
          Every block below carries `data-account-menu-block`, which is what the
          section-switch glide moves. The two collection cards are opaque, so a
          card gliding past the rows under it covers them rather than showing
          through.
        */}
        <div className="space-y-2 max-lg:space-y-1">
          <div data-account-menu-block className="rounded-lg max-lg:rounded-md bg-(--surface-soft)">
            <button
              type="button"
              className={`${COLLECTION_ROW_CLASSES} ${PREVIEW_ROW_FOCUS_CLASSES}`}
              aria-expanded={loggedIn ? likedPreviewOpen : undefined}
              aria-controls={likedPreviewOpen ? likedPreviewId : undefined}
              onPointerEnter={(event) => handleRowPointerEnter('liked', event.pointerType)}
              onPointerDown={handleRowPointerDown}
              onFocus={() => handleRowFocus('liked')}
              onBlur={handleRowBlur}
              onClick={() => goToProfileTab('liked')}
            >
              <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><LikeIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.liked : 'My liking'}</span>
              <span className="flex shrink-0 items-center text-sm max-lg:text-[10px] font-semibold text-(--text-strong) tabular-nums">
                {loggedIn ? likedCount : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' />
              </span>
            </button>
            {likedPreviewOpen ? (
              <AccountMenuPostPreview
                key="liked"
                id={likedPreviewId}
                label={PROFILE_COLLECTION_LABELS.liked}
                section="liked"
                enterFrom="above"
                posts={liked.posts}
                loading={!liked.hasLoaded}
                error={liked.error}
                emptyMessage="No liked posts yet"
                onRetry={refreshLiked}
                onOpenPost={openPreviewPost}
              />
            ) : null}
          </div>
          <button
            type="button"
            data-account-menu-block
            className={COLLECTION_ROW_CLASSES}
            onClick={() => requireLogin() && toast.info('My collection is coming soon')}
          >
            <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><CollectIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.collection : 'My collection.'}</span>
            <span className="flex shrink-0 items-center text-sm max-lg:text-[10px] font-semibold text-(--text-strong)">{loggedIn ? '0' : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' /></span>
          </button>
          <button
            type="button"
            data-account-menu-block
            className={COLLECTION_ROW_CLASSES}
            onClick={() => requireLogin() && toast.info('Watch history is coming soon')}
          >
            <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><HistoryIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.watchHistory : 'Look at history.'}</span>
            <span className="flex shrink-0 items-center text-xs max-lg:text-[9px] font-semibold text-(--text-strong)">{loggedIn ? 'Within 30 days' : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' /></span>
          </button>
          <button
            type="button"
            data-account-menu-block
            className={COLLECTION_ROW_CLASSES}
            onClick={() => requireLogin() && toast.info('Watch later is coming soon')}
          >
            <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><WatchLaterIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.watchLater : 'See again later.'}</span>
            <span className="flex shrink-0 items-center text-sm max-lg:text-[10px] font-semibold text-(--text-strong)">{loggedIn ? '0' : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' /></span>
          </button>
          <div data-account-menu-block className="rounded-lg max-lg:rounded-md bg-(--surface-soft)">
            <button
              type="button"
              className={`${COLLECTION_ROW_CLASSES} ${PREVIEW_ROW_FOCUS_CLASSES}`}
              aria-expanded={loggedIn ? worksPreviewOpen : undefined}
              aria-controls={worksPreviewOpen ? worksPreviewId : undefined}
              onPointerEnter={(event) => handleRowPointerEnter('works', event.pointerType)}
              onPointerDown={handleRowPointerDown}
              onFocus={() => handleRowFocus('works')}
              onBlur={handleRowBlur}
              onClick={() => goToProfileTab('works')}
            >
              <span className="flex min-w-0 items-center gap-2 max-lg:gap-1 truncate"><PostIcon className="text-2xl max-lg:text-[13px] shrink-0" /> {loggedIn ? PROFILE_COLLECTION_LABELS.work : 'My work.'}</span>
              <span className="flex shrink-0 items-center text-sm max-lg:text-[10px] font-semibold text-(--text-strong) tabular-nums">{loggedIn ? worksCount : ''} <ArrowRightIcon className='text-xl max-lg:text-[12px] shrink-0 opacity-45' /></span>
            </button>
            {worksPreviewOpen ? (
              <AccountMenuPostPreview
                key="works"
                id={worksPreviewId}
                label={PROFILE_COLLECTION_LABELS.work}
                section="works"
                enterFrom="below"
                posts={works.posts}
                loading={!works.hasLoaded}
                error={works.error}
                emptyMessage="No works yet"
                onRetry={retryWorks}
                onOpenPost={openPreviewPost}
              />
            ) : null}
          </div>
        </div>

        {/*
          The footer sits above the collection cards and paints the panel's own
          background. When "My work" opens, its card glides up from where it
          was; for the first frames it overlaps this area, and without this it
          was drawn on top of "Logged out" with its captions running through the
          text. It now rises out from under the footer instead. `flow-root`
          keeps the first child's top margin inside the painted box.
        */}
        <div data-account-menu-block className="relative z-1 flow-root bg-(--surface-raised)">
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
      </div>
    </Dropdown>
  );
}

/**
 * The header account menu.
 *
 * Everything it holds — the open section and the previewed posts — belongs to one
 * account, so the menu is keyed by the account: signing out or into another
 * account mounts a fresh menu instead of showing the previous account's posts
 * until a request replaces them.
 */
export default function UserAccountDropdown(props: UserAccountDropdownProps) {
  const accountKey = props.loggedIn && props.user?._id ? props.user._id : 'guest';
  return <AccountMenu key={accountKey} {...props} />;
}
