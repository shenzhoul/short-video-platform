import { INotification, NOTIFICATION_TYPE } from '@interfaces/notification';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { NotificationProvider, useNotifications } from './notification.provider';

/**
 * Only the external boundaries are replaced: HTTP, the socket transport and the
 * session. Every state transition under test — replay suppression, resurfacing,
 * read handling, unread recounting — runs the real provider code.
 */

const mockSearch = jest.fn();
const mockUnreadCount = jest.fn();
const mockMarkAllRead = jest.fn();

const mockDelete = jest.fn();
jest.mock('@services/notification.service', () => ({
  searchNotifications: (...args: any[]) => mockSearch(...args),
  getUnreadNotificationCount: (...args: any[]) => mockUnreadCount(...args),
  markAllNotificationsRead: (...args: any[]) => mockMarkAllRead(...args),
  deleteNotification: (...args: any[]) => mockDelete(...args)
}));

let sessionStatus = 'authenticated';
jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: sessionStatus, data: null })
}));

/**
 * Minimal stand-in for the socket.io client.
 *
 * `useSocketListener` is left as the real hook, so registration, cleanup and the
 * `enabled` gate are all genuinely exercised; only the wire is fake.
 */
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

  listenerCount(event: string) {
    return this.handlers.get(event)?.size || 0;
  }
}

let fakeSocket: FakeSocket;
let socketConnected = true;

jest.mock('src/socket/socket-context', () => ({
  useSocket: () => ({ socket: fakeSocket, isConnected: socketConnected })
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

function page(data: INotification[], extra: Record<string, any> = {}) {
  return {
    data: {
      data, total: data.length, hasMore: false, nextCursor: null, ...extra
    }
  };
}

/** Renders provider state as text so assertions read the real context value. */
function Probe() {
  const {
    notifications, unreadCount, loading, hasMore, ensureLoaded, loadMore, markAllRead, retry,
    setCategoryFilter, removeNotification
  } = useNotifications();

  return (
    <div>
      <span data-testid="unread">{unreadCount}</span>
      <span data-testid="count">{notifications.length}</span>
      <span data-testid="loading">{loading ? 'yes' : 'no'}</span>
      <span data-testid="hasMore">{hasMore ? 'yes' : 'no'}</span>
      <ol data-testid="rows">
        {notifications.map((item) => (
          <li key={item._id} data-testid={`row-${item._id}`}>
            {item._id}:{item.read ? 'read' : 'unread'}:{item.lastActivityAt}
            <span data-testid={`preview-${item._id}`}>
              {item.commentDeleted ? 'deleted' : (item.commentPreview || '')}
            </span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={ensureLoaded}>load</button>
      <button type="button" onClick={loadMore}>more</button>
      <button type="button" onClick={retry}>retry</button>
      <button type="button" onClick={() => void markAllRead()}>read all</button>
      <button type="button" onClick={() => setCategoryFilter('likes')}>filter likes</button>
      <button type="button" onClick={() => void removeNotification('n1')}>delete n1</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <NotificationProvider>
      <Probe />
    </NotificationProvider>
  );
}

/** Delivers a `notification:created` frame the way the delivery listener would. */
function deliver(payload: INotification) {
  act(() => {
    fakeSocket.emitToClient('notification:created', payload);
  });
}

beforeEach(() => {
  fakeSocket = new FakeSocket();
  socketConnected = true;
  sessionStatus = 'authenticated';
  mockSearch.mockResolvedValue(page([]));
  mockUnreadCount.mockResolvedValue({ data: { total: 0 } });
  mockMarkAllRead.mockResolvedValue({ data: { updated: 0 } });
  mockDelete.mockResolvedValue({ data: { deleted: true } });
});

describe('NotificationProvider unread count', () => {
  it('takes the initial count from the server without loading the list', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 7 } });
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('7'));
    // The badge must be live from login onward, so it cannot depend on the panel.
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('clears everything when the session ends', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 4 } });
    const { rerender } = renderProvider();
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('4'));

    sessionStatus = 'unauthenticated';
    rerender(<NotificationProvider><Probe /></NotificationProvider>);

    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('0'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('re-derives the count when the socket reconnects', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 1 } });
    const { rerender } = renderProvider();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());

    // A dropped connection can miss deliveries entirely, so the count is
    // re-read rather than left at whatever it was when the socket died.
    socketConnected = false;
    rerender(<NotificationProvider><Probe /></NotificationProvider>);
    const callsWhileDown = mockUnreadCount.mock.calls.length;

    mockUnreadCount.mockResolvedValue({ data: { total: 9 } });
    socketConnected = true;
    rerender(<NotificationProvider><Probe /></NotificationProvider>);

    await waitFor(() => expect(mockUnreadCount.mock.calls.length).toBeGreaterThan(callsWhileDown));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('9'));
  });

  it('keeps the badge silent when the count request fails', async () => {
    mockUnreadCount.mockRejectedValue(new Error('offline'));
    renderProvider();

    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());
    expect(screen.getByTestId('unread')).toHaveTextContent('0');
  });
});

