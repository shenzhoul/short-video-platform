'use client';

import CreatorProfileFollowerFollowing, {
  type FollowListTabKey
} from '@components/creator/creator-profile-follower-following';
import { useProfile } from '@providers/profile.provider';
import { getFollowStats } from '@services/user.service';
import {
  createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState
} from 'react';

export interface OpenFollowListOptions {
  /**
   * Whose followers and following to show.
   *
   * Always supplied by whoever opens the modal, and never inferred from the
   * signed-in account: opening it from a creator's profile must show *that*
   * creator's lists, not the viewer's.
   */
  subjectUserId: string;
  /** Which tab opens first. */
  initialTab: FollowListTabKey;
}

interface FollowListContextValue {
  openFollowList: (options: OpenFollowListOptions) => void;
  closeFollowList: () => void;
  /** The subject whose lists are open, or null when the modal is closed. */
  openForUserId: string | null;
}

const FollowListContext = createContext<FollowListContextValue>({
  openFollowList: () => { },
  closeFollowList: () => { },
  openForUserId: null
});

interface FollowListState {
  subjectUserId: string;
  tab: FollowListTabKey;
}

/**
 * One follower/following modal for the whole application.
 *
 * Mounted once beside the page rather than inside whichever component happens to
 * need it, exactly as the message workspace is. That is what lets the profile
 * header and the account dropdown open the *same* modal — with the same search,
 * pagination, follow/unfollow, remove-follower and mutual-follow behaviour —
 * instead of each rendering a copy that would then have to be kept in step.
 *
 * Living outside the dropdown also settles the interaction the two would
 * otherwise fight over: closing the dropdown unmounts the dropdown, and the
 * modal is not inside it, so it stays open.
 */
export function FollowListProvider({ children }: { children: ReactNode }) {
  const { current: currentUser } = useProfile();
  const [state, setState] = useState<FollowListState | null>(null);

  const openFollowList = useCallback(({ subjectUserId, initialTab }: OpenFollowListOptions) => {
    if (!subjectUserId) return;
    setState({ subjectUserId, tab: initialTab });
  }, []);

  const closeFollowList = useCallback(() => setState(null), []);

  /**
   * The subject's canonical totals, for the tab that has not been opened yet.
   *
   * The modal only loads the list for the *active* tab, so without a seed the
   * other tab reads zero until somebody clicks it — which looks like a
   * disagreement with the profile header sitting right behind it.
   *
   * Fetched for the subject rather than taken from the viewer's own profile:
   * these are whose lists are being shown, not who is looking.
   */
  const [totals, setTotals] = useState<{ followers: number; following: number } | null>(null);
  const subjectUserId = state?.subjectUserId;

  useEffect(() => {
    if (!subjectUserId) {
      setTotals(null);
      return;
    }

    let cancelled = false;
    setTotals(null);
    void getFollowStats(subjectUserId)
      .then((response: any) => {
        if (cancelled || !response?.data) return;
        setTotals({
          followers: response.data.followersCount || 0,
          following: response.data.followingCount || 0
        });
      })
      .catch(() => {
        // The modal still loads the active tab's own total; only the seed for
        // the unopened tab is lost, which is not worth an error.
      });

    return () => {
      cancelled = true;
    };
  }, [subjectUserId]);

  const setTab = useCallback((tab: FollowListTabKey) => {
    setState((current) => (current ? { ...current, tab } : current));
  }, []);

  const value = useMemo(() => ({
    openFollowList,
    closeFollowList,
    openForUserId: state?.subjectUserId ?? null
  }), [openFollowList, closeFollowList, state?.subjectUserId]);

  return (
    <FollowListContext.Provider value={value}>
      {children}
      {state ? (
        <CreatorProfileFollowerFollowing
          open
          onClose={closeFollowList}
          activeTab={state.tab}
          onActiveTabChange={setTab}
          // The **subject**: whose lists these are. Comes from the caller, so
          // the profile page shows that creator's lists rather than the
          // viewer's.
          userId={state.subjectUserId}
          // The **viewer**, and only used to decide what they may do here.
          // Derived from the signed-in identity rather than trusted from the
          // caller, so opening the modal from a new entry point can never widen
          // the owner-only actions — removing a follower, seeing a private list.
          isOwnProfile={Boolean(currentUser?._id) && currentUser?._id === state.subjectUserId}
          // Seeds only. The modal replaces each with the authoritative total it
          // loads for that tab; these stop the unopened one reading zero.
          followingTotal={totals?.following ?? 0}
          followerTotal={totals?.followers ?? 0}
        />
      ) : null}
    </FollowListContext.Provider>
  );
}

/**
 * Open the shared follower/following modal.
 *
 * ```ts
 * openFollowList({ subjectUserId, initialTab: 'following' });
 * ```
 *
 * `subjectUserId` is whose lists to show. The viewer is the signed-in account
 * and is never used as the subject — the two are separate on purpose.
 */
export function useFollowListModal(): FollowListContextValue {
  return useContext(FollowListContext);
}
