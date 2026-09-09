/**
 * The detail modal's next/previous sequence.
 *
 * The defect these lock down: opening a **photo** post and pressing next moved
 * to the following post in the *home feed* -- usually a different creator --
 * while the creator's own grid was on screen beside it. Video posts were fine,
 * because the video layout switched its sequence to the creator list and the
 * photo layout never did.
 *
 * Every test below fails against that implementation, and none of them depends
 * on the post being a photo: the property being defended is that the sequence
 * follows the *grid on screen*, whatever kind of post is open.
 */

import { act, renderHook } from '@testing-library/react';

import type { IPost } from '@interfaces/post';

const getCreatorPosts = jest.fn();
jest.mock('@services/post.service', () => ({
  getCreatorPosts: (...args: unknown[]) => getCreatorPosts(...args)
}));

// eslint-disable-next-line import/first
import { usePostDetailSequence } from './use-post-detail-sequence';

const CREATOR = 'creator-1';
const OTHER = 'creator-2';

const make = (id: string, over: Partial<IPost> = {}, userId = CREATOR) => ({
  _id: id,
  type: 'video',
  isPinned: false,
  pinnedAt: null,
  createdAt: `2026-0${id.length}-0${(Number(id.replace(/\D/g, '')) % 9) + 1}T00:00:00.000Z`,
  user: { _id: userId, username: userId },
  files: [{ _id: `${id}-f`, type: 'video/mp4', url: `https://x/${id}.mp4` }],
  ...over
} as unknown as IPost);

/** A photo post: no video file, one image. */
const photo = (id: string, over: Partial<IPost> = {}, userId = CREATOR) => make(id, {
  type: 'photo',
  files: [{ _id: `${id}-f`, type: 'photo/png', url: `https://x/${id}.png` }],
  ...over
} as Partial<IPost>, userId);

const creatorPage = (posts: IPost[], hasMore = false) => ({
  data: {
    data: posts, total: posts.length, hasMore, nextCursor: null
  }
});

const renderSequence = (options: Parameters<typeof usePostDetailSequence>[0]) => renderHook(
  (props: Parameters<typeof usePostDetailSequence>[0]) => usePostDetailSequence(props),
  { initialProps: options }
);