describe('NotificationProvider realtime insertion', () => {
  it('prepends a delivered notification once the list is loaded', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'old' })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    mockUnreadCount.mockResolvedValue({ data: { total: 1 } });
    deliver(notification({ _id: 'fresh', lastActivityAt: '2026-08-14T11:00:00.000Z' }));

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    expect(screen.getByTestId('rows').textContent).toMatch(/^fresh/);
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
  });

  it('does not seed an unloaded list, but still updates the badge', async () => {
    renderProvider();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());

    mockUnreadCount.mockResolvedValue({ data: { total: 1 } });
    deliver(notification({ _id: 'fresh' }));

    // Opening the panel must show a real first page, not one stray row.
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
  });

  it('ignores a frame missing the fields identity depends on', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'old' })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    deliver({ _id: 'broken' } as any);
    deliver({ lastActivityAt: '2026-08-14T11:00:00.000Z' } as any);

    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  it('keeps a filtered list pure when another category arrives', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'like1' })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await userEvent.click(screen.getByText('filter likes'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    deliver(notification({
      _id: 'follow1',
      type: NOTIFICATION_TYPE.FOLLOW,
      lastActivityAt: '2026-08-14T12:00:00.000Z'
    }));

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.queryByTestId('row-follow1')).not.toBeInTheDocument();
  });

  it('registers exactly one socket handler however often it re-renders', async () => {
    const { rerender } = renderProvider();
    await waitFor(() => expect(fakeSocket.listenerCount('notification:created')).toBe(1));

    rerender(<NotificationProvider><Probe /></NotificationProvider>);
    rerender(<NotificationProvider><Probe /></NotificationProvider>);

    // A second handler would double-count every delivery.
    expect(fakeSocket.listenerCount('notification:created')).toBe(1);
  });
});

describe('NotificationProvider aggregate identity', () => {
  it('accepts a repeat on the same row as new activity and moves it to the top', async () => {
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'agg', lastActivityAt: '2026-08-14T10:00:00.000Z' }),
      notification({ _id: 'other', lastActivityAt: '2026-08-14T10:30:00.000Z' })
    ]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));

    // The backend reuses the row for an aggregate, so the id repeats; only
    // lastActivityAt distinguishes new activity from a replay.
    deliver(notification({
      _id: 'agg',
      actor: { _id: 'a2', name: 'Cee' },
      lastActivityAt: '2026-08-14T11:00:00.000Z'
    }));

    await waitFor(() => expect(screen.getByTestId('rows').textContent).toMatch(/^agg/));
    // Reused, not duplicated.
    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(screen.getByTestId('row-agg')).toHaveTextContent('2026-08-14T11:00:00.000Z');
  });

  it('ignores an exact replay of an activity it already applied', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'old' })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    const frame = notification({ _id: 'agg', lastActivityAt: '2026-08-14T11:00:00.000Z' });
    deliver(frame);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    const countCallsAfterFirst = mockUnreadCount.mock.calls.length;

    deliver(frame);
    deliver({ ...frame });

    // Same _id and same lastActivityAt: nothing was added, and no recount ran.
    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(mockUnreadCount.mock.calls.length).toBe(countCallsAfterFirst);
  });

  it('does not revert a read row when its own activity is replayed', async () => {
    const frame = notification({ _id: 'agg', lastActivityAt: '2026-08-14T11:00:00.000Z' });
    mockSearch.mockResolvedValue(page([frame]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('row-agg')).toHaveTextContent('unread'));

    await userEvent.click(screen.getByText('read all'));
    await waitFor(() => expect(screen.getByTestId('row-agg')).toHaveTextContent('read'));

    // The payload was captured at creation time and still says read:false. A
    // replay applying it would leave the row and the badge disagreeing.
    deliver(frame);

    expect(screen.getByTestId('row-agg')).toHaveTextContent('read');
    expect(screen.getByTestId('unread')).toHaveTextContent('0');
  });

  it('lets genuine new activity make a read group unread again', async () => {
    const frame = notification({ _id: 'agg', lastActivityAt: '2026-08-14T11:00:00.000Z' });
    mockSearch.mockResolvedValue(page([frame]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await userEvent.click(screen.getByText('read all'));
    await waitFor(() => expect(screen.getByTestId('row-agg')).toHaveTextContent('read'));

    mockUnreadCount.mockResolvedValue({ data: { total: 1 } });
    deliver(notification({
      _id: 'agg',
      read: false,
      lastActivityAt: '2026-08-14T12:00:00.000Z'
    }));

    await waitFor(() => expect(screen.getByTestId('row-agg')).toHaveTextContent('unread'));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
  });

  it('suppresses a socket frame describing an activity a loaded page already carried', async () => {
    const frame = notification({ _id: 'agg', lastActivityAt: '2026-08-14T11:00:00.000Z' });
    mockSearch.mockResolvedValue(page([frame]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    const recountsAfterLoad = mockUnreadCount.mock.calls.length;

    // The server state is newer than any in-flight frame describing it.
    deliver(frame);

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(mockUnreadCount.mock.calls.length).toBe(recountsAfterLoad);
  });

  it('recounts rather than incrementing, because a resurfaced row is not always +1', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'old' })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    // A de-duplicated repeat can resurface an already-read row, so the client
    // never guesses the delta.
    mockUnreadCount.mockResolvedValue({ data: { total: 3 } });
    deliver(notification({ _id: 'agg', lastActivityAt: '2026-08-14T11:00:00.000Z' }));

    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('3'));
  });
});

