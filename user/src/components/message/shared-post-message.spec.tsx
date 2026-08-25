import type { IConversation, IMessage, ISharedPost } from '@interfaces/message';
import { MESSAGE_TYPE } from '@interfaces/message';
import { act, render, screen } from '@testing-library/react';
import React from 'react';

import ConversationRow from './conversation-row';
import MessageBubble from './message-bubble';
import MessageSystemNotice from './message-system-notice';
import SharedPostCard from './shared-post-card';

/**
 * A shared post is a message that renders somebody else's content, which is
 * what makes it worth testing on its own: the card has to survive that content
 * being withdrawn, and it must never keep a copy of what it used to show.
 */

const baseSharedPost: ISharedPost = {
  postId: 'post-1',
  available: true,
  type: 'video',
  thumbnailUrl: 'https://cdn.test/cover.jpg',
  caption: 'A day in Sanya',
  isVideo: true,
  isMultiImage: false,
  author: { _id: 'author-1', name: 'Jiang Shiyi', avatar: '/a.png' }
};

function buildMessage(sharedPost: ISharedPost | null, senderId = 'them'): IMessage {
  return {
    _id: 'm1',
    conversationId: 'c1',
    type: MESSAGE_TYPE.POST,
    text: '',
    senderId,
    postId: sharedPost?.postId || 'post-1',
    sharedPost,
    createdAt: new Date().toISOString()
  };
}

