import { act, render } from '@testing-library/react';
import React from 'react';

import { SHARED_POST_MODAL_SOURCE, useOpenSharedPost } from './use-open-shared-post';

const mockPush = jest.fn();
let mockPathname = '/';
let mockSearch = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch)
}));

jest.mock('@providers/message-workspace.provider', () => ({ MESSAGES_ROUTE: '/messages' }));

let open: (postId: string) => void;

function Probe() {
  open = useOpenSharedPost();
  return null;
}

/**
 * The shared-post message -> Post Detail chain (rules/instructions §3):
 * `MessageThreadView` -> `MessageBubble.onOpenPost` -> `SharedPostCard.onOpen`
 * -> this hook -> `?modal_id=<postId>&modal_src=message`, which
 * `useHomeFeedPlayback` turns into a `'message-shared-post'` open backed by the
 * anchor-based recommendation detail session — the same one Home and
 * notification opens use, never Home grid order.
 */
describe('useOpenSharedPost', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockPathname = '/';
    mockSearch = '';
  });

  it('opens the right post in place, tagged as a message-originated open', () => {
    render(<Probe />);
    act(() => { open('post-123'); });

    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = new URL(mockPush.mock.calls[0][0], 'https://x.test');
    expect(url.searchParams.get('modal_id')).toBe('post-123');
    expect(url.searchParams.get('modal_src')).toBe(SHARED_POST_MODAL_SOURCE);
  });

  it('preserves the existing query (a Home category tab, say) rather than replacing it', () => {
    mockSearch = 'topicKey=food';
    render(<Probe />);
    act(() => { open('post-123'); });

    const url = new URL(mockPush.mock.calls[0][0], 'https://x.test');
    expect(url.searchParams.get('topicKey')).toBe('food');
    expect(url.searchParams.get('modal_id')).toBe('post-123');
  });

  it('keeps the modal on whichever modal-hosting route the viewer is already on', () => {
    mockPathname = '/for-you';
    render(<Probe />);
    act(() => { open('post-123'); });

    expect(mockPush.mock.calls[0][0]).toContain('/for-you?');
  });

  it('falls back to home from /messages, which renders no modal of its own — still tagged as a message open', () => {
    mockPathname = '/messages';
    render(<Probe />);
    act(() => { open('post-123'); });

    const url = new URL(mockPush.mock.calls[0][0], 'https://x.test');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('modal_id')).toBe('post-123');
    expect(url.searchParams.get('modal_src')).toBe(SHARED_POST_MODAL_SOURCE);
  });

  it('treats a creator profile as a modal host (single-segment path)', () => {
    mockPathname = '/someone';
    render(<Probe />);
    act(() => { open('post-123'); });

    expect(mockPush.mock.calls[0][0]).toContain('/someone?');
  });

  it('does nothing without a post id — an unavailable shared post has none', () => {
    render(<Probe />);
    act(() => { open(''); });

    expect(mockPush).not.toHaveBeenCalled();
  });
});