describe('NotificationProvider read state', () => {
  it('marks every loaded row read and zeroes the badge', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 2 } });
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'a' }),
      notification({ _id: 'b', read: true })
    ]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));

    await userEvent.click(screen.getByText('read all'));

    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('0'));
    expect(screen.getByTestId('row-a')).toHaveTextContent('read');
    expect(screen.getByTestId('row-b')).toHaveTextContent('read');
    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent read-all calls into one mutation', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'a' })]));
    let resolveMark: (value: any) => void = () => undefined;
    mockMarkAllRead.mockReturnValue(new Promise((resolve) => { resolveMark = resolve; }));

    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await userEvent.click(screen.getByText('read all'));
    await userEvent.click(screen.getByText('read all'));

    // StrictMode can replay the panel's mount effect; one visual open must
    // still be one mutation.
    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    await act(async () => { resolveMark({ data: { updated: 1 } }); });
  });

  it('re-reads the server count when the read-all request fails', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 2 } });
    mockSearch.mockResolvedValue(page([notification({ _id: 'a' })]));
    mockMarkAllRead.mockRejectedValue(new Error('boom'));

    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await userEvent.click(screen.getByText('read all'));

    // The optimistic zero must not survive a failure.
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('2'));
  });

  it('normalises a page that raced an in-flight read-all', async () => {
    let resolveMark: (value: any) => void = () => undefined;
    mockMarkAllRead.mockReturnValue(new Promise((resolve) => { resolveMark = resolve; }));
    mockSearch.mockResolvedValue(page([notification({ _id: 'a', read: false })]));

    renderProvider();
    await userEvent.click(screen.getByText('read all'));
    await userEvent.click(screen.getByText('load'));

    await act(async () => { resolveMark({ data: { updated: 1 } }); });

    // The snapshot predates the mutation, so its unread rows must not flash.
    await waitFor(() => expect(screen.getByTestId('row-a')).toHaveTextContent('read'));
  });
});

