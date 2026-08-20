import type { IConversation, IMessage } from '@interfaces/message';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { useMessageThread } from './use-message-thread';

const mockSearchMessages = jest.fn();
const mockSendMessage = jest.fn();
const mockUploadPhoto = jest.fn();
const mockUploadVideo = jest.fn();

jest.mock('@services/message.service', () => ({
  searchMessages: (...args: any[]) => mockSearchMessages(...args),
  sendMessage: (...args: any[]) => mockSendMessage(...args),
  uploadMessagePhoto: (...args: any[]) => mockUploadPhoto(...args),
  uploadMessageVideo: (...args: any[]) => mockUploadVideo(...args)
}));

/**
 * The provider is replaced here rather than mounted, so these tests are about
 * the thread's own behaviour — pagination, optimistic sending, echo suppression
 * and permission reporting — and not about socket plumbing that
 * `message.provider.spec.tsx` already covers.
 */
let conversation: IConversation | undefined;
let messageHandlers: Array<(message: IMessage) => void> = [];
const mockMarkRead = jest.fn();
const mockRemember = jest.fn();

/**
 * The mocked context object is built once and reused.
 *
 * The real provider hands out `useCallback`-stable functions, and the thread
 * relies on that: its reset effect depends on `markConversationRead`, so a mock
 * that minted a fresh closure per render would re-run the effect forever. Fixing
 * the identities here keeps the harness faithful to the real contract instead of
 * papering over a dependency the hook genuinely has.
 */
const messageContextStub = {
  currentUserId: 'me',
  getConversation: () => conversation,
  markConversationRead: (...args: any[]) => mockMarkRead(...args),
  subscribeToMessages: (handler: (message: IMessage) => void) => {
    messageHandlers.push(handler);
    return () => { messageHandlers = messageHandlers.filter((item) => item !== handler); };
  },
  rememberMessage: (...args: any[]) => mockRemember(...args)
};

jest.mock('@providers/message.provider', () => ({
  useMessages: () => messageContextStub
}));

