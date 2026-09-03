/**
 * The arrows, and what they may claim.
 *
 * `nextPost` alone has only two states — a loaded neighbour, or nothing — so a
 * refill still in flight was indistinguishable from the end of the feed. That
 * is what the dead-end looked like on screen: a disabled Next control over a
 * catalogue with a hundred posts left in it.
 */

import { act, renderHook } from '@testing-library/react';

import type { IPost } from '@interfaces/post';

import { usePostDetailNavigation } from './use-post-detail-navigation';

const make = (id: string): IPost => ({ _id: id, type: 'video' } as unknown as IPost);

type Props = Parameters<typeof usePostDetailNavigation>[0];
const render = (initialProps: Props) => renderHook(
  (props: Props) => usePostDetailNavigation(props),
  { initialProps }
);

describe('usePostDetailNavigation', () => {
  it('moves to the loaded neighbour', () => {
    const onNavigate = jest.fn();
    const posts = [make('a'), make('b'), make('c')];
    const { result } = render({ posts, post: posts[1], onNavigate });

    expect(result.current.canNext).toBe(true);
    act(() => result.current.navigate('next'));
    expect(onNavigate).toHaveBeenCalledWith(posts[2]);

    act(() => result.current.navigate('previous'));
    expect(onNavigate).toHaveBeenLastCalledWith(posts[0]);
  });

  it('reports the end of the sequence when nothing more is coming', () => {
    const posts = [make('a'), make('b')];
    const { result } = render({ posts, post: posts[1], onNavigate: jest.fn(), hasMoreAhead: false });
    expect(result.current.canNext).toBe(false);
  });

  it('stays available at the tail while a refill is in flight', () => {
    const posts = [make('a'), make('b')];
    const { result } = render({ posts, post: posts[1], onNavigate: jest.fn(), hasMoreAhead: true });
    expect(result.current.canNext).toBe(true);
    expect(result.current.nextPost).toBeNull();
  });

  it('honours a next pressed at the tail once the post arrives', () => {
    const onNavigate = jest.fn();
    const posts = [make('a'), make('b')];
    const { result, rerender } = render({
      posts, post: posts[1], onNavigate, hasMoreAhead: true
    });

    act(() => result.current.navigate('next'));
    // Nothing to go to yet — the intent is held, not dropped.
    expect(onNavigate).not.toHaveBeenCalled();
    expect(result.current.awaitingNext).toBe(true);

    const grown = [...posts, make('c')];
    rerender({ posts: grown, post: posts[1], onNavigate, hasMoreAhead: true });

    expect(onNavigate).toHaveBeenCalledWith(grown[2]);
  });

  it('drops a held intent when the sequence turns out to be over', () => {
    const onNavigate = jest.fn();
    const posts = [make('a'), make('b')];
    const { result, rerender } = render({
      posts, post: posts[1], onNavigate, hasMoreAhead: true
    });
    act(() => result.current.navigate('next'));
    expect(result.current.awaitingNext).toBe(true);

    rerender({ posts, post: posts[1], onNavigate, hasMoreAhead: false });

    expect(result.current.awaitingNext).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not fire a stale held intent after the viewer moved elsewhere', () => {
    const onNavigate = jest.fn();
    const posts = [make('a'), make('b')];
    const { result, rerender } = render({
      posts, post: posts[1], onNavigate, hasMoreAhead: true
    });
    act(() => result.current.navigate('next'));

    // The viewer went back instead of waiting.
    rerender({ posts, post: posts[0], onNavigate, hasMoreAhead: true });
    expect(result.current.awaitingNext).toBe(false);

    // The refill lands now; it must not yank them forward from where they are.
    const grown = [...posts, make('c')];
    rerender({ posts: grown, post: posts[0], onNavigate, hasMoreAhead: true });
    expect(onNavigate).not.toHaveBeenCalledWith(grown[2]);
  });

  it('a burst of fast clicks at the tail resolves to exactly one step', () => {
    const onNavigate = jest.fn();
    const posts = [make('a'), make('b')];
    const { result, rerender } = render({
      posts, post: posts[1], onNavigate, hasMoreAhead: true
    });

    act(() => {
      result.current.navigate('next');
      result.current.navigate('next');
      result.current.navigate('next');
    });

    const grown = [...posts, make('c')];
    rerender({ posts: grown, post: posts[1], onNavigate, hasMoreAhead: true });

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(grown[2]);
  });

  it('never navigates at all in a locked panel, where the list is empty', () => {
    const onNavigate = jest.fn();
    const { result } = render({
      posts: [], post: make('a'), onNavigate, hasMoreAhead: false
    });
    expect(result.current.canNext).toBe(false);
    act(() => result.current.navigate('next'));
    act(() => result.current.navigate('previous'));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