describe('NotificationProvider paging and filters', () => {
  it('loads the first page once, however often ensureLoaded is called', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'a' })]));
    renderProvider();

    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    await userEvent.click(screen.getByText('load'));

    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('pages with the cursor and de-duplicates against a realtime insert', async () => {
    mockSearch.mockResolvedValueOnce(page(
      [notification({ _id: 'a' })],
      { hasMore: true, nextCursor: { id: 'a', createdAt: 1 } }
    ));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('hasMore')).toHaveTextContent('yes'));

    deliver(notification({ _id: 'b', lastActivityAt: '2026-08-14T11:00:00.000Z' }));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));

    // The next page legitimately contains the row that already arrived live.
    mockSearch.mockResolvedValueOnce(page([
      notification({ _id: 'b', lastActivityAt: '2026-08-14T11:00:00.000Z' }),
      notification({ _id: 'c' })
    ]));
    await userEvent.click(screen.getByText('more'));

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('3'));
  });

  it('replaces the list when the category changes and sends the filter through', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'a' })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    mockSearch.mockResolvedValue(page([notification({ _id: 'like1' })]));
    await userEvent.click(screen.getByText('filter likes'));

    await waitFor(() => expect(screen.getByTestId('row-like1')).toBeInTheDocument());
    expect(mockSearch).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'likes' }));
    expect(screen.queryByTestId('row-a')).not.toBeInTheDocument();
  });

  it('surfaces a failed page and recovers on retry', async () => {
    mockSearch.mockRejectedValueOnce(new Error('down'));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('no'));

    mockSearch.mockResolvedValue(page([notification({ _id: 'a' })]));
    await userEvent.click(screen.getByText('retry'));

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
  });
});

describe('NotificationProvider unread lifecycle', () => {
  it('keeps arriving rows unread until something marks them read', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'old', read: true })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    deliver(notification({ _id: 'fresh', lastActivityAt: '2026-08-14T11:00:00.000Z' }));

    await waitFor(() => expect(screen.getByTestId('row-fresh')).toHaveTextContent('unread'));
    expect(screen.getByTestId('row-old')).toHaveTextContent('read');
  });

  it('leaves old read rows read when a new one arrives', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'a' }), notification({ _id: 'b' })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await userEvent.click(screen.getByText('read all'));
    await waitFor(() => expect(screen.getByTestId('row-a')).toHaveTextContent('read'));

    deliver(notification({ _id: 'c', lastActivityAt: '2026-08-14T12:00:00.000Z' }));

    await waitFor(() => expect(screen.getByTestId('row-c')).toHaveTextContent('unread'));
    expect(screen.getByTestId('row-a')).toHaveTextContent('read');
    expect(screen.getByTestId('row-b')).toHaveTextContent('read');
  });
});

describe('NotificationProvider viewing-session lifecycle', () => {
  it('keeps an arrival unread even while the panel is open', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'old', read: true })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    mockUnreadCount.mockResolvedValue({ data: { total: 1 } });
    deliver(notification({ _id: 'fresh', lastActivityAt: '2026-08-14T11:00:00.000Z' }));

    // A notification landing in front of the reader still belongs to the next
    // seen-batch; swallowing it would make it indistinguishable from history.
    await waitFor(() => expect(screen.getByTestId('row-fresh')).toHaveTextContent('unread'));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
    expect(mockMarkAllRead).not.toHaveBeenCalled();
  });

  it('walks the full bell lifecycle across two viewing sessions', async () => {
    // N1 and N2 arrive: the badge lights up and both rows are new.
    mockSearch.mockResolvedValue(page([]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    mockUnreadCount.mockResolvedValue({ data: { total: 2 } });
    deliver(notification({ _id: 'n1', lastActivityAt: '2026-08-14T10:00:00.000Z' }));
    deliver(notification({ _id: 'n2', lastActivityAt: '2026-08-14T10:01:00.000Z' }));

    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('2'));
    expect(screen.getByTestId('row-n1')).toHaveTextContent('unread');
    expect(screen.getByTestId('row-n2')).toHaveTextContent('unread');

    // Session ends: the batch is marked seen, so the badge clears...
    await userEvent.click(screen.getByText('read all'));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('0'));
    // ...and on the next session those rows read as ordinary history.
    expect(screen.getByTestId('row-n1')).toHaveTextContent(':read:');
    expect(screen.getByTestId('row-n2')).toHaveTextContent(':read:');

    // N3 arrives afterwards and is the only thing that is new.
    mockUnreadCount.mockResolvedValue({ data: { total: 1 } });
    deliver(notification({ _id: 'n3', lastActivityAt: '2026-08-14T11:00:00.000Z' }));

    await waitFor(() => expect(screen.getByTestId('row-n3')).toHaveTextContent('unread'));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('1'));
    expect(screen.getByTestId('row-n1')).toHaveTextContent(':read:');
    expect(screen.getByTestId('row-n2')).toHaveTextContent(':read:');
  });

  it('ignores an exact replay rather than re-marking it new', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'old', read: true })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));

    const frame = notification({ _id: 'fresh', lastActivityAt: '2026-08-14T11:00:00.000Z' });
    deliver(frame);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));
    await userEvent.click(screen.getByText('read all'));
    await waitFor(() => expect(screen.getByTestId('row-fresh')).toHaveTextContent(':read:'));

    deliver(frame);

    // The replay guard keeps a seen row from flipping back to new.
    expect(screen.getByTestId('row-fresh')).toHaveTextContent(':read:');
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });
});

