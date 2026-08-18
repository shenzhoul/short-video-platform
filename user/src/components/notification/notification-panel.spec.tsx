import { INotification, NOTIFICATION_TYPE } from '@interfaces/notification';
import { NotificationProvider } from '@providers/notification.provider';
import {
  act, render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import NotificationPanel from './notification-panel';

/**
 * The panel is rendered over the real NotificationProvider, so filtering, paging
 * and read state run the production code path. Only HTTP, the socket, the
 * session and the router are stood in for.
 */

const mockSearch = jest.fn();
const mockUnreadCount = jest.fn();
const mockMarkAllRead = jest.fn();

jest.mock('@services/notification.service', () => ({
  searchNotifications: (...args: any[]) => mockSearch(...args),
  getUnreadNotificationCount: (...args: any[]) => mockUnreadCount(...args),
  markAllNotificationsRead: (...args: any[]) => mockMarkAllRead(...args)
}));

jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: null })
}));

jest.mock('src/socket/socket-context', () => ({
  useSocket: () => ({ socket: null, isConnected: false })
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush })
}));

/**
 * `useFollowCreator` is a shared hook with its own follow/unfollow concerns and
 * its own network calls; it is not part of the notification system. Only its
 * surface is stood in for so the row's follow control can be asserted.
 */
const mockToggleFollow = jest.fn();
jest.mock('@hooks/use-follow-creator', () => ({
  useFollowCreator: (_creatorId?: string, initialIsFollowed = false) => ({
    isFollowed: initialIsFollowed,
    following: false,
    isOwner: false,
    toggleFollow: mockToggleFollow
  })
}));

function notification(overrides: Partial<INotification> = {}): INotification {
  return {
    _id: 'n1',
    type: NOTIFICATION_TYPE.POST_LIKE,
    actorId: 'a1',
    actor: { _id: 'a1', username: 'bee', name: 'Bee' },
    postId: 'p1',
    postThumbnail: 'https://cdn.test/cover.jpg',
    read: false,
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function page(data: INotification[], extra: Record<string, any> = {}) {
  return {
    data: {
      data, total: data.length, hasMore: false, nextCursor: null, ...extra
    }
  };
}

const onNavigate = jest.fn();

function renderPanel() {
  return render(
    <NotificationProvider>
      <NotificationPanel onNavigate={onNavigate} />
    </NotificationProvider>
  );
}

beforeEach(() => {
  mockSearch.mockResolvedValue(page([]));
  mockUnreadCount.mockResolvedValue({ data: { total: 0 } });
  mockMarkAllRead.mockResolvedValue({ data: { updated: 0 } });
});

describe('notification panel rendering', () => {
  it('renders each backend type with its own sentence', async () => {
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'like', type: NOTIFICATION_TYPE.POST_LIKE }),
      notification({ _id: 'clike', type: NOTIFICATION_TYPE.COMMENT_LIKE }),
      notification({ _id: 'comment', type: NOTIFICATION_TYPE.POST_COMMENT }),
      notification({ _id: 'reply', type: NOTIFICATION_TYPE.COMMENT_REPLY }),
      notification({ _id: 'pmention', type: NOTIFICATION_TYPE.POST_MENTION }),
      notification({ _id: 'cmention', type: NOTIFICATION_TYPE.COMMENT_MENTION }),
      notification({ _id: 'follow', type: NOTIFICATION_TYPE.FOLLOW, postId: null })
    ]));
    renderPanel();

    expect(await screen.findByText('liked your post')).toBeInTheDocument();
    expect(screen.getByText('liked your comment')).toBeInTheDocument();
    expect(screen.getByText('commented on your post')).toBeInTheDocument();
    expect(screen.getByText('replied to your comment')).toBeInTheDocument();
    expect(screen.getByText('mentioned you in a post')).toBeInTheDocument();
    expect(screen.getByText('mentioned you in a comment')).toBeInTheDocument();
    expect(screen.getByText('started following you')).toBeInTheDocument();
    expect(screen.queryByText('interacted with you')).not.toBeInTheDocument();
  });

  it('renders an aggregate as the latest actor plus the remaining count', async () => {
    mockSearch.mockResolvedValue(page([
      notification({
        _id: 'agg',
        actor: { _id: 'a4', name: 'Dee' },
        isAggregate: true,
        actorCount: 4
      })
    ]));
    renderPanel();

    // The stored actor is the most recent one; the count comes from the
    // authoritative like statistic, not from a stored actor list.
    expect(await screen.findByText('Dee')).toBeInTheDocument();
    expect(screen.getByText('and 3 others liked your post')).toBeInTheDocument();
  });

  it('renders a two-actor aggregate in the singular', async () => {
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'agg', isAggregate: true, actorCount: 2 })
    ]));
    renderPanel();

    expect(await screen.findByText('and 1 other liked your post')).toBeInTheDocument();
  });

  it('shows a follow control only on follow rows', async () => {
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'follow', type: NOTIFICATION_TYPE.FOLLOW, postId: null }),
      notification({ _id: 'like', type: NOTIFICATION_TYPE.POST_LIKE })
    ]));
    renderPanel();

    expect(await screen.findByRole('button', { name: 'Follow back' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Follow back' })).toHaveLength(1);
  });

  it('shows the post thumbnail on post-scoped rows and not on follows', async () => {
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'like' }),
      notification({
        _id: 'follow', type: NOTIFICATION_TYPE.FOLLOW, postId: null, postThumbnail: null
      })
    ]));
    const { container } = renderPanel();

    await screen.findByText('liked your post');
    const thumbnails = container.querySelectorAll('img[src="https://cdn.test/cover.jpg"]');
    expect(thumbnails).toHaveLength(1);
  });

  it('renders the empty state when the recipient has nothing', async () => {
    renderPanel();
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
  });

  it('offers a retry when the page fails', async () => {
    mockSearch.mockRejectedValueOnce(new Error('down'));
    renderPanel();

    expect(await screen.findByText('Notifications could not be loaded.')).toBeInTheDocument();

    mockSearch.mockResolvedValue(page([notification({ _id: 'a' })]));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('liked your post')).toBeInTheDocument();
  });
});

