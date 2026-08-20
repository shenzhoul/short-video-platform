import { act, render, screen } from '@testing-library/react';
import React from 'react';

import {
  MESSAGE_WORKSPACE_WIDTH,
  MessageWorkspaceProvider,
  useMessageWorkspace
} from './message-workspace.provider';

/**
 * Tests the layout *contract*, not pixels: whether the workspace is open, which
 * view it shows, and what width it publishes for the rest of the shell to
 * subtract. Everything that reflows — the content column, the header, the
 * post-detail overlay — reads that one variable, so it is the thing worth
 * asserting.
 */

let matchMediaMatches = true;
const mediaListeners = new Set<() => void>();

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    get matches() { return matchMediaMatches; },
    media: query,
    onchange: null,
    addEventListener: (_: string, handler: () => void) => { mediaListeners.add(handler); },
    removeEventListener: (_: string, handler: () => void) => { mediaListeners.delete(handler); },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  matchMediaMatches = true;
  mediaListeners.clear();
  document.documentElement.style.removeProperty('--message-workspace-width');
  delete document.documentElement.dataset.messageOpen;
});

function readWidth() {
  return document.documentElement.style.getPropertyValue('--message-workspace-width');
}

/** Two independent consumers, standing in for the header and post detail. */
function HeaderEntry() {
  const { toggleWorkspace, open } = useMessageWorkspace();
  return (
    <button type="button" onClick={toggleWorkspace} data-testid="header">
      {open ? 'open' : 'closed'}
    </button>
  );
}

function PostDetailEntry() {
  const { openWorkspace } = useMessageWorkspace();
  return <button type="button" onClick={() => openWorkspace()} data-testid="post-detail">msg</button>;
}

function WorkspaceProbe() {
  const {
    open, view, activeConversationId, inline, openConversation, backToList, closeWorkspace
  } = useMessageWorkspace();

  return (
    <div>
      <span data-testid="state">{`${open ? 'open' : 'closed'}:${view}:${activeConversationId ?? '-'}`}</span>
      <span data-testid="inline">{inline ? 'inline' : 'overlay'}</span>
      <button type="button" onClick={() => openConversation('c1')}>open-c1</button>
      <button type="button" onClick={backToList}>back</button>
      <button type="button" onClick={closeWorkspace}>close</button>
    </div>
  );
}

function renderShell() {
  return render(
    <MessageWorkspaceProvider>
      <HeaderEntry />
      <PostDetailEntry />
      <WorkspaceProbe />
    </MessageWorkspaceProvider>
  );
}

describe('MessageWorkspaceProvider', () => {
  it('publishes no width while closed, so the page keeps its full column', () => {
    renderShell();

    expect(screen.getByTestId('state')).toHaveTextContent('closed:list:-');
    expect(readWidth()).toBe('0px');
    expect(document.documentElement.dataset.messageOpen).toBe('false');
  });

  it('takes layout width when opened from the header', () => {
    renderShell();

    act(() => { screen.getByTestId('header').click(); });

    // This is the whole reflow mechanism: the shell content column and the
    // post-detail overlay both subtract this value, so a non-zero width here
    // means the page genuinely narrows rather than being covered.
    expect(readWidth()).toBe(`${MESSAGE_WORKSPACE_WIDTH}px`);
    expect(document.documentElement.dataset.messageOpen).toBe('true');
  });

  it('restores the page layout when closed', () => {
    renderShell();

    act(() => { screen.getByTestId('header').click(); });
    expect(readWidth()).toBe(`${MESSAGE_WORKSPACE_WIDTH}px`);

    act(() => { screen.getByText('close').click(); });
    expect(readWidth()).toBe('0px');
    expect(document.documentElement.dataset.messageOpen).toBe('false');
  });

  it('shares one workspace between the header and post detail', () => {
    renderShell();

    act(() => { screen.getByTestId('post-detail').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');
    // The header reads the same state, which is only possible because there is
    // one workspace rather than one per entry point.
    expect(screen.getByTestId('header')).toHaveTextContent('open');

    // Opening again from the other entry point must not toggle it shut — the
    // user asked for messages, not for them to disappear.
    act(() => { screen.getByTestId('post-detail').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');
    expect(readWidth()).toBe(`${MESSAGE_WORKSPACE_WIDTH}px`);
  });

  it('moves between the list and a thread', () => {
    renderShell();
    act(() => { screen.getByTestId('header').click(); });

    act(() => { screen.getByText('open-c1').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:thread:c1');

    act(() => { screen.getByText('back').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');
    // Going back to the list must not close the workspace.
    expect(readWidth()).toBe(`${MESSAGE_WORKSPACE_WIDTH}px`);
  });

  it('reopens on the conversation list rather than the last thread', () => {
    renderShell();

    act(() => { screen.getByTestId('header').click(); });
    act(() => { screen.getByText('open-c1').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:thread:c1');

    act(() => { screen.getByText('close').click(); });
    act(() => { screen.getByTestId('header').click(); });

    // The header icon means "show me my messages", not "resume that one
    // conversation", and the list is the workspace's initial view.
    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');
  });

  it('resets the view when the header icon is used to close it', () => {
    renderShell();

    act(() => { screen.getByTestId('header').click(); });
    act(() => { screen.getByText('open-c1').click(); });
    // Toggling shut must reset exactly as the close button does.
    act(() => { screen.getByTestId('header').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('closed:list:-');

    act(() => { screen.getByTestId('header').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:list:-');
  });

  it('opens straight into a thread when given a conversation', () => {
    function DeepLink() {
      const { openWorkspace } = useMessageWorkspace();
      return <button type="button" onClick={() => openWorkspace('c9')}>deep</button>;
    }

    render(
      <MessageWorkspaceProvider>
        <DeepLink />
        <WorkspaceProbe />
      </MessageWorkspaceProvider>
    );

    act(() => { screen.getByText('deep').click(); });
    expect(screen.getByTestId('state')).toHaveTextContent('open:thread:c9');
  });

  it('overlays instead of taking width when the viewport is too narrow', () => {
    matchMediaMatches = false;
    renderShell();

    act(() => { screen.getByTestId('header').click(); });

    expect(screen.getByTestId('inline')).toHaveTextContent('overlay');
    // An overlay deliberately publishes no width: there is nothing left to take
    // at this size, and subtracting anyway would leave a broken content column.
    expect(readWidth()).toBe('0px');
    expect(document.documentElement.dataset.messageOpen).toBe('true');
  });

  it('switches to an overlay when the window is dragged narrow while open', () => {
    renderShell();
    act(() => { screen.getByTestId('header').click(); });
    expect(readWidth()).toBe(`${MESSAGE_WORKSPACE_WIDTH}px`);

    act(() => {
      matchMediaMatches = false;
      mediaListeners.forEach((listener) => listener());
    });

    expect(screen.getByTestId('inline')).toHaveTextContent('overlay');
    expect(readWidth()).toBe('0px');
  });

  it('releases the layout variable when the shell unmounts', () => {
    const view = renderShell();
    act(() => { screen.getByTestId('header').click(); });

    view.unmount();

    expect(readWidth()).toBe('0px');
    expect(document.documentElement.dataset.messageOpen).toBeUndefined();
  });
});