describe('NotificationProvider realtime content invalidation', () => {
  /** Delivers a `notification:updated` frame the way the delivery listener would. */
  function deliverUpdate(payload: Partial<INotification>) {
    act(() => {
      fakeSocket.emitToClient('notification:updated', payload);
    });
  }

  function commentRow(overrides: Partial<INotification> = {}) {
    return notification({
      _id: 'n1',
      type: NOTIFICATION_TYPE.POST_COMMENT,
      commentId: 'c-3',
      commentPreview: '3',
      commentDeleted: false,
      read: true,
      ...overrides
    });
  }

  it('replaces a stale preview with the deleted state in place', async () => {
    mockSearch.mockResolvedValue(page([commentRow()]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('row-n1')).toBeInTheDocument());

    deliverUpdate({ ...commentRow(), commentPreview: null, commentDeleted: true });

    await waitFor(() => expect(screen.getByTestId('preview-n1')).toHaveTextContent('deleted'));
  });

  it('keeps the row in the same position', async () => {
    mockSearch.mockResolvedValue(page([
      notification({ _id: 'a' }), commentRow(), notification({ _id: 'z' })
    ]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('3'));

    deliverUpdate({ ...commentRow(), commentPreview: null, commentDeleted: true });

    // Deletion is a content change, not new activity, so nothing reorders.
    await waitFor(() => expect(screen.getByTestId('preview-n1')).toHaveTextContent('deleted'));
    expect(screen.getByTestId('rows').textContent).toMatch(/^a/);
    expect(screen.getByTestId('count')).toHaveTextContent('3');
  });

  it('does not change read state or the unread count', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 0 } });
    mockSearch.mockResolvedValue(page([commentRow({ read: true })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('row-n1')).toHaveTextContent(':read:'));
    const countCalls = mockUnreadCount.mock.calls.length;

    deliverUpdate({ ...commentRow(), read: false, commentDeleted: true, commentPreview: null });

    await waitFor(() => expect(screen.getByTestId('preview-n1')).toHaveTextContent('deleted'));
    // The server payload is about content; read state belongs to the viewer.
    expect(screen.getByTestId('row-n1')).toHaveTextContent(':read:');
    expect(screen.getByTestId('unread')).toHaveTextContent('0');
    expect(mockUnreadCount.mock.calls.length).toBe(countCalls);
  });

  it('never inserts a row that is not already loaded', async () => {
    mockSearch.mockResolvedValue(page([notification({ _id: 'other' })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    deliverUpdate({ ...commentRow(), commentDeleted: true });

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.queryByTestId('row-n1')).not.toBeInTheDocument();
  });

  it('leaves unrelated rows untouched', async () => {
    mockSearch.mockResolvedValue(page([
      commentRow(), commentRow({ _id: 'n2', commentId: 'c-9', commentPreview: 'keep me' })
    ]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'));

    deliverUpdate({ ...commentRow(), commentPreview: null, commentDeleted: true });

    await waitFor(() => expect(screen.getByTestId('preview-n1')).toHaveTextContent('deleted'));
    expect(screen.getByTestId('preview-n2')).toHaveTextContent('keep me');
  });

  it('is harmless when the same deletion arrives twice', async () => {
    mockSearch.mockResolvedValue(page([commentRow()]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('row-n1')).toBeInTheDocument());

    const update = { ...commentRow(), commentPreview: null, commentDeleted: true };
    deliverUpdate(update);
    deliverUpdate(update);

    await waitFor(() => expect(screen.getByTestId('preview-n1')).toHaveTextContent('deleted'));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  it('ignores a malformed update', async () => {
    mockSearch.mockResolvedValue(page([commentRow()]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    deliverUpdate({} as any);

    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  it('updates a reply notification the same way', async () => {
    mockSearch.mockResolvedValue(page([
      commentRow({ type: NOTIFICATION_TYPE.COMMENT_REPLY, commentPreview: 'hello' })
    ]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('preview-n1')).toHaveTextContent('hello'));

    deliverUpdate({
      ...commentRow({ type: NOTIFICATION_TYPE.COMMENT_REPLY }),
      commentPreview: null,
      commentDeleted: true
    });

    await waitFor(() => expect(screen.getByTestId('preview-n1')).toHaveTextContent('deleted'));
  });
});

describe('NotificationProvider notification deletion', () => {
  function rows() {
    return page([
      notification({ _id: 'a' }),
      notification({ _id: 'n1', read: false }),
      notification({ _id: 'z' })
    ]);
  }

  it('removes only that row and keeps the others in order', async () => {
    mockSearch.mockResolvedValue(rows());
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('3'));

    await userEvent.click(screen.getByText('delete n1'));

    await waitFor(() => expect(screen.queryByTestId('row-n1')).not.toBeInTheDocument());
    expect(screen.getByTestId('rows').textContent).toMatch(/^a/);
    expect(screen.getByTestId('row-z')).toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('decrements the badge exactly once for an unread row', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 3 } });
    mockSearch.mockResolvedValue(rows());
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('3'));

    await userEvent.click(screen.getByText('delete n1'));

    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('2'));
  });

  it('leaves the badge alone when the row was already read', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 3 } });
    mockSearch.mockResolvedValue(page([notification({ _id: 'n1', read: true })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('3'));

    await userEvent.click(screen.getByText('delete n1'));

    await waitFor(() => expect(screen.queryByTestId('row-n1')).not.toBeInTheDocument());
    // Deleting is not reading.
    expect(screen.getByTestId('unread')).toHaveTextContent('3');
  });

  it('never drives the badge below zero', async () => {
    mockUnreadCount.mockResolvedValue({ data: { total: 0 } });
    mockSearch.mockResolvedValue(page([notification({ _id: 'n1', read: false })]));
    renderProvider();
    await userEvent.click(screen.getByText('load'));

    await userEvent.click(screen.getByText('delete n1'));

    await waitFor(() => expect(screen.queryByTestId('row-n1')).not.toBeInTheDocument());
    expect(screen.getByTestId('unread')).toHaveTextContent('0');
  });

  it('does not refetch the list', async () => {
    mockSearch.mockResolvedValue(rows());
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('3'));
    const calls = mockSearch.mock.calls.length;

    await userEvent.click(screen.getByText('delete n1'));

    await waitFor(() => expect(screen.queryByTestId('row-n1')).not.toBeInTheDocument());
    expect(mockSearch.mock.calls.length).toBe(calls);
  });

  it('keeps the row when the server refuses the delete', async () => {
    mockSearch.mockResolvedValue(rows());
    mockDelete.mockRejectedValue(new Error('not found'));
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('3'));

    await userEvent.click(screen.getByText('delete n1'));

    // The server is authoritative; a failed delete must not remove it locally.
    await waitFor(() => expect(screen.getByTestId('row-n1')).toBeInTheDocument());
  });

  it('does not let a late update resurrect a deleted row', async () => {
    mockSearch.mockResolvedValue(rows());
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await userEvent.click(screen.getByText('delete n1'));
    await waitFor(() => expect(screen.queryByTestId('row-n1')).not.toBeInTheDocument());

    // An invalidation frame for n1 that was already in flight when it was deleted.
    act(() => {
      fakeSocket.emitToClient('notification:updated', {
        ...notification({ _id: 'n1' }), commentDeleted: true
      });
    });

    expect(screen.queryByTestId('row-n1')).not.toBeInTheDocument();
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('still accepts a genuinely new notification afterwards', async () => {
    mockSearch.mockResolvedValue(rows());
    renderProvider();
    await userEvent.click(screen.getByText('load'));
    await userEvent.click(screen.getByText('delete n1'));
    await waitFor(() => expect(screen.queryByTestId('row-n1')).not.toBeInTheDocument());

    deliver(notification({ _id: 'fresh', lastActivityAt: '2026-08-14T12:00:00.000Z' }));

    // The guard covers the deleted id only; new activity must still arrive.
    await waitFor(() => expect(screen.getByTestId('row-fresh')).toBeInTheDocument());
  });
});

describe('useNotifications', () => {
  it('refuses to be used outside the provider', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/must be used within a NotificationProvider/);
    consoleError.mockRestore();
  });
});
