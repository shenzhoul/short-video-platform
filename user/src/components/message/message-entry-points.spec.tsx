import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import MessageBell from './message-bell';
import PostDetailMessageButton from './post-detail-message-button';
import ProfileMessageButton from './profile-message-button';
import {
  MessageWorkspaceProvider,
  useMessageWorkspace
} from '../../providers/message-workspace.provider';

/**
 * The three entry points share one workspace, but they do not behave the same:
 *
 * - the header toggles the panel, and does nothing at all on the dedicated page;
 * - a profile knows *who* the user wants, so it opens that thread directly;
 * - post detail names no conversation, so it just toggles.
 *
 * These tests pin those responsibilities and the single-workspace guarantee.
 */

let sessionStatus = 'authenticated';
jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: sessionStatus, data: { user: { _id: 'me' } } })
}));

let pathname = '/';
const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: pushMock })
}));

const openConversationWith = jest.fn();
let hasUnread = false;
jest.mock('@providers/message.provider', () => ({
  useMessages: () => ({ hasUnread, openConversationWith })
}));

function WorkspaceProbe() {
  const { open, view, activeConversationId } = useMessageWorkspace();
  return (
    <span data-testid="state">
      {`${open ? 'open' : 'closed'}:${view}:${activeConversationId ?? '-'}`}
    </span>
  );
}

function renderShell(children: React.ReactNode) {
  return render(
    <MessageWorkspaceProvider>
      {children}
      <WorkspaceProbe />
    </MessageWorkspaceProvider>
  );
}

beforeEach(() => {
  sessionStatus = 'authenticated';
  pathname = '/';
  hasUnread = false;
  openConversationWith.mockReset();
  pushMock.mockReset();
});

describe('header message entry point', () => {
  it('opens the workspace from an ordinary page', () => {
    renderShell(<MessageBell isLoggedIn />);

    act(() => { screen.getByLabelText('Messages').click(); });

    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');
  });

  it('does nothing on the dedicated messages page', () => {
    pathname = '/messages';
    renderShell(<MessageBell isLoggedIn />);

    act(() => { screen.getByLabelText('Messages').click(); });

    // That page already is the full messages surface; opening the panel beside
    // it would show the same conversations twice.
    expect(screen.getByTestId('state')).toHaveTextContent('closed:list:-');
  });

  it('still shows the unread indicator on the messages page', () => {
    pathname = '/messages';
    hasUnread = true;
    renderShell(<MessageBell isLoggedIn />);

    // The indicator reflects global state, not the panel, so suppressing the
    // click must not suppress the dot.
    const dot = screen.getByLabelText('Messages').querySelector('span[aria-hidden="true"]');
    expect(dot).toBeTruthy();
  });

  it('treats a similarly named route as an ordinary page', () => {
    pathname = '/messages-archive';
    renderShell(<MessageBell isLoggedIn />);

    act(() => { screen.getByLabelText('Messages').click(); });

    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');
  });
});

describe('profile message entry point', () => {
  it('resolves the canonical conversation and opens straight into that thread', async () => {
    openConversationWith.mockResolvedValue({ _id: 'conv-42' });
    renderShell(<ProfileMessageButton creatorId="creator-9" />);

    await act(async () => { screen.getByLabelText('Message this creator').click(); });

    // The profile knows who the user wants, so it must not dump them on the
    // list — and it goes through the shared get-or-create rather than making
    // its own conversation.
    expect(openConversationWith).toHaveBeenCalledWith('creator-9');
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('open:thread:conv-42'));
  });

  it('leaves the workspace closed when the conversation cannot be opened', async () => {
    openConversationWith.mockResolvedValue(null);
    renderShell(<ProfileMessageButton creatorId="creator-9" />);

    await act(async () => { screen.getByLabelText('Message this creator').click(); });

    // Opening an empty list would tell the user nothing about what went wrong.
    expect(screen.getByTestId('state')).toHaveTextContent('closed:list:-');
  });

  it('sends a signed-out visitor to sign in instead of opening anything', async () => {
    sessionStatus = 'unauthenticated';
    renderShell(<ProfileMessageButton creatorId="creator-9" />);

    await act(async () => { screen.getByLabelText('Message this creator').click(); });

    expect(pushMock).toHaveBeenCalledWith('/auth/login');
    expect(openConversationWith).not.toHaveBeenCalled();
    expect(screen.getByTestId('state')).toHaveTextContent('closed:list:-');
  });
});

describe('post detail message entry point', () => {
  it('is rendered while the workspace is closed', () => {
    renderShell(<PostDetailMessageButton />);
    expect(screen.getByLabelText('Open messages')).toBeInTheDocument();
  });

  it('opens the workspace and stays rendered while it is open', () => {
    renderShell(<PostDetailMessageButton />);

    act(() => { screen.getByLabelText('Open messages').click(); });

    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');
    // The button must not disappear once messages are open — it is the same
    // control the user reaches for to put them away again.
    expect(screen.getByLabelText('Open messages')).toBeInTheDocument();
  });

  it('toggles the workspace shut on a second click, and back open on a third', () => {
    renderShell(<PostDetailMessageButton />);
    const button = screen.getByLabelText('Open messages');

    act(() => { button.click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');

    act(() => { button.click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('closed:list:-');

    act(() => { button.click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');
  });

  it('is hidden from signed-out visitors', () => {
    sessionStatus = 'unauthenticated';
    renderShell(<PostDetailMessageButton />);
    expect(screen.queryByLabelText('Open messages')).toBeNull();
  });
});

describe('single shared workspace', () => {
  it('drives one workspace from all three entry points', async () => {
    openConversationWith.mockResolvedValue({ _id: 'conv-7' });
    renderShell(
      <>
        <MessageBell isLoggedIn />
        <ProfileMessageButton creatorId="creator-1" />
        <PostDetailMessageButton />
      </>
    );

    // Only ever one panel's worth of state, no matter which control is used.
    act(() => { screen.getByLabelText('Open messages').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');

    await act(async () => { screen.getByLabelText('Message this creator').click(); });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('open:thread:conv-7'));

    act(() => { screen.getByLabelText('Messages').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('closed:list:-');
    expect(screen.getAllByTestId('state')).toHaveLength(1);
  });
});
