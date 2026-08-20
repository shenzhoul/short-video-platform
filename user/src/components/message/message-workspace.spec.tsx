import { act, render, screen } from '@testing-library/react';
import React from 'react';

import MessageWorkspace from './message-workspace';
import {
  MessageWorkspaceProvider,
  useMessageWorkspace
} from '../../providers/message-workspace.provider';

/**
 * Layout contract of the panel itself: that it is a column beside the page
 * starting below the header, not an overlay covering the chrome.
 *
 * Asserted through the positioning classes rather than pixels — jsdom does no
 * layout, and the thing that actually broke was the anchor (`top-0` instead of
 * the header height), which is exactly what these classes express.
 */

jest.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { user: { _id: 'me' } } })
}));

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: jest.fn() })
}));

jest.mock('@providers/message.provider', () => ({
  useMessages: () => ({
    currentUserId: 'me',
    conversations: [],
    unread: { totalUnreadMessages: 0, totalUnreadConversations: 0 },
    hasUnread: false,
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    keyword: '',
    ensureLoaded: jest.fn(),
    loadMore: jest.fn(),
    retry: jest.fn(),
    setKeyword: jest.fn(),
    getConversation: () => undefined,
    openConversationWith: jest.fn(),
    markConversationRead: jest.fn(),
    markAllRead: jest.fn(),
    subscribeToMessages: () => () => undefined,
    rememberMessage: jest.fn()
  })
}));

function Opener() {
  const { openWorkspace, claimFullscreenPlacement, placement } = useMessageWorkspace();
  const [claimed, setClaimed] = React.useState<(() => void) | null>(null);

  return (
    <>
      <span data-testid="placement">{placement}</span>
      <button type="button" onClick={() => openWorkspace()}>open</button>
      <button
        type="button"
        onClick={() => {
          if (claimed) { claimed(); setClaimed(null); return; }
          setClaimed(() => claimFullscreenPlacement());
        }}
      >
        toggle-fullscreen
      </button>
    </>
  );
}

function renderWorkspace() {
  return render(
    <MessageWorkspaceProvider>
      <Opener />
      <MessageWorkspace />
    </MessageWorkspaceProvider>
  );
}

describe('MessageWorkspace layout contract', () => {
  it('renders nothing while closed', () => {
    renderWorkspace();
    expect(screen.queryByLabelText('Messages')).toBeNull();
  });

  it('starts below the application header rather than at the top of the viewport', () => {
    renderWorkspace();
    act(() => { screen.getByText('open').click(); });

    const panel = screen.getByLabelText('Messages');
    // The header spans the full width and stays visible; anchoring the panel to
    // the top of the viewport is what covered its actions.
    expect(panel.className).toContain('top-(--app-header-height)');
    expect(panel.className).not.toContain('top-0');
    expect(panel.className).toContain('bottom-0');
    expect(panel.className).toContain('right-0');
  });

  it('runs to the top of the viewport beside a fullscreen surface', () => {
    renderWorkspace();
    act(() => { screen.getByText('open').click(); });
    act(() => { screen.getByText('toggle-fullscreen').click(); });

    expect(screen.getByTestId('placement')).toHaveTextContent('fullscreen');
    const panel = screen.getByLabelText('Messages');
    // Post detail already covers the application header, so leaving a gap for it
    // would let the header show through in the strip beside the panel.
    expect(panel.className).toContain('top-0');
    expect(panel.className).not.toContain('top-(--app-header-height)');
  });

  it('returns to the below-header anchor when the fullscreen surface closes', () => {
    renderWorkspace();
    act(() => { screen.getByText('open').click(); });
    act(() => { screen.getByText('toggle-fullscreen').click(); });
    act(() => { screen.getByText('toggle-fullscreen').click(); });

    expect(screen.getByTestId('placement')).toHaveTextContent('shell');
    expect(screen.getByLabelText('Messages').className).toContain('top-(--app-header-height)');
  });

  it('is a single panel, mounted once', () => {
    renderWorkspace();
    act(() => { screen.getByText('open').click(); });

    expect(screen.getAllByLabelText('Messages')).toHaveLength(1);
  });
});
