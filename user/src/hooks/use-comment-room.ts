'use client';

import { useEffect } from 'react';
import { useSocket } from 'src/socket/socket-context';

/** Client -> server room controls. Mirrors COMMENT_ROOM in the API constants. */
const COMMENT_JOIN = 'comment/join';
const COMMENT_LEAVE = 'comment/leave';

/**
 * Subscribe to one comment thread's replies while it is expanded.
 *
 * The thread rooms exist so a reply body reaches only the people reading that
 * thread. Membership therefore has to follow the expand/collapse control
 * exactly, and tying it to this effect is what achieves that:
 *
 * - expanding a thread joins its room;
 * - collapsing it, switching threads, closing the post or unmounting leaves —
 *   the cleanup runs with the previous `commentId` still captured, so a reader
 *   who opens several threads in a session is not left subscribed to all of them;
 * - `enabled` false leaves too, which is how the collapsed state is expressed
 *   without unmounting the component that owns the subscription.
 *
 * `isConnected` is a dependency on purpose: room membership lives on the socket
 * connection, so a reconnect starts with none and the effect has to re-join
 * rather than assume it survived.
 */
export function useCommentRoom(commentId?: string | null, enabled = true) {
  const { socket, isConnected } = useSocket();

  useEffect(() => {
    if (!socket || !isConnected || !commentId || !enabled) return;

    socket.emit(COMMENT_JOIN, { commentId });

    return () => {
      socket.emit(COMMENT_LEAVE, { commentId });
    };
  }, [socket, isConnected, commentId, enabled]);
}
