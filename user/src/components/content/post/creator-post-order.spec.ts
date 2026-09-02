/**
 * The creator list has exactly one order, and everything reads it from here.
 *
 * The grid, the highlighted tile and the next/previous sequence used to sort
 * independently. They agreed most of the time, which is the worst way for two
 * definitions to differ -- the disagreement only surfaced on posts near a
 * boundary, and looked like a random glitch rather than a rule.
 */

import type { IPost } from '@interfaces/post';

import { compareCreatorPosts, insertPostInOrder, mergeCreatorPosts } from './creator-post-order';

const post = (over: Partial<IPost> & { _id: string }) => ({
  type: 'video',
  isPinned: false,
  pinnedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over
} as unknown as IPost);

describe('creator post order', () => {
  it('puts pinned posts ahead of newer unpinned ones', () => {
    const pinnedOld = post({ _id: 'a', isPinned: true, pinnedAt: '2026-02-01T00:00:00.000Z', createdAt: '2025-01-01T00:00:00.000Z' });
    const freshUnpinned = post({ _id: 'b', createdAt: '2026-09-01T00:00:00.000Z' });

    expect([freshUnpinned, pinnedOld].sort(compareCreatorPosts).map((p) => p._id))
      .toEqual(['a', 'b']);
  });

  it('orders pinned posts by pinnedAt, newest pin first', () => {
    const first = post({ _id: 'a', isPinned: true, pinnedAt: '2026-03-01T00:00:00.000Z' });
    const second = post({ _id: 'b', isPinned: true, pinnedAt: '2026-05-01T00:00:00.000Z' });

    expect([first, second].sort(compareCreatorPosts).map((p) => p._id)).toEqual(['b', 'a']);
  });

  it('orders unpinned posts newest first', () => {
    const older = post({ _id: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
    const newer = post({ _id: 'b', createdAt: '2026-06-01T00:00:00.000Z' });

    expect([older, newer].sort(compareCreatorPosts).map((p) => p._id)).toEqual(['b', 'a']);
  });

  it('breaks a timestamp tie by _id, so the order never wobbles', () => {
    const a = post({ _id: 'aaa', createdAt: '2026-01-01T00:00:00.000Z' });
    const b = post({ _id: 'bbb', createdAt: '2026-01-01T00:00:00.000Z' });

    // Same answer whichever way round they arrive.
    expect([a, b].sort(compareCreatorPosts).map((p) => p._id)).toEqual(['bbb', 'aaa']);
    expect([b, a].sort(compareCreatorPosts).map((p) => p._id)).toEqual(['bbb', 'aaa']);
  });

  it('does not care whether a post is a photo or a video', () => {
    // Photos and videos share one sequence: the grid shows both, so the arrows
    // move through both.
    const photo = post({ _id: 'p', type: 'photo', createdAt: '2026-06-01T00:00:00.000Z' });
    const video = post({ _id: 'v', type: 'video', createdAt: '2026-05-01T00:00:00.000Z' });

    expect([video, photo].sort(compareCreatorPosts).map((p) => p._id)).toEqual(['p', 'v']);
  });

  describe('insertPostInOrder', () => {
    it('places a post from a later page at its ordered position, not at the end', () => {
      const page = [
        post({ _id: 'a', createdAt: '2026-06-01T00:00:00.000Z' }),
        post({ _id: 'c', createdAt: '2026-04-01T00:00:00.000Z' })
      ];
      const open = post({ _id: 'b', createdAt: '2026-05-01T00:00:00.000Z' });

      // Appending it -- the old behaviour -- would have produced a, c, b, and
      // the grid would have highlighted the last tile while the arrows moved
      // between a and c.
      expect(insertPostInOrder(page, open).map((p) => p._id)).toEqual(['a', 'b', 'c']);
    });

    it('places a pinned open post at the very front', () => {
      const page = [post({ _id: 'a', createdAt: '2026-06-01T00:00:00.000Z' })];
      const open = post({ _id: 'z', isPinned: true, pinnedAt: '2026-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z' });

      expect(insertPostInOrder(page, open).map((p) => p._id)).toEqual(['z', 'a']);
    });

    it('returns the same array when the post is already present', () => {
      const page = [post({ _id: 'a' })];

      expect(insertPostInOrder(page, page[0])).toBe(page);
    });

    it('tolerates a missing post', () => {
      const page = [post({ _id: 'a' })];

      expect(insertPostInOrder(page, null)).toBe(page);
    });
  });

  describe('mergeCreatorPosts', () => {
    it('keeps one entry per post and re-sorts the result', () => {
      const existing = [post({ _id: 'a', createdAt: '2026-06-01T00:00:00.000Z' })];
      const incoming = [
        post({ _id: 'b', createdAt: '2026-07-01T00:00:00.000Z' }),
        post({ _id: 'a', createdAt: '2026-06-01T00:00:00.000Z' })
      ];

      expect(mergeCreatorPosts(existing, incoming).map((p) => p._id)).toEqual(['b', 'a']);
    });

    it('prefers the freshly fetched copy of a post', () => {
      const stale = post({ _id: 'a', totalLike: 1 } as any);
      const fresh = post({ _id: 'a', totalLike: 9 } as any);

      expect((mergeCreatorPosts([stale], [fresh])[0] as any).totalLike).toBe(9);
    });
  });
});
