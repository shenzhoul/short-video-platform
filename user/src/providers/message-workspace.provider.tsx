'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState
} from 'react';

/** Which view the compact workspace is showing. */
export type MessageWorkspaceView = 'list' | 'thread';

/**
 * Which surface the workspace is sitting beside.
 *
 * `shell` is the ordinary page: the application header stays visible above, so
 * the panel starts below it. `fullscreen` is a surface that already covers the
 * header — post detail — where the panel belongs to that surface and must run
 * from the very top, or the header shows through in the strip beside it.
 *
 * A declared mode rather than something inferred from the DOM: the surface
 * knows what it is, and guessing from element positions would break the moment
 * either one moved.
 */
export type MessageWorkspacePlacement = 'shell' | 'fullscreen';

/**
 * Desktop width of the right-side workspace.
 *
 * A fixed column rather than a percentage: a conversation row has a fixed
 * amount to say — avatar, name, one line of preview, a timestamp — and letting
 * that stretch on a wide monitor makes the panel look empty rather than
 * generous. The main content absorbs the remaining width instead.
 */
export const MESSAGE_WORKSPACE_WIDTH = 356;

/**
 * Viewport below which the workspace stops taking layout width and floats over
 * the content instead.
 *
 * Matches Tailwind's `xl`, which is where this app's shell stops reserving a
 * column for the left navigation. Below it there is simply not enough width to
 * subtract 360px and leave a usable feed, so the panel overlays rather than
 * squeezing the page into something broken.
 */
export const MESSAGE_WORKSPACE_INLINE_MIN_WIDTH = 1280;

/**
 * Canonical route of the dedicated messages page.
 *
 * Exported from here so the entry points and the page agree on one value rather
 * than repeating a literal, and so `isMessagesRoute` is the single place that
 * decides what counts as "already on the messages surface".
 */
export const MESSAGES_ROUTE = '/messages';

/**
 * Whether a pathname is the dedicated messages page.
 *
 * Matches the route itself and anything nested under it, but not a route that
 * merely starts with the same characters — `/messages-archive` is a different
 * page and must not suppress the workspace.
 */
export function isMessagesRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === MESSAGES_ROUTE || pathname.startsWith(`${MESSAGES_ROUTE}/`);
}

interface MessageWorkspaceContextValue {
  open: boolean;
  view: MessageWorkspaceView;
  activeConversationId: string | null;
  /** True while the panel takes layout width rather than overlaying content. */
  inline: boolean;
  openWorkspace: (conversationId?: string) => void;
  closeWorkspace: () => void;
  toggleWorkspace: () => void;
  openConversation: (conversationId: string) => void;
  backToList: () => void;
  /** Where the panel is currently anchored. */
  placement: MessageWorkspacePlacement;
  /**
   * Claim fullscreen placement while a covering surface is mounted.
   *
   * Returns a release function; the surface calls it on unmount. Claims are
   * counted, so nested or overlapping surfaces cannot leave the panel stuck in
   * the wrong mode.
   */
  claimFullscreenPlacement: () => () => void;
}

const MessageWorkspaceContext = createContext<MessageWorkspaceContextValue | null>(null);

/**
 * Owns whether the right-side message workspace is open, and publishes its width
 * to the layout.
 *
 * Mounted once at the application shell, which is what makes the header entry
 * point and the post-detail entry point the *same* workspace rather than two
 * copies. Any surface that wants to open messages calls into here; nothing
 * mounts its own panel.
 *
 * The width is published as a CSS custom property on the document element
 * instead of being threaded through props. Two things need it — the shell's
 * content column and the post-detail overlay — and they are far apart in the
 * tree, so a variable avoids prop-drilling the layout through every page. It
 * also means the reflow is a pure CSS transition rather than a React re-render
 * of the whole page.
 */
export function MessageWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MessageWorkspaceView>('list');
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [inline, setInline] = useState(true);
  // How many covering surfaces are currently mounted. Counted rather than a
  // boolean so two of them cannot fight over the flag on unmount.
  const [fullscreenClaims, setFullscreenClaims] = useState(0);

  // Whether there is room to give the panel its own column. Watched rather than
  // read once, so dragging a window narrow switches it to an overlay instead of
  // crushing the content.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const query = window.matchMedia(`(min-width: ${MESSAGE_WORKSPACE_INLINE_MIN_WIDTH}px)`);
    const apply = () => setInline(query.matches);
    apply();

    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  /**
   * Publish the width the rest of the layout should subtract.
   *
   * Zero when closed, and zero when overlaying — an overlay deliberately takes
   * no layout width, so the content behind it keeps its own.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const root = document.documentElement;
    const width = open && inline ? `${MESSAGE_WORKSPACE_WIDTH}px` : '0px';
    root.style.setProperty('--message-workspace-width', width);
    root.dataset.messageOpen = open ? 'true' : 'false';

    return () => {
      root.style.setProperty('--message-workspace-width', '0px');
      delete root.dataset.messageOpen;
    };
  }, [inline, open]);

  const openWorkspace = useCallback((conversationId?: string) => {
    setOpen(true);
    if (conversationId) {
      setActiveConversationId(conversationId);
      setView('thread');
    }
  }, []);

  /**
   * Close the workspace and return it to the conversation list.
   *
   * The view is transient state belonging to a visible panel, so it does not
   * outlive one. Reopening from the header means "show me my messages", not
   * "resume that one conversation" — the icon has no way to express which
   * thread, and the list is the workspace's stated initial view. Entry points
   * that *do* mean a specific thread pass its id to `openWorkspace`.
   */
  const closeWorkspace = useCallback(() => {
    setOpen(false);
    setView('list');
    setActiveConversationId(null);
  }, []);

  const toggleWorkspace = useCallback(() => {
    // Routed through the same close, so the header icon resets the view whether
    // it is used to close the panel or the close button is.
    setOpen((current) => {
      if (current) {
        setView('list');
        setActiveConversationId(null);
      }
      return !current;
    });
  }, []);

  const openConversation = useCallback((conversationId: string) => {
    setActiveConversationId(conversationId);
    setView('thread');
    setOpen(true);
  }, []);

  const backToList = useCallback(() => {
    setView('list');
    setActiveConversationId(null);
  }, []);

  const claimFullscreenPlacement = useCallback(() => {
    setFullscreenClaims((count) => count + 1);
    return () => setFullscreenClaims((count) => Math.max(0, count - 1));
  }, []);

  const placement: MessageWorkspacePlacement = fullscreenClaims > 0 ? 'fullscreen' : 'shell';

  const value = useMemo<MessageWorkspaceContextValue>(() => ({
    open,
    view,
    activeConversationId,
    inline,
    placement,
    openWorkspace,
    closeWorkspace,
    toggleWorkspace,
    openConversation,
    backToList,
    claimFullscreenPlacement
  }), [
    open, view, activeConversationId, inline, placement,
    openWorkspace, closeWorkspace, toggleWorkspace, openConversation, backToList,
    claimFullscreenPlacement
  ]);

  return (
    <MessageWorkspaceContext.Provider value={value}>
      {children}
    </MessageWorkspaceContext.Provider>
  );
}

export function useMessageWorkspace() {
  const context = useContext(MessageWorkspaceContext);
  if (!context) {
    throw new Error('useMessageWorkspace must be used within a MessageWorkspaceProvider');
  }
  return context;
}