describe('notification panel: no share notifications', () => {
  it('does not offer share as a filter category', async () => {
    renderPanel();
    await screen.findByText('No notifications yet');

    await userEvent.click(screen.getByRole('button', { name: /All/ }));

    const categories = screen.getAllByRole('menuitemradio').map((item) => item.textContent);
    // Share contributes to statistics only; delivery belongs to messaging.
    expect(categories).toEqual(['All', 'Followers', 'Mentions', 'Comments', 'Likes']);
    expect(categories.join(' ').toLowerCase()).not.toContain('share');
  });

  it('never navigates a row the client cannot resolve, including a legacy share row', async () => {
    // post_share was removed from the type set; any row left over from before it
    // must render harmlessly rather than link somewhere misleading.
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'legacy', type: 'post_share' as any, postId: null })
    ]));
    renderPanel();

    const row = await screen.findByText('interacted with you');
    await userEvent.click(row);

    expect(mockPush).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('notification panel navigation', () => {
  it('sends a post-scoped row to the post modal', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'like', postId: 'post-42' })]));
    renderPanel();

    await userEvent.click(await screen.findByText('liked your post'));

    expect(mockPush).toHaveBeenCalledWith('/?modal_id=post-42');
    expect(onNavigate).toHaveBeenCalled();
  });

  it('sends a comment or mention row to its containing post', async () => {
    mockSearch.mockResolvedValue(page([
      notification({
        _id: 'cmention',
        type: NOTIFICATION_TYPE.COMMENT_MENTION,
        postId: 'post-7',
        commentId: 'c-9'
      })
    ]));
    renderPanel();

    await userEvent.click(await screen.findByText('mentioned you in a comment'));

    // Comment-scoped rows land on the conversation, not the video.
    expect(mockPush).toHaveBeenCalledWith('/?modal_id=post-7&modal_tab=comments&target_comment_id=c-9');
  });

  it('sends a follow row to the actor profile', async () => {
    mockSearch.mockResolvedValue(page([
      notification({
        _id: 'follow',
        type: NOTIFICATION_TYPE.FOLLOW,
        postId: null,
        actor: { _id: 'a1', username: 'ceecee', name: 'Cee' }
      })
    ]));
    renderPanel();

    await userEvent.click(await screen.findByText('started following you'));

    expect(mockPush).toHaveBeenCalledWith('/ceecee');
  });

  it('keeps an already-read row navigable', async () => {
    // Opening the panel marks everything read, so this is the state a row is in
    // for every visit after the first — it must stay clickable.
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'like', read: true, postId: 'post-42' })
    ]));
    renderPanel();

    const row = await screen.findByText('liked your post');
    await userEvent.click(row);

    expect(mockPush).toHaveBeenCalledWith('/?modal_id=post-42');
  });

  it('activates a row from the keyboard as well as the pointer', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'like', postId: 'post-42' })]));
    renderPanel();

    const row = (await screen.findByText('liked your post')).closest('[role="button"]')!;
    (row as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');

    expect(mockPush).toHaveBeenCalledWith('/?modal_id=post-42');
  });

  it('follows back without navigating away', async () => {
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'follow', type: NOTIFICATION_TYPE.FOLLOW, postId: null })
    ]));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Follow back' }));

    expect(mockToggleFollow).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('notification panel read behaviour', () => {
  it('leaves the bell badge lit while the panel is open', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 3 } });
    mockSearch.mockResolvedValue(page([notification({ _id: 'a', read: false })]));
    renderPanel();

    await screen.findByText('liked your post');
    // "There is new activity" and "this row is no longer new" are separate
    // events; opening the panel must not settle either one early.
    expect(mockMarkAllRead).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Unread')).toBeInTheDocument();
  });

  it('keeps unread dots visible for the whole viewing session', async () => {
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'a', read: false }),
      notification({ _id: 'b', read: false })
    ]));

    renderPanel();
    await waitFor(() => expect(screen.getAllByText('liked your post')).toHaveLength(2));

    // The rows the user came to look at must actually show as new. Marking read
    // on open used to clear these before they were ever seen.
    expect(screen.getAllByLabelText('Unread')).toHaveLength(2);
    expect(mockMarkAllRead).not.toHaveBeenCalled();
  });

  it('marks the batch seen only once the panel closes', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'a', read: false })]));
    const { unmount } = renderPanel();
    await screen.findByText('liked your post');
    expect(mockMarkAllRead).not.toHaveBeenCalled();

    unmount();

    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it('keeps already-read rows without a dot', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'a', read: true })]));
    renderPanel();

    await screen.findByText('liked your post');
    expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument();
  });

  it('renders a deleted-comment row with its notice and keeps it clickable', async () => {
    mockSearch.mockResolvedValue(page([
      notification({
        _id: 'gone',
        type: NOTIFICATION_TYPE.COMMENT_MENTION,
        postId: 'post-3',
        commentId: 'c-1',
        commentDeleted: true
      })
    ]));
    renderPanel();

    expect(await screen.findByText('This comment has been deleted.')).toBeInTheDocument();
    await userEvent.click(screen.getByText('mentioned you in a comment'));

    expect(mockPush).toHaveBeenCalledWith('/?modal_id=post-3&modal_tab=comments&target_comment_id=c-1');
  });

  it('requests a filtered page when a category is chosen', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'a' })]));
    renderPanel();
    await screen.findByText('liked your post');

    await userEvent.click(screen.getByRole('button', { name: /All/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Mentions' }));

    await waitFor(() => expect(mockSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'mentions' })
    ));
  });
});
