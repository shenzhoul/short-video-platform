import { INotification, NOTIFICATION_TYPE } from '@interfaces/notification';
import { NotificationProvider } from '@providers/notification.provider';
import {
  act, render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import NotificationToaster from './notification-toast';

/**
 * The realtime toast, driven through the real provider so the replay guard and
 * the toast queue are the production ones.
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

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush })
}));

class FakeSocket {
  private handlers = new Map<string, Set<(payload: any) => void>>();

  on(event: string, handler: (payload: any) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: (payload: any) => void) {
    this.handlers.get(event)?.delete(handler);
  }

  emitToClient(event: string, payload: any) {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}

let fakeSocket: FakeSocket;
jest.mock('src/socket/socket-context', () => ({
  useSocket: () => ({ socket: fakeSocket, isConnected: true })
}));

function notification(overrides: Partial<INotification> = {}): INotification {
  return {
    _id: 'n1',
    type: NOTIFICATION_TYPE.POST_LIKE,
    actorId: 'a1',
    actor: { _id: 'a1', username: 'bee', name: 'Bee' },
    postId: 'p1',
    read: false,
    lastActivityAt: '2026-08-14T10:00:00.000Z',
    createdAt: '2026-08-14T10:00:00.000Z',
    ...overrides
  };
}

function renderToaster() {
  return render(
    <NotificationProvider>
      <NotificationToaster />
    </NotificationProvider>
  );
}

function deliver(payload: INotification) {
  act(() => {
    fakeSocket.emitToClient('notification:created', payload);
  });
}

beforeEach(() => {
  fakeSocket = new FakeSocket();
  mockSearch.mockResolvedValue({ data: { data: [], hasMore: false, nextCursor: null } });
  mockUnreadCount.mockResolvedValue({ data: { total: 0 } });
  mockMarkAllRead.mockResolvedValue({ data: { updated: 0 } });
});

describe('realtime notification toast', () => {
  it('shows nothing until something arrives', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('appears for a genuine new realtime activity', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());

    deliver(notification({ _id: 'fresh' }));

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Bee')).toBeInTheDocument();
    expect(screen.getByText('liked your post')).toBeInTheDocument();
  });

  it('shows the actor avatar and the post thumbnail', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());

    deliver(notification({
      _id: 'fresh',
      actor: { _id: 'a1', name: 'Bee', avatar: 'https://cdn.test/a.jpg' },
      postThumbnail: 'https://cdn.test/cover.jpg'
    }));

    const toast = await screen.findByRole('status');
    const images = Array.from(toast.querySelectorAll('img')).map((img) => img.getAttribute('src'));
    expect(images).toContain('https://cdn.test/a.jpg');
    expect(images).toContain('https://cdn.test/cover.jpg');
  });

  it('does NOT appear for an exact socket replay', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());

    const frame = notification({ _id: 'agg', lastActivityAt: '2026-08-14T11:00:00.000Z' });
    deliver(frame);
    await screen.findByRole('status');

    deliver(frame);
    deliver({ ...frame });

    // Same _id and same lastActivityAt: the provider's replay guard already
    // dropped it, so the toast queue never sees it.
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('shows the refreshed wording for a genuine aggregate update', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());

    deliver(notification({ _id: 'agg', lastActivityAt: '2026-08-14T11:00:00.000Z', actorCount: 1 }));
    await screen.findByText('liked your post');

    deliver(notification({
      _id: 'agg',
      lastActivityAt: '2026-08-14T12:00:00.000Z',
      actor: { _id: 'a3', name: 'Devmodel' },
      actorCount: 3
    }));

    expect(await screen.findByText('and 2 others liked your post')).toBeInTheDocument();
    expect(screen.getByText('Devmodel')).toBeInTheDocument();
  });

  it('dismisses when the close control is used', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());
    deliver(notification({ _id: 'fresh' }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('auto-dismisses after its lifetime', async () => {
    jest.useFakeTimers();
    try {
      renderToaster();
      await act(async () => { await Promise.resolve(); });
      deliver(notification({ _id: 'fresh' }));
      expect(screen.getByRole('status')).toBeInTheDocument();

      act(() => { jest.advanceTimersByTime(6500); });

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not mark the notification read merely by appearing', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());

    deliver(notification({ _id: 'fresh' }));
    await screen.findByRole('status');

    // The bell keeps its badge until the panel is opened.
    expect(mockMarkAllRead).not.toHaveBeenCalled();
  });

  it('navigates with the same policy as the panel row', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());
    deliver(notification({ _id: 'fresh', postId: 'post-9' }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByText('Bee'));

    expect(mockPush).toHaveBeenCalledWith('/?modal_id=post-9');
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('sends a comment-scoped toast to the Comments tab', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());
    deliver(notification({
      _id: 'fresh',
      type: NOTIFICATION_TYPE.COMMENT_REPLY,
      postId: 'post-9',
      commentId: 'c-1'
    }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByText('Bee'));

    expect(mockPush).toHaveBeenCalledWith('/?modal_id=post-9&modal_tab=comments&target_comment_id=c-1');
  });

  it('shows the removed-comment notice in the toast too', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());

    deliver(notification({
      _id: 'fresh',
      type: NOTIFICATION_TYPE.COMMENT_MENTION,
      commentId: 'c-1',
      commentDeleted: true
    }));

    expect(await screen.findByText('This comment has been deleted.')).toBeInTheDocument();
  });

  it('stacks a bounded number of toasts', async () => {
    renderToaster();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());

    for (let index = 0; index < 5; index += 1) {
      deliver(notification({ _id: `n${index}`, lastActivityAt: `2026-08-14T1${index}:00:00.000Z` }));
    }

    // Old toasts are dropped rather than filling the screen.
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });
});
