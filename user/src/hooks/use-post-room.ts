'use client';

import { useEffect } from 'react';
import { useSocket } from 'src/socket/socket-context';

/** Client -> server room controls. Mirrors POST_ROOM in the API constants. */
const POST_JOIN = 'post/join';
const POST_LEAVE = 'post/leave';

/**
 * Subscribe to one post's live detail events while it is open.
 *
 * Membership is deliberately tied to this effect rather than to the socket's
 * lifetime, so it follows the modal exactly:
 *
 * - opening a post joins its room;
 * - switching P1 -> P2 leaves P1 before joining P2, because the effect cleans up
 *   with the previous `postId` still captured — without that, a viewer would
 *   keep receiving events for every post they had opened this session;
 * - closing the modal, or unmounting, leaves the room.
 *
 * `isConnected` is a dependency on purpose. Room membership lives on the socket
 * connection, so a reconnect starts with none: re-running on reconnect is what
 * restores the subscription instead of assuming it survived.
 */
export function usePostRoom(postId?: string | null) {
  const { socket, isConnected } = useSocket();

  useEffect(() => {
    if (!socket || !isConnected || !postId) return;

    socket.emit(POST_JOIN, { postId });

    return () => {
      // Captured `postId`, so a switch leaves the post being left rather than
      // the one just opened.
      socket.emit(POST_LEAVE, { postId });
    };
  }, [socket, isConnected, postId]);
}
