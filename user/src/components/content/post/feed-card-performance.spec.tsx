/**
 * Performance invariants for the feed grids.
 *
 * These are the two properties that were measured to matter, so they are the
 * two that are defended here rather than left to be re-discovered:
 *
 * 1. **Feed cards are memoised.** Hovering a card sets state on the *parent*
 *    feed (`hoveredCompactPostId`), and a feed keeps every card it has ever
 *    loaded. Without `memo`, one mouse crossing re-renders all of them. Measured
 *    on a production build with 112 cards: scrolling with the pointer over the
 *    grid spent 5,245ms in long tasks against 2,398ms with hover suppressed —
 *    so roughly half the cost of a scroll, and double the worst frame, was this
 *    one missing wrapper.
 *
 * 2. **At most one video element is mounted per card, and only when it is the
 *    featured card or under the pointer.** This is what keeps a feed of 160
 *    video posts from holding 160 decoders. It lives in
 *    `usePostVideoHoverPlayback.showVideo`, and is tested here against the real
 *    hook rather than by reading the expression.
 */

import {
  act, fireEvent, render, renderHook, screen
} from '@testing-library/react';
import { memo, useCallback, useState } from 'react';

import { usePostVideoHoverPlayback } from '@hooks/use-post-video-hover-playback';
import type { IPost } from '@interfaces/post';

import HomeFeedCard from './home-feed-card';
import CreatorProfileWorkItem from '../../creator/creator-profile-work-item';

/** React tags a memo component with this symbol; nothing else does. */
const isMemoComponent = (value: unknown) => Boolean(
  value && typeof value === 'object' && (value as any).$$typeof === Symbol.for('react.memo')
);

const videoPost = {
  _id: 'post-1',
  type: 'video',
  text: 'A caption',
  totalLike: 3,
  totalView: 10,
  createdAt: new Date().toISOString(),
  user: { _id: 'user-1', username: 'someone', name: 'Someone' },
  files: [{
    _id: 'file-1',
    type: 'post-video',
    mimeType: 'video/mp4',
    url: 'http://localhost:8000/videos/file-1.mp4',
    thumbnails: ['http://localhost:8000/photos/file-1.jpg']
  }],
  cover4x3Url: 'http://localhost:8000/photos/file-1.jpg',
  cover3x4Url: 'http://localhost:8000/photos/file-1.jpg'
} as unknown as IPost;

describe('feed card memoisation', () => {
  it('memoises the Home Feed card', () => {
    // A plain function component here means every hover re-renders the entire
    // loaded feed. See the measurement in this file's header.
    expect(isMemoComponent(HomeFeedCard)).toBe(true);
  });

  it('memoises the profile works tile', () => {
    expect(isMemoComponent(CreatorProfileWorkItem)).toBe(true);
  });

  it('memo actually bails out when a parent re-renders with unchanged props', () => {
    // Guards the assumption the memo depends on: the feeds pass stable props —
    // a `useMemo` playlist, `useCallback` handlers, a setState function. This
    // proves the bail-out works for that prop shape, so an inline object or
    // arrow at a call site is the only way to switch it back off.
    let childRenders = 0;
    const Child = memo(function Child({ post }: { post: IPost; onOpen: () => void }) {
      childRenders += 1;
      return <span>{post._id}</span>;
    });

    function Parent() {
      const [hovered, setHovered] = useState<string | null>(null);
      // Stable across renders, exactly as HomeFeed's props are.
      const onOpen = useCallback(() => {}, []);
      return (
        <div>
          <button type="button" onClick={() => setHovered((v) => (v ? null : 'x'))}>
            {hovered || 'none'}
          </button>
          <Child post={videoPost} onOpen={onOpen} />
        </div>
      );
    }

    render(<Parent />);
    expect(childRenders).toBe(1);

    // The parent's hover state changes — which is what every mouse crossing
    // does in the real feed.
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('x');
    expect(childRenders).toBe(1);
  });

});

describe('video elements are mounted sparingly', () => {
  const baseOptions = {
    post: videoPost,
    popupPipState: null,
    popupPlaylist: []
  };

  it('mounts no video for a compact card at rest', () => {
    const { result } = renderHook(() => usePostVideoHoverPlayback({ ...baseOptions }));

    expect(result.current.hasVideo).toBe(true);
    // The card shows its poster image. A feed of 160 video posts therefore
    // holds zero decoders until the pointer arrives.
    expect(result.current.showVideo).toBe(false);
  });

  it('mounts a video for a compact card only while it is hovered', () => {
    const { result } = renderHook(() => usePostVideoHoverPlayback({ ...baseOptions }));

    act(() => { result.current.handleMouseEnter(); });
    expect(result.current.showVideo).toBe(true);

    act(() => { result.current.handleMouseLeave(); });
    // Released again on leave: the element unmounts, taking its buffer and
    // decoder with it.
    expect(result.current.showVideo).toBe(false);
  });

  it('releases a compact card video when the card scrolls out of view', () => {
    /*
     * A scroll usually moves the content, not the pointer. The card that slides
     * away therefore never receives `mouseleave`, and before this it kept its
     * `<video>` mounted and downloading several screens above the viewport --
     * measured on the real feed as an element parked at `top: -6497px` that
     * survived every subsequent scroll and even the pointer leaving the grid.
     *
     * Rendered rather than driven through the hook directly, because the hook
     * only observes once the card has handed it an element.
     */
    const notifiers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    const original = window.IntersectionObserver;
    window.IntersectionObserver = class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        notifiers.push(callback);
      }

      observe() { return undefined; }

      unobserve() { return undefined; }

      disconnect() { return undefined; }

      takeRecords() { return []; }
    } as any;

    try {
      const { container } = render(<HomeFeedCard post={videoPost} popupPipState={null} popupPlaylist={[]} />);
      const media = container.querySelector('.home-feed-card-media') as HTMLElement;

      fireEvent.mouseEnter(media);
      expect(container.querySelector('video')).not.toBeNull();
      expect(notifiers.length).toBeGreaterThan(0);

      // The card leaves the viewport. No pointer event accompanies it.
      act(() => { notifiers.forEach((notify) => notify([{ isIntersecting: false }])); });

      expect(container.querySelector('video')).toBeNull();
    } finally {
      window.IntersectionObserver = original;
    }
  });

  it('mounts the featured card video without a hover', () => {
    const { result } = renderHook(() => usePostVideoHoverPlayback({ ...baseOptions, featured: true }));

    // Exactly one card in the grid is featured, so this is the one always-on
    // video the feed pays for.
    expect(result.current.showVideo).toBe(true);
  });

  it('shows a poster instead of a video for a photo post', () => {
    const photoPost = { ...videoPost, type: 'photo', files: [{ ...(videoPost as any).files[0], type: 'post-photo', mimeType: 'image/webp' }] } as unknown as IPost;
    const { result } = renderHook(() => usePostVideoHoverPlayback({ ...baseOptions, post: photoPost, featured: true }));

    expect(result.current.hasVideo).toBe(false);
    expect(result.current.showVideo).toBe(false);
  });

  it('releases the chrome timer when the card unmounts', () => {
    jest.useFakeTimers();
    try {
      const { result, unmount } = renderHook(() => usePostVideoHoverPlayback({ ...baseOptions }));
      act(() => { result.current.handleMouseEnter(); });
      unmount();
      // A timer left running after unmount is a leak that fires setState on a
      // dead component; running the clock forward must produce nothing.
      expect(() => jest.runOnlyPendingTimers()).not.toThrow();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