/** Let the hook's fetch resolve and its state settle. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('post detail sequence', () => {
  beforeEach(() => {
    getCreatorPosts.mockReset();
  });

  it('navigates the creator list, not the feed, while the creator grid is open', async () => {
    // The creator's own posts, newest first: a video, then the photo, then a video.
    const video1 = make('v1', { createdAt: '2026-06-03T00:00:00.000Z' });
    const openPhoto = photo('p1', { createdAt: '2026-06-02T00:00:00.000Z' });
    const video2 = make('v2', { createdAt: '2026-06-01T00:00:00.000Z' });
    // The feed behind the modal is somebody else's work entirely.
    const feed = [openPhoto, make('other', { createdAt: '2026-06-09T00:00:00.000Z' }, OTHER)];

    getCreatorPosts.mockResolvedValue(creatorPage([video1, openPhoto, video2]));

    const onNavigate = jest.fn();
    const { result } = renderSequence({
      post: openPhoto,
      feedPosts: feed,
      mode: 'creator',
      creatorId: CREATOR,
      onNavigate
    });
    await settle();

    expect(result.current.creatorScope).toBe(true);
    expect(result.current.navigationPosts.map((p) => p._id)).toEqual(['v1', 'p1', 'v2']);
    // Next from a photo lands on this creator's next post, not the feed's.
    expect(result.current.nextPost?._id).toBe('v2');
    expect(result.current.previousPost?._id).toBe('v1');

    act(() => result.current.navigate('next'));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ _id: 'v2' }));
  });

  it('never yields a post belonging to another creator', async () => {
    // Dated so the open photo sits in the middle, and a "next" really exists.
    const openPhoto = photo('p1', { createdAt: '2026-06-02T00:00:00.000Z' });
    getCreatorPosts.mockResolvedValue(creatorPage([
      make('v1', { createdAt: '2026-06-03T00:00:00.000Z' }),
      openPhoto,
      make('v2', { createdAt: '2026-06-01T00:00:00.000Z' })
    ]));

    const { result } = renderSequence({
      post: openPhoto,
      feedPosts: [openPhoto, make('foreign', { createdAt: '2026-06-09T00:00:00.000Z' }, OTHER)],
      mode: 'creator',
      creatorId: CREATOR,
      onNavigate: jest.fn()
    });
    await settle();

    // Non-empty first: an empty sequence would satisfy "no foreign posts"
    // without proving anything, and that is exactly what the broken version
    // produced once the panel was open.
    expect(result.current.navigationPosts.length).toBe(3);
    for (const item of result.current.navigationPosts) {
      expect(item.user?._id).toBe(CREATOR);
    }
    expect(result.current.nextPost).not.toBeNull();
    expect(result.current.nextPost?.user?._id).toBe(CREATOR);
  });

  it('moves photo -> video and video -> photo through one sequence', async () => {
    const video = make('v1', { createdAt: '2026-06-03T00:00:00.000Z' });
    const openPhoto = photo('p1', { createdAt: '2026-06-02T00:00:00.000Z' });
    getCreatorPosts.mockResolvedValue(creatorPage([video, openPhoto]));

    const fromPhoto = renderSequence({
      post: openPhoto,
      feedPosts: [],
      mode: 'creator',
      creatorId: CREATOR,
      onNavigate: jest.fn()
    });
    await settle();
    expect(fromPhoto.result.current.previousPost?._id).toBe('v1');

    const fromVideo = renderSequence({
      post: video,
      feedPosts: [],
      mode: 'creator',
      creatorId: CREATOR,
      onNavigate: jest.fn()
    });
    await settle();
    expect(fromVideo.result.current.nextPost?._id).toBe('p1');
  });

  it('has no previous at the start and no next at the end', async () => {
    const first = photo('p1', { createdAt: '2026-06-03T00:00:00.000Z' });
    const last = make('v2', { createdAt: '2026-06-01T00:00:00.000Z' });
    getCreatorPosts.mockResolvedValue(creatorPage([first, last]));

    const atStart = renderSequence({
      post: first, feedPosts: [], mode: 'creator', creatorId: CREATOR, onNavigate: jest.fn()
    });
    await settle();
    expect(atStart.result.current.previousPost).toBeNull();
    expect(atStart.result.current.nextPost?._id).toBe('v2');

    const atEnd = renderSequence({
      post: last, feedPosts: [], mode: 'creator', creatorId: CREATOR, onNavigate: jest.fn()
    });
    await settle();
    expect(atEnd.result.current.nextPost).toBeNull();
  });

  it('places an open post from a later page at its ordered position', async () => {
    // The open photo is not on the first page the API returns.
    const openPhoto = photo('p1', { createdAt: '2026-06-02T00:00:00.000Z' });
    getCreatorPosts.mockResolvedValue(creatorPage([
      make('v1', { createdAt: '2026-06-03T00:00:00.000Z' }),
      make('v2', { createdAt: '2026-06-01T00:00:00.000Z' })
    ], true));

    const { result } = renderSequence({
      post: openPhoto, feedPosts: [], mode: 'creator', creatorId: CREATOR, onNavigate: jest.fn()
    });
    await settle();

    // Between them, by date -- not appended at the end, which would have made
    // "next" empty and "previous" the wrong post.
    expect(result.current.navigationPosts.map((p) => p._id)).toEqual(['v1', 'p1', 'v2']);
    expect(result.current.currentIndex).toBe(1);
  });

  it('puts pinned posts first in the sequence, matching the grid', async () => {
    const pinned = make('pin', { isPinned: true, pinnedAt: '2026-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' });
    const newest = photo('p1', { createdAt: '2026-09-01T00:00:00.000Z' });
    getCreatorPosts.mockResolvedValue(creatorPage([pinned, newest]));

    const { result } = renderSequence({
      post: newest, feedPosts: [], mode: 'creator', creatorId: CREATOR, onNavigate: jest.fn()
    });
    await settle();

    expect(result.current.navigationPosts.map((p) => p._id)).toEqual(['pin', 'p1']);
    expect(result.current.previousPost?._id).toBe('pin');
  });

  it('rebuilds the sequence from the server when there is no feed behind it', async () => {
    // A reload or a deep link: `feedPosts` is empty, but a creator-scoped source
    // still has neighbours because the creator's posts are refetched.
    const openPhoto = photo('p1', { createdAt: '2026-06-02T00:00:00.000Z' });
    getCreatorPosts.mockResolvedValue(creatorPage([make('v1', { createdAt: '2026-06-03T00:00:00.000Z' }), openPhoto]));

    const { result } = renderSequence({
      post: openPhoto,
      feedPosts: [],
      mode: 'creator',
      creatorId: CREATOR,
      onNavigate: jest.fn()
    });
    await settle();

    expect(result.current.creatorScope).toBe(true);
    expect(result.current.previousPost?._id).toBe('v1');
  });

  it('uses the feed when the modal was opened from one and no grid is showing', async () => {
    const openPhoto = photo('p1');
    const nextInFeed = make('feed2', {}, OTHER);

    const { result } = renderSequence({
      post: openPhoto,
      feedPosts: [openPhoto, nextInFeed],
      mode: 'recommendation',
      creatorId: null,
      onNavigate: jest.fn()
    });
    await settle();

    // Not a regression: with the feed on screen behind the modal, the feed is
    // the right sequence -- including its other creators.
    expect(result.current.creatorScope).toBe(false);
    expect(result.current.nextPost?._id).toBe('feed2');
    expect(getCreatorPosts).not.toHaveBeenCalled();
  });

  it('stops navigating while a non-grid panel is open', async () => {
    const openPhoto = photo('p1');

    const { result } = renderSequence({
      post: openPhoto,
      feedPosts: [openPhoto, make('feed2', {}, OTHER)],
      mode: 'disabled',
      creatorId: null,
      onNavigate: jest.fn()
    });
    await settle();

    // Nothing to scroll between when the viewer is reading comments.
    expect(result.current.nextPost).toBeNull();
    expect(result.current.previousPost).toBeNull();
  });
});

/**
 * Mode transitions, and the races around them.
 *
 * These are the arrangements that let one owner's list end up inside another's:
 * a recommendation prefetch landing while the creator grid is open, a creator
 * page landing after the grid was closed, and a response naming a creator the
 * viewer has already left.
 */