describe('shared post card', () => {
  it('renders a video post with a play affordance', () => {
    render(<SharedPostCard sharedPost={baseSharedPost} onOpen={jest.fn()} />);

    expect(screen.getByLabelText(/Open post: A day in Sanya/)).toBeInTheDocument();
    expect(screen.getByText('Jiang Shiyi')).toBeInTheDocument();
  });

  it('marks a multi-image post', () => {
    render(
      <SharedPostCard
        sharedPost={{ ...baseSharedPost, isVideo: false, isMultiImage: true, type: 'photo' }}
        onOpen={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Multiple photos')).toBeInTheDocument();
  });

  it('opens the post through the shared handler', () => {
    const onOpen = jest.fn();
    render(<SharedPostCard sharedPost={baseSharedPost} onOpen={onOpen} />);

    act(() => { screen.getByLabelText(/Open post/).click(); });

    expect(onOpen).toHaveBeenCalledWith('post-1');
  });

  it('falls back safely when the post is gone', () => {
    render(
      <SharedPostCard
        sharedPost={{ postId: 'post-1', available: false, unavailableReason: 'deleted' }}
        onOpen={jest.fn()}
      />
    );

    expect(screen.getByTestId('shared-post-unavailable')).toBeInTheDocument();
    expect(screen.getByText('Post unavailable')).toBeInTheDocument();
  });

  it('shows nothing of a withdrawn post, not even its caption', () => {
    // The server sends no caption or cover for an unavailable card. This asserts
    // the component has no fallback that would put them back.
    render(
      <SharedPostCard
        sharedPost={{ postId: 'post-1', available: false, unavailableReason: 'not_accessible' }}
        onOpen={jest.fn()}
      />
    );

    expect(screen.queryByText('A day in Sanya')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is not clickable while the bubble is still pending', () => {
    render(<SharedPostCard sharedPost={baseSharedPost} />);

    expect(screen.getByLabelText(/Open post/)).toBeDisabled();
  });
});

describe('shared post bubble', () => {
  it('renders an incoming shared post with the sender avatar', () => {
    const { container } = render(
      <MessageBubble message={buildMessage(baseSharedPost)} outgoing={false} avatar="/them.png" />
    );

    expect(screen.getByLabelText(/Open post/)).toBeInTheDocument();
    expect(container.querySelector('img[src="/them.png"]')).toBeInTheDocument();
  });

  it('renders an outgoing shared post without one', () => {
    const { container } = render(
      <MessageBubble message={buildMessage(baseSharedPost, 'me')} outgoing avatar="/me.png" />
    );

    expect(screen.getByLabelText(/Open post/)).toBeInTheDocument();
    expect(container.querySelector('img[src="/me.png"]')).not.toBeInTheDocument();
  });

  it('keeps the message when the post it points at is gone', () => {
    render(
      <MessageBubble
        message={buildMessage({ postId: 'post-1', available: false, unavailableReason: 'deleted' })}
        outgoing={false}
      />
    );

    // The message is real history; only the content it referenced went away.
    expect(screen.getByTestId('shared-post-unavailable')).toBeInTheDocument();
  });
});

describe('mutual follow system notice', () => {
  const notice = (overrides: Partial<IMessage> = {}): IMessage => ({
    _id: 'sys1',
    conversationId: 'c1',
    type: MESSAGE_TYPE.SYSTEM,
    // Wording arrives resolved from the server, already translated.
    text: 'You follow each other. You can now start chatting.',
    senderId: '',
    systemEvent: 'mutual_follow',
    createdAt: new Date().toISOString(),
    ...overrides
  });

  it('renders the notice the server worded', () => {
    render(<MessageSystemNotice message={notice()} avatar="/them.png" />);

    expect(screen.getByText(/You follow each other/i)).toBeInTheDocument();
  });

  it('shows the other person beside it', () => {
    const { container } = render(<MessageSystemNotice message={notice()} avatar="/them.png" />);

    expect(container.querySelector('img[src="/them.png"]')).toBeInTheDocument();
  });

  it('never renders an event name', () => {
    // A notice with no wording is skipped rather than falling back to the enum.
    const { container } = render(
      <MessageSystemNotice message={notice({ text: '', systemEvent: 'something_new' })} />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/something_new/)).not.toBeInTheDocument();
  });

  it('carries none of a message bubble', () => {
    render(<MessageSystemNotice message={notice()} avatar="/them.png" />);

    // No reply, share or reaction affordances, and no send-side styling.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-system-notice')).toBeInTheDocument();
  });
});

describe('conversation preview', () => {
  const conversation = (overrides: Partial<IConversation>): IConversation => ({
    _id: 'c1',
    recipientIds: ['me', 'them'],
    participant: { _id: 'them', name: 'Bo' },
    lastMessage: '',
    lastMessageType: null,
    lastSenderId: 'them',
    lastMessageCreatedAt: new Date().toISOString(),
    unreadCount: 0,
    isMutualFollow: true,
    canSend: true,
    awaitingReplyFrom: null,
    requestState: 'mutual',
    restrictionReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  });

  it('labels a shared post rather than showing nothing', () => {
    render(
      <ConversationRow
        conversation={conversation({ lastMessageType: MESSAGE_TYPE.POST })}
        onSelect={jest.fn()}
      />
    );

    expect(screen.getByText('[Post]')).toBeInTheDocument();
  });

  it('labels a system notice in words, not as an enum', () => {
    render(
      <ConversationRow
        conversation={conversation({ lastMessageType: MESSAGE_TYPE.SYSTEM, lastMessage: '' })}
        onSelect={jest.fn()}
      />
    );

    expect(screen.getByText('You can now message each other')).toBeInTheDocument();
    expect(screen.queryByText(/mutual_follow|system/i)).not.toBeInTheDocument();
  });

  it('does not put the shared post caption in the list', () => {
    // The caption belongs to somebody else's post and can be withdrawn; the row
    // must not become the one place it survives.
    render(
      <ConversationRow
        conversation={conversation({
          lastMessageType: MESSAGE_TYPE.POST,
          lastMessage: 'A day in Sanya'
        })}
        onSelect={jest.fn()}
      />
    );

    expect(screen.getByText('[Post]')).toBeInTheDocument();
    expect(screen.queryByText('A day in Sanya')).not.toBeInTheDocument();
  });
});
