import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { FollowListProvider, useFollowListModal } from './follow-list.provider';

/**
 * One modal, two entry points.
 *
 * The profile header and the account dropdown must reach the *same* modal —
 * same search, pagination, follow/unfollow, remove-follower and mutual state —
 * rather than each rendering a copy that would then have to be kept in step.
 */

const mockGetFollowStats = jest.fn();
jest.mock('@services/user.service', () => ({
  getFollowStats: (...args: any[]) => mockGetFollowStats(...args)
}));

const viewer = { _id: 'me', username: 'me', name: 'Me' };
jest.mock('@providers/profile.provider', () => ({
  useProfile: () => ({ current: viewer })
}));

/**
 * Stands in for the real modal, reporting only the props that decide what it
 * shows. The component itself is covered by its own tests; what matters here is
 * that exactly one is mounted and that it is told the right thing.
 */
const modalRenders = jest.fn();
jest.mock('@components/creator/creator-profile-follower-following', () => ({
  __esModule: true,
  default: (props: any) => {
    modalRenders(props);
    return (
      <div
        data-testid="follow-modal"
        data-user={props.userId}
        data-tab={props.activeTab}
        data-own={String(props.isOwnProfile)}
        data-following-total={String(props.followingTotal)}
        data-follower-total={String(props.followerTotal)}
      >
        <button type="button" onClick={props.onClose}>close</button>
        <button type="button" onClick={() => props.onActiveTabChange('follower')}>to-follower</button>
      </div>
    );
  }
}));

/** Two independent consumers, exactly as the header and the profile are. */
function HeaderEntry() {
  const { openFollowList } = useFollowListModal();
  return (
    <button type="button" onClick={() => openFollowList({ subjectUserId: 'me', initialTab: 'following' })}>
      header-following
    </button>
  );
}

function ProfileEntry({ userId }: { userId: string }) {
  const { openFollowList } = useFollowListModal();
  return (
    <button type="button" onClick={() => openFollowList({ subjectUserId: userId, initialTab: 'follower' })}>
      profile-follower
    </button>
  );
}

function renderApp(profileUserId = 'me') {
  return render(
    <FollowListProvider>
      <HeaderEntry />
      <ProfileEntry userId={profileUserId} />
    </FollowListProvider>
  );
}

const click = async (label: string) => {
  await act(async () => { screen.getByText(label).click(); });
};

beforeEach(() => {
  modalRenders.mockClear();
  mockGetFollowStats.mockReset();
  mockGetFollowStats.mockResolvedValue({ data: { followersCount: 0, followingCount: 0 } });
});

describe('FollowListProvider', () => {
  it('mounts nothing until something opens it', () => {
    renderApp();
    expect(screen.queryByTestId('follow-modal')).not.toBeInTheDocument();
  });

  it('opens on the Following tab from the header', async () => {
    renderApp();
    await click('header-following');

    const modal = screen.getByTestId('follow-modal');
    expect(modal.getAttribute('data-tab')).toBe('following');
    expect(modal.getAttribute('data-user')).toBe('me');
  });

  it('opens on the Followers tab from the profile', async () => {
    renderApp();
    await click('profile-follower');

    expect(screen.getByTestId('follow-modal').getAttribute('data-tab')).toBe('follower');
  });

  it('renders exactly one modal however many entry points exist', async () => {
    renderApp();
    await click('header-following');

    // Two consumers, one instance. A copy per entry point is what this exists
    // to prevent.
    expect(screen.getAllByTestId('follow-modal')).toHaveLength(1);
  });

  it('reuses the same instance when the other entry point opens it', async () => {
    renderApp();
    await click('header-following');
    await click('profile-follower');

    expect(screen.getAllByTestId('follow-modal')).toHaveLength(1);
    expect(screen.getByTestId('follow-modal').getAttribute('data-tab')).toBe('follower');
  });

  it('closes only when asked', async () => {
    renderApp();
    await click('header-following');
    await click('close');

    await waitFor(() => expect(screen.queryByTestId('follow-modal')).not.toBeInTheDocument());
  });

  it('keeps the modal mounted while the opener unmounts', async () => {
    // The dropdown that opened it disappears the moment it is dismissed. The
    // modal lives beside the page, so it must survive that.
    const { rerender } = renderApp();
    await click('header-following');

    rerender(
      <FollowListProvider>
        <ProfileEntry userId="me" />
      </FollowListProvider>
    );

    expect(screen.getByTestId('follow-modal')).toBeInTheDocument();
  });

  it('lets the modal change its own tab', async () => {
    renderApp();
    await click('header-following');
    await click('to-follower');

    expect(screen.getByTestId('follow-modal').getAttribute('data-tab')).toBe('follower');
  });

  it('treats the signed-in user as the owner', async () => {
    renderApp();
    await click('header-following');

    expect(screen.getByTestId('follow-modal').getAttribute('data-own')).toBe('true');
  });

  it('decides ownership itself rather than trusting the caller', async () => {
    // Opening somebody else's lists must not grant the owner-only actions,
    // whichever entry point asked.
    renderApp('someone-else');
    await click('profile-follower');

    const modal = screen.getByTestId('follow-modal');
    expect(modal.getAttribute('data-user')).toBe('someone-else');
    expect(modal.getAttribute('data-own')).toBe('false');
  });

  it('seeds both tab totals from the subject, not the viewer', async () => {
    // The modal only loads the active tab's list, so without a seed the other
    // tab reads zero and appears to disagree with the profile behind it.
    mockGetFollowStats.mockResolvedValue({
      data: { followersCount: 12, followingCount: 5 }
    });
    renderApp('someone-else');
    await click('profile-follower');

    await waitFor(() => expect(mockGetFollowStats).toHaveBeenCalledWith('someone-else'));
    await waitFor(() => {
      const modal = screen.getByTestId('follow-modal');
      expect(modal.getAttribute('data-follower-total')).toBe('12');
      expect(modal.getAttribute('data-following-total')).toBe('5');
    });
  });

  it('refetches the totals when the subject changes', async () => {
    renderApp('someone-else');
    await click('header-following');
    await waitFor(() => expect(mockGetFollowStats).toHaveBeenCalledWith('me'));

    await click('profile-follower');
    await waitFor(() => expect(mockGetFollowStats).toHaveBeenCalledWith('someone-else'));
  });

  it('still opens when the totals cannot be fetched', async () => {
    mockGetFollowStats.mockRejectedValue(new Error('offline'));
    renderApp();
    await click('header-following');

    // The modal loads the active tab's own total regardless; only the seed for
    // the unopened tab is lost.
    expect(screen.getByTestId('follow-modal')).toBeInTheDocument();
  });

  it('ignores a request with no user', async () => {
    function Broken() {
      const { openFollowList } = useFollowListModal();
      return (
        <button type="button" onClick={() => openFollowList({ subjectUserId: '', initialTab: 'following' })}>
          broken
        </button>
      );
    }
    render(<FollowListProvider><Broken /></FollowListProvider>);
    await click('broken');

    expect(screen.queryByTestId('follow-modal')).not.toBeInTheDocument();
  });
});