describe('post detail sequence — mode transitions', () => {
  beforeEach(() => getCreatorPosts.mockReset());

  it('does not let a growing recommendation feed into the creator grid', async () => {
    const open = make('v1', { createdAt: '2026-06-03T00:00:00.000Z' });
    getCreatorPosts.mockResolvedValue(creatorPage([
      open, make('v2', { createdAt: '2026-06-01T00:00:00.000Z' })
    ]));

    const { result, rerender } = renderHook(
      (props: Parameters<typeof usePostDetailSequence>[0]) => usePostDetailSequence(props),
      {
        initialProps: {
          post: open,
          feedPosts: [open],
          mode: 'creator' as const,
          creatorId: CREATOR,
          onNavigate: jest.fn()
        }
      }
    );
    await settle();
    expect(result.current.navigationPosts.map((p) => p._id)).toEqual(['v1', 'v2']);

    // A recommendation prefetch lands: `feedPosts` grows with another creator's
    // post while the grid is still open.
    rerender({
      post: open,
      feedPosts: [open, make('reco', { createdAt: '2026-06-09T00:00:00.000Z' }, OTHER)],
      mode: 'creator' as const,
      creatorId: CREATOR,
      onNavigate: jest.fn()
    });
    await settle();

    expect(result.current.navigationPosts.map((p) => p._id)).toEqual(['v1', 'v2']);
    expect(result.current.creatorPosts.posts.map((p) => p._id)).toEqual(['v1', 'v2']);
  });

  it('drops an item the creator query returned that is not the captured creator', async () => {
    const open = make('v1', { createdAt: '2026-06-03T00:00:00.000Z' });
    // Exactly what `/posts/home-posts` used to answer with: a mixed list.
    getCreatorPosts.mockResolvedValue(creatorPage([
      open,
      make('stranger', { createdAt: '2026-06-02T00:00:00.000Z' }, OTHER),
      make('v2', { createdAt: '2026-06-01T00:00:00.000Z' })
    ]));

    const { result } = renderSequence({
      post: open,
      feedPosts: [],
      mode: 'creator',
      creatorId: CREATOR,
      onNavigate: jest.fn()
    });
    await settle();

    expect(result.current.navigationPosts.map((p) => p._id)).toEqual(['v1', 'v2']);
    expect(result.current.creatorPosts.posts.every((p) => p.user?._id === CREATOR)).toBe(true);
  });

  it('returns to the feed sequence when the grid closes, without merging the two', async () => {
    const open = make('v1', { createdAt: '2026-06-03T00:00:00.000Z' });
    const feedNext = make('feed2', { createdAt: '2026-06-09T00:00:00.000Z' }, OTHER);
    getCreatorPosts.mockResolvedValue(creatorPage([
      open, make('v2', { createdAt: '2026-06-01T00:00:00.000Z' })
    ]));

    const { result, rerender } = renderHook(
      (props: Parameters<typeof usePostDetailSequence>[0]) => usePostDetailSequence(props),
      {
        initialProps: {
          post: open,
          feedPosts: [open, feedNext],
          mode: 'creator' as const,
          creatorId: CREATOR,
          onNavigate: jest.fn()
        }
      }
    );
    await settle();
    expect(result.current.nextPost?._id).toBe('v2');

    rerender({
      post: open,
      feedPosts: [open, feedNext],
      mode: 'recommendation' as const,
      creatorId: null,
      onNavigate: jest.fn()
    });
    await settle();

    // The feed, whole — not the feed with the creator's posts appended.
    expect(result.current.navigationPosts.map((p) => p._id)).toEqual(['v1', 'feed2']);
    expect(result.current.nextPost?._id).toBe('feed2');
  });

  it('does not navigate at all while a reading panel is open, even mid-fetch', async () => {
    const open = make('v1');
    getCreatorPosts.mockImplementation(() => new Promise(() => undefined));

    const { result } = renderSequence({
      post: open,
      feedPosts: [open, make('feed2', {}, OTHER)],
      mode: 'disabled',
      creatorId: null,
      onNavigate: jest.fn()
    });
    await settle();

    expect(result.current.navigationPosts).toEqual([]);
    expect(result.current.canNext).toBe(false);
    expect(getCreatorPosts).not.toHaveBeenCalled();
  });

  it('keeps "next" alive in recommendation mode while the session refills', async () => {
    const open = make('v1');
    const { result } = renderSequence({
      post: open,
      feedPosts: [open],
      mode: 'recommendation',
      creatorId: null,
      hasMoreAhead: true,
      onNavigate: jest.fn()
    });
    await settle();

    expect(result.current.nextPost).toBeNull();
    expect(result.current.canNext).toBe(true);
  });

  it('never claims more is coming in creator mode — a creator list pages, it does not refill', async () => {
    const open = make('v1');
    getCreatorPosts.mockResolvedValue(creatorPage([open]));

    const { result } = renderSequence({
      post: open,
      feedPosts: [],
      mode: 'creator',
      creatorId: CREATOR,
      hasMoreAhead: true,
      onNavigate: jest.fn()
    });
    await settle();

    expect(result.current.canNext).toBe(false);
  });
});
