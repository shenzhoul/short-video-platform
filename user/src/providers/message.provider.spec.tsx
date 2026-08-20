import type { IConversation, IMessage } from '@interfaces/message';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessageProvider, useMessages } from './message.provider';

/**
 * Only the external boundaries are replaced: HTTP, the socket transport and the
 * session. Every state transition under test — echo suppression, unread
 * authority, read synchronisation, reconnect recovery — runs the real provider.
 */

const mockSearchConversations = jest.fn();
const mockUnreadCount = jest.fn();
const mockMarkAllRead = jest.fn();
const mockMarkConversationRead = jest.fn();
const mockOpenConversation = jest.fn();

jest.mock('@services/message.service', () => ({
  searchConversations: (...args: any[]) => mockSearchConversations(...args),
  getMessageUnreadCount: (...args: any[]) => mockUnreadCount(...args),
  markAllMessagesRead: (...args: any[]) => mockMarkAllRead(...args),
  markConversationRead: (...args: any[]) => mockMarkConversationRead(...args),
  openConversation: (...args: any[]) => mockOpenConversation(...args)
}));

let sessionStatus = 'authenticated';
jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: sessionStatus, data: { user: { _id: 'me' } } })
}));

/** Minimal stand-in for the socket.io client; `useSocketListener` stays real. */
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

function conversation(overrides: Partial<IConversation> = {}): IConversation {
  return {
    _id: 'c1',
    recipientIds: ['me', 'them'],
    participant: { _id: 'them', username: 'bee', name: 'Bee' },
    lastMessage: 'hi',
    lastMessageType: 'text',
    lastSenderId: 'them',
    lastMessageCreatedAt: '2026-08-14T10:00:00.000Z',
    unreadCount: 0,
    isMutualFollow: false,
    canSend: true,
    awaitingReplyFrom: null,
    requestState: 'idle',
    restrictionReason: null,
    createdAt: '2026-08-14T09:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
    ...overrides
  } as IConversation;
}

function message(overrides: Partial<IMessage> = {}): IMessage {
  return {
    _id: 'm1',
    conversationId: 'c1',
    type: 'text',
    text: 'hello',
    senderId: 'them',
    files: [],
    createdAt: '2026-08-14T10:00:00.000Z',
    ...overrides
  } as IMessage;
}

let received: IMessage[] = [];

function Probe() {
  const {
    conversations, unread, hasUnread, ensureLoaded, subscribeToMessages,
    markConversationRead, markAllRead, openConversationWith
  } = useMessages();

  React.useEffect(() => subscribeToMessages((incoming) => {
    received.push(incoming);
  }), [subscribeToMessages]);

  return (
    <div>
      <span data-testid="total">{unread.totalUnreadMessages}</span>
      <span data-testid="conversations">{unread.totalUnreadConversations}</span>
      <span data-testid="dot">{hasUnread ? 'on' : 'off'}</span>
      <span data-testid="rows">{conversations.map((item) => `${item._id}:${item.unreadCount}`).join(',')}</span>
      <button type="button" onClick={ensureLoaded}>load</button>
      <button type="button" onClick={() => void markConversationRead('c1')}>read-c1</button>
      <button type="button" onClick={() => void markAllRead()}>read-all</button>
      <button type="button" onClick={() => void openConversationWith('creator-1')}>open-with</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <MessageProvider>
      <Probe />
    </MessageProvider>
  );
}

beforeEach(() => {
  fakeSocket = new FakeSocket();
  socketConnected = true;
  sessionStatus = 'authenticated';
  received = [];
  mockUnreadCount.mockResolvedValue({ data: { totalUnreadMessages: 0, totalUnreadConversations: 0 } });
  mockSearchConversations.mockResolvedValue({ data: { data: [], hasMore: false, nextCursor: null } });
  mockMarkAllRead.mockResolvedValue({});
  mockMarkConversationRead.mockResolvedValue({});
});