function serverMessage(overrides: Partial<IMessage> = {}): IMessage {
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

let latest: ReturnType<typeof useMessageThread>;

function Probe({ conversationId }: { conversationId: string | null }) {
  const thread = useMessageThread(conversationId);
  latest = thread;

  return (
    <div>
      <span data-testid="messages">{thread.messages.map((item) => item._id).join(',')}</span>
      <span data-testid="pending">{thread.pending.map((item) => `${item.status}`).join(',')}</span>
      <span data-testid="permission">{`${thread.canSend ? 'can' : 'blocked'}:${thread.awaitingReplyFrom ?? '-'}`}</span>
    </div>
  );
}

beforeEach(() => {
  conversation = {
    _id: 'c1', canSend: true, awaitingReplyFrom: null, isMutualFollow: false
  } as IConversation;
  messageHandlers = [];
  latest = undefined as any;
  mockSearchMessages.mockResolvedValue({
    data: { data: [], hasMore: false, nextCursor: null }
  });
  mockMarkRead.mockResolvedValue(undefined);
});

describe('useMessageThread', () => {
  it('marks the conversation read when the thread opens', async () => {
    render(<Probe conversationId="c1" />);

    // Opening a *thread* is what marks it read. Opening the workspace is not,
    // which is why this lives here and not in the workspace provider.
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledWith('c1'));
  });

  it('does not fetch or mark anything with no conversation selected', async () => {
    render(<Probe conversationId={null} />);

    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent(''));
    expect(mockSearchMessages).not.toHaveBeenCalled();
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('renders history oldest first regardless of the order the server returns', async () => {
    mockSearchMessages.mockResolvedValue({
      data: {
        data: [
          serverMessage({ _id: 'newer', createdAt: '2026-08-14T12:00:00.000Z' }),
          serverMessage({ _id: 'older', createdAt: '2026-08-14T08:00:00.000Z' })
        ],
        hasMore: false,
        nextCursor: null
      }
    });

    render(<Probe conversationId="c1" />);

    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('older,newer'));
  });

  it('shows a message once when the socket echoes what was just sent', async () => {
    mockSendMessage.mockResolvedValue({
      data: { message: serverMessage({ _id: 'sent', senderId: 'me' }), canSend: false, awaitingReplyFrom: 'me' }
    });

    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled());

    await act(async () => { await latest.send({ text: 'hi' }); });
    expect(screen.getByTestId('messages')).toHaveTextContent('sent');

    // The delivery listener emits to the sender too, so their other tabs stay
    // in sync. The surface that made the request receives its own echo and must
    // not draw a second bubble.
    act(() => { messageHandlers.forEach((handler) => handler(serverMessage({ _id: 'sent', senderId: 'me' }))); });
    expect(screen.getByTestId('messages').textContent).toBe('sent');
  });

  it('reports the sender as waiting after a restricted send', async () => {
    mockSendMessage.mockResolvedValue({
      data: { message: serverMessage({ _id: 'sent', senderId: 'me' }), canSend: false, awaitingReplyFrom: 'me' }
    });

    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(screen.getByTestId('permission')).toHaveTextContent('can:-'));

    await act(async () => { await latest.send({ text: 'hi' }); });

    // Taken from the send response, which is fresher than the conversation row
    // until that row's own socket update lands.
    expect(screen.getByTestId('permission')).toHaveTextContent('blocked:me');
  });

  it('keeps a refused send visible as a failed bubble instead of dropping it', async () => {
    const refusal: any = new Error('You can send one message until they reply.');
    refusal.statusCode = 403;
    mockSendMessage.mockRejectedValue(refusal);

    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled());

    await act(async () => { await latest.send({ text: 'again' }); });

    // Silently discarding what somebody typed is worse than showing them it did
    // not send.
    expect(screen.getByTestId('pending')).toHaveTextContent('failed');
    expect(latest.pending[0].error).toContain('one message');
  });

  it('applies an incoming message and marks it read while the thread is open', async () => {
    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledTimes(1));

    act(() => { messageHandlers.forEach((handler) => handler(serverMessage({ _id: 'incoming' }))); });

    expect(screen.getByTestId('messages')).toHaveTextContent('incoming');
    // Arriving in the thread the user is reading means it is already read.
    await waitFor(() => expect(mockMarkRead).toHaveBeenCalledTimes(2));
  });

  it('ignores a message belonging to a different conversation', async () => {
    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled());

    act(() => {
      messageHandlers.forEach((handler) => handler(
        serverMessage({ _id: 'elsewhere', conversationId: 'c2' })
      ));
    });

    expect(screen.getByTestId('messages')).toHaveTextContent('');
  });

  it('does not send an empty message', async () => {
    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled());

    await act(async () => { await latest.send({ text: '   ' }); });

    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('uploads media before creating the message', async () => {
    const order: string[] = [];
    mockUploadPhoto.mockImplementation(async () => { order.push('upload'); return { fileId: 'f1' }; });
    mockSendMessage.mockImplementation(async () => {
      order.push('send');
      return { data: { message: serverMessage({ _id: 'media', senderId: 'me' }), canSend: true, awaitingReplyFrom: null } };
    });

    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled());

    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await act(async () => { await latest.send({ text: '', file }); });

    // A message row pointing at an upload that never finished would render as a
    // permanently broken bubble, so the file has to have an id first.
    expect(order).toEqual(['upload', 'send']);
    expect(mockSendMessage).toHaveBeenCalledWith('c1', { text: '', fileIds: ['f1'] });
  });

  it('never creates a message when the upload fails', async () => {
    mockUploadPhoto.mockRejectedValue(new Error('Photo upload failed'));

    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled());

    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await act(async () => { await latest.send({ text: '', file }); });

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending')).toHaveTextContent('failed');
  });

  it('retries a failed text send', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('network'));
    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled());

    await act(async () => { await latest.send({ text: 'retry me' }); });
    expect(latest.pending).toHaveLength(1);

    mockSendMessage.mockResolvedValueOnce({
      data: { message: serverMessage({ _id: 'retried', senderId: 'me' }), canSend: true, awaitingReplyFrom: null }
    });
    await act(async () => { await latest.retryPending(latest.pending[0].localId); });

    expect(screen.getByTestId('messages')).toHaveTextContent('retried');
    expect(latest.pending).toHaveLength(0);
  });

  it('refuses to retry a failed media send', async () => {
    mockUploadPhoto.mockResolvedValue({ fileId: 'f1' });
    mockSendMessage.mockRejectedValueOnce(new Error('network'));
    render(<Probe conversationId="c1" />);
    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled());

    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await act(async () => { await latest.send({ text: '', file }); });
    expect(latest.pending).toHaveLength(1);

    // The browser File is gone once the composer cleared it, so a retry could
    // only re-send an empty caption. It refuses rather than silently sending
    // the wrong thing, and the bubble stays for the person to dismiss.
    let retried: boolean | undefined;
    await act(async () => { retried = await latest.retryPending(latest.pending[0].localId); });
    expect(retried).toBe(false);
    expect(latest.pending).toHaveLength(1);
  });

  it('clears the previous thread when the conversation changes', async () => {
    mockSearchMessages.mockResolvedValue({
      data: { data: [serverMessage({ _id: 'from-c1' })], hasMore: false, nextCursor: null }
    });

    const view = render(<Probe conversationId="c1" />);
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('from-c1'));

    mockSearchMessages.mockResolvedValue({
      data: { data: [serverMessage({ _id: 'from-c2', conversationId: 'c2' })], hasMore: false, nextCursor: null }
    });
    view.rerender(<Probe conversationId="c2" />);

    // Without the reset the reader would briefly see the previous
    // conversation's messages under the new person's name.
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('from-c2'));
    expect(screen.getByTestId('messages').textContent).not.toContain('from-c1');
  });
});
