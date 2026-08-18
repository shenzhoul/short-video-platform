import { render } from '@testing-library/react';
import React from 'react';

import { usePostRoom } from './use-post-room';

/**
 * Room membership must follow the open modal exactly — including across a
 * reconnect, which starts with no membership at all.
 */

const emit = jest.fn();
let socket: any = { emit };
let isConnected = true;

jest.mock('src/socket/socket-context', () => ({
  useSocket: () => ({ socket, isConnected })
}));

function Probe({ postId }: { postId?: string | null }) {
  usePostRoom(postId);
  return null;
}

/** Room controls only, in call order. */
function roomCalls() {
  return emit.mock.calls
    .filter(([event]) => event === 'post/join' || event === 'post/leave')
    .map(([event, payload]) => `${event}:${payload.postId}`);
}

beforeEach(() => {
  emit.mockClear();
  socket = { emit };
  isConnected = true;
});

describe('post room lifecycle', () => {
  it('joins the room when a post opens', () => {
    render(<Probe postId="p1" />);
    expect(roomCalls()).toEqual(['post/join:p1']);
  });

  it('leaves the room when the modal closes', () => {
    const { unmount } = render(<Probe postId="p1" />);
    unmount();
    expect(roomCalls()).toEqual(['post/join:p1', 'post/leave:p1']);
  });

  it('leaves the previous post before joining the next on a switch', () => {
    const { rerender } = render(<Probe postId="p1" />);
    rerender(<Probe postId="p2" />);

    // Without the captured id the cleanup would leave p2 and keep p1
    // subscribed for the rest of the session.
    expect(roomCalls()).toEqual(['post/join:p1', 'post/leave:p1', 'post/join:p2']);
  });

  it('leaves no stale subscription across several switches', () => {
    const { rerender } = render(<Probe postId="p1" />);
    rerender(<Probe postId="p2" />);
    rerender(<Probe postId="p3" />);

    const joined = roomCalls().filter((c) => c.startsWith('post/join')).map((c) => c.split(':')[1]);
    const left = roomCalls().filter((c) => c.startsWith('post/leave')).map((c) => c.split(':')[1]);
    expect(joined).toEqual(['p1', 'p2', 'p3']);
    expect(left).toEqual(['p1', 'p2']);
  });

  it('subscribes to nothing when no post is open', () => {
    render(<Probe postId={null} />);
    expect(roomCalls()).toEqual([]);
  });

  it('waits for the connection before joining', () => {
    isConnected = false;
    const { rerender } = render(<Probe postId="p1" />);
    expect(roomCalls()).toEqual([]);

    isConnected = true;
    rerender(<Probe postId="p1" />);
    expect(roomCalls()).toEqual(['post/join:p1']);
  });

  it('rejoins after a reconnect rather than assuming membership survived', () => {
    const { rerender } = render(<Probe postId="p1" />);
    expect(roomCalls()).toEqual(['post/join:p1']);

    // Connection drops: membership lives on the connection, so it is gone.
    isConnected = false;
    rerender(<Probe postId="p1" />);

    isConnected = true;
    rerender(<Probe postId="p1" />);

    expect(roomCalls().filter((c) => c === 'post/join:p1')).toHaveLength(2);
  });
});