describe('MessageProvider', () => {
  it('loads the unread indicator without the workspace ever opening', async () => {
    mockUnreadCount.mockResolvedValue({
      data: { totalUnreadMessages: 3, totalUnreadConversations: 2 }
    });

    renderProvider();

    // The badge must be live from sign-in, independent of the panel — so the
    // conversation list is deliberately still unfetched at this point.
    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('3'));
    expect(screen.getByTestId('dot')).toHaveTextContent('on');
    expect(mockSearchConversations).not.toHaveBeenCalled();
  });

  it('registers exactly one handler per socket event', async () => {
    renderProvider();

    await waitFor(() => expect(fakeSocket.listenerCount('message:created')).toBe(1));
    expect(fakeSocket.listenerCount('conversation:updated')).toBe(1);
    expect(fakeSocket.listenerCount('message:unread-updated')).toBe(1);
    expect(fakeSocket.listenerCount('message:read')).toBe(1);
  });

  it('takes unread totals from the server rather than counting arrivals', async () => {
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('0'));

    act(() => {
      fakeSocket.emitToClient('message:created', message());
    });
    // A message arriving does not itself move the badge: only the server's
    // totals do. Counting locally would drift on any replayed or missed frame.
    expect(screen.getByTestId('total')).toHaveTextContent('0');

    act(() => {
      fakeSocket.emitToClient('message:unread-updated', {
        totalUnreadMessages: 5,
        totalUnreadConversations: 2
      });
    });
    expect(screen.getByTestId('total')).toHaveTextContent('5');
    expect(screen.getByTestId('conversations')).toHaveTextContent('2');
    expect(screen.getByTestId('dot')).toHaveTextContent('on');
  });

  it('delivers a message to subscribed threads exactly once, ignoring replays', async () => {
    renderProvider();
    await waitFor(() => expect(fakeSocket.listenerCount('message:created')).toBe(1));

    act(() => {
      fakeSocket.emitToClient('message:created', message({ _id: 'm-echo' }));
      fakeSocket.emitToClient('message:created', message({ _id: 'm-echo' }));
    });

    // The same id twice is one message: a queue retry, a second surface, or the
    // sender's own echo of what they just posted.
    expect(received.map((item) => item._id)).toEqual(['m-echo']);
  });

  it('replaces a conversation row with the server payload and keeps order by activity', async () => {
    mockSearchConversations.mockResolvedValue({
      data: {
        data: [
          conversation({ _id: 'c1', lastMessageCreatedAt: '2026-08-14T10:00:00.000Z' }),
          conversation({ _id: 'c2', lastMessageCreatedAt: '2026-08-14T09:00:00.000Z' })
        ],
        hasMore: false,
        nextCursor: null
      }
    });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('c1:0,c2:0'));

    act(() => {
      fakeSocket.emitToClient('conversation:updated', conversation({
        _id: 'c2',
        unreadCount: 4,
        lastMessageCreatedAt: '2026-08-14T11:00:00.000Z'
      }));
    });

    // Newest activity first, and the unread count comes from the payload rather
    // than being incremented locally.
    expect(screen.getByTestId('rows')).toHaveTextContent('c2:4,c1:0');
  });

  it('keeps an empty conversation in its server position when the list re-sorts', async () => {
    // Ordering must not depend on whether a re-sort has happened: an empty
    // conversation is placed by when it was opened, exactly as the server
    // places it, rather than dropping below everything that has a message.
    mockSearchConversations.mockResolvedValue({
      data: {
        data: [
          conversation({ _id: 'third', lastMessageCreatedAt: '2026-08-14T12:00:00.000Z', createdAt: '2026-08-14T12:00:00.000Z' }),
          conversation({ _id: 'empty', lastMessageCreatedAt: null, createdAt: '2026-08-14T11:00:00.000Z' }),
          conversation({ _id: 'old', lastMessageCreatedAt: '2026-08-14T10:00:00.000Z', createdAt: '2026-08-14T09:00:00.000Z' })
        ],
        hasMore: false,
        nextCursor: null
      }
    });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('third:0,empty:0,old:0'));

    // Any row update re-sorts the whole list.
    act(() => {
      fakeSocket.emitToClient('conversation:updated', conversation({
        _id: 'third',
        lastMessageCreatedAt: '2026-08-14T13:00:00.000Z',
        createdAt: '2026-08-14T12:00:00.000Z'
      }));
    });

    expect(screen.getByTestId('rows')).toHaveTextContent('third:0,empty:0,old:0');
  });

  it('orders an empty conversation by its real activity once it has a message', async () => {
    mockSearchConversations.mockResolvedValue({
      data: {
        data: [
          conversation({ _id: 'empty', lastMessageCreatedAt: null, createdAt: '2026-08-14T11:00:00.000Z' }),
          conversation({ _id: 'old', lastMessageCreatedAt: '2026-08-14T10:00:00.000Z', createdAt: '2026-08-14T09:00:00.000Z' })
        ],
        hasMore: false,
        nextCursor: null
      }
    });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('empty:0,old:0'));

    // The other conversation gets a genuinely newer message and takes the top.
    act(() => {
      fakeSocket.emitToClient('conversation:updated', conversation({
        _id: 'old',
        lastMessageCreatedAt: '2026-08-14T14:00:00.000Z',
        createdAt: '2026-08-14T09:00:00.000Z'
      }));
    });

    expect(screen.getByTestId('rows')).toHaveTextContent('old:0,empty:0');
  });

  it('does not resurrect a read conversation when a replayed frame says otherwise', async () => {
    mockSearchConversations.mockResolvedValue({
      data: { data: [conversation({ _id: 'c1', unreadCount: 3 })], hasMore: false, nextCursor: null }
    });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('c1:3'));

    await act(async () => { screen.getByText('read-c1').click(); });
    expect(screen.getByTestId('rows')).toHaveTextContent('c1:0');

    // The server's own read frame arrives after, carrying the same outcome.
    act(() => {
      fakeSocket.emitToClient('message:read', { conversationIds: ['c1'] });
    });
    expect(screen.getByTestId('rows')).toHaveTextContent('c1:0');
    expect(mockMarkConversationRead).toHaveBeenCalledWith('c1');
  });

  it('always tells the server a conversation was read, even when the local row shows zero', async () => {
    mockSearchConversations.mockResolvedValue({
      data: { data: [conversation({ _id: 'c1', unreadCount: 0 })], hasMore: false, nextCursor: null }
    });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('c1:0'));

    await act(async () => { screen.getByText('read-c1').click(); });

    // The local count is stale in exactly the case that matters: a message
    // arriving in the thread the reader already has open is applied before its
    // increment comes back. Skipping the call there left the increment with
    // nothing to clear it.
    expect(mockMarkConversationRead).toHaveBeenCalledWith('c1');
  });

  it('does not resurrect unread when the row update arrives after the read', async () => {
    mockSearchConversations.mockResolvedValue({
      data: { data: [conversation({ _id: 'c1', unreadCount: 0 })], hasMore: false, nextCursor: null }
    });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('c1:0'));

    await act(async () => { screen.getByText('read-c1').click(); });
    // The server's own row update, computed before the read landed.
    act(() => {
      fakeSocket.emitToClient('conversation:updated', conversation({ _id: 'c1', unreadCount: 1 }));
    });
    // ...and then the authoritative read frame that follows it.
    act(() => {
      fakeSocket.emitToClient('message:read', { conversationIds: ['c1'] });
    });

    expect(screen.getByTestId('rows')).toHaveTextContent('c1:0');
  });

  it('adds a conversation opened from a profile to the list straight away', async () => {
    mockSearchConversations.mockResolvedValue({ data: { data: [], hasMore: false, nextCursor: null } });
    mockOpenConversation.mockResolvedValue({ data: conversation({ _id: 'new-1', unreadCount: 0 }) });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(mockSearchConversations).toHaveBeenCalled());

    await act(async () => { screen.getByText('open-with').click(); });

    // Without this the user starts a conversation from a profile, presses back,
    // and finds an empty list until they reload.
    expect(screen.getByTestId('rows')).toHaveTextContent('new-1:0');
  });

  it('does not add the same conversation twice', async () => {
    mockSearchConversations.mockResolvedValue({ data: { data: [], hasMore: false, nextCursor: null } });
    mockOpenConversation.mockResolvedValue({ data: conversation({ _id: 'new-1', unreadCount: 0 }) });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(mockSearchConversations).toHaveBeenCalled());

    await act(async () => { screen.getByText('open-with').click(); });
    await act(async () => { screen.getByText('open-with').click(); });

    expect(screen.getByTestId('rows').textContent).toBe('new-1:0');
  });

  it('clears every row on a read-all frame from another tab', async () => {
    mockSearchConversations.mockResolvedValue({
      data: {
        data: [conversation({ _id: 'c1', unreadCount: 2 }), conversation({ _id: 'c2', unreadCount: 5 })],
        hasMore: false,
        nextCursor: null
      }
    });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('c1:2,c2:5'));

    act(() => {
      // A null list means every conversation, which is how a read-all reaches
      // the user's other sessions.
      fakeSocket.emitToClient('message:read', { conversationIds: null });
    });
    expect(screen.getByTestId('rows')).toHaveTextContent('c1:0,c2:0');
  });

  it('persists read-all on the server rather than only in local state', async () => {
    mockSearchConversations.mockResolvedValue({
      data: { data: [conversation({ _id: 'c1', unreadCount: 2 })], hasMore: false, nextCursor: null }
    });
    mockUnreadCount.mockResolvedValue({
      data: { totalUnreadMessages: 2, totalUnreadConversations: 1 }
    });

    renderProvider();
    act(() => { screen.getByText('load').click(); });
    await waitFor(() => expect(screen.getByTestId('dot')).toHaveTextContent('on'));

    await act(async () => { screen.getByText('read-all').click(); });

    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dot')).toHaveTextContent('off');
    expect(screen.getByTestId('rows')).toHaveTextContent('c1:0');
  });

  it('re-derives totals when the socket reconnects', async () => {
    socketConnected = false;
    const view = renderProvider();
    await waitFor(() => expect(mockUnreadCount).toHaveBeenCalled());
    const beforeReconnect = mockUnreadCount.mock.calls.length;

    mockUnreadCount.mockResolvedValue({
      data: { totalUnreadMessages: 9, totalUnreadConversations: 3 }
    });

    // A dropped connection can miss deliveries outright, so the badge is taken
    // from the server again on reconnect rather than left at whatever it was
    // when the connection died.
    socketConnected = true;
    view.rerender(
      <MessageProvider>
        <Probe />
      </MessageProvider>
    );

    await waitFor(() => expect(mockUnreadCount.mock.calls.length).toBeGreaterThan(beforeReconnect));
    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('9'));
  });

  it('drops all state and stops listening when the session ends', async () => {
    mockUnreadCount.mockResolvedValue({
      data: { totalUnreadMessages: 4, totalUnreadConversations: 1 }
    });
    const view = renderProvider();
    await waitFor(() => expect(screen.getByTestId('dot')).toHaveTextContent('on'));

    sessionStatus = 'unauthenticated';
    view.rerender(
      <MessageProvider>
        <Probe />
      </MessageProvider>
    );

    await waitFor(() => expect(screen.getByTestId('dot')).toHaveTextContent('off'));
    expect(screen.getByTestId('rows')).toHaveTextContent('');
  });
});
