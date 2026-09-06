import { IPost } from '@interfaces/post';

import {
  isChainSpent, MAX_RENDERED_FEED_POSTS, mergeFeedPage, withFeedKey
} from './use-feed-chain-page';

const post = (id: string) => ({ _id: id } as IPost);

describe('withFeedKey', () => {
  it('uses the plain id in the first cycle', () => {
    expect(withFeedKey(post('p1'), 0).feedKey).toBe('p1');
  });

  it('namespaces later cycles, so a recycled post is a distinct rendered entry', () => {
    // A chain that has served every eligible post recycles, so the same post
    // legitimately appears again further down. Two React children may not share
    // a key.
    expect(withFeedKey(post('p1'), 1).feedKey).toBe('1:p1');
    expect(withFeedKey(post('p1'), 2).feedKey).toBe('2:p1');
  });

  it('does not mutate the post it was given', () => {
    const original = post('p1');
    withFeedKey(original, 3);
    expect(original.feedKey).toBeUndefined();
  });
});

describe('mergeFeedPage', () => {
  const cycle0 = (ids: string[]) => ids.map((id) => withFeedKey(post(id), 0));
  const cycle1 = (ids: string[]) => ids.map((id) => withFeedKey(post(id), 1));

  it('replaces on reset', () => {
    const result = mergeFeedPage(cycle0(['p1', 'p2']), cycle0(['p9']), 'reset');
    expect(result.posts.map((p) => p._id)).toEqual(['p9']);
    expect(result.added).toBe(1);
  });

  it('drops an id the same cycle already showed', () => {
    const result = mergeFeedPage(cycle0(['p1', 'p2']), cycle0(['p2', 'p3']), 'append');
    expect(result.posts.map((p) => p._id)).toEqual(['p1', 'p2', 'p3']);
    expect(result.added).toBe(1);
  });

  it('keeps a post the NEXT cycle re-offers', () => {
    // The recycle case. De-duplicating by `_id` here would silently discard a
    // whole recycled cycle and make the feed look finished.
    const result = mergeFeedPage(cycle0(['p1', 'p2']), cycle1(['p1']), 'rollover');
    expect(result.posts.map((p) => p.feedKey)).toEqual(['p1', 'p2', '1:p1']);
    expect(result.added).toBe(1);
  });

  it('returns the same array reference when nothing was added', () => {
    const current = cycle0(['p1']);
    const result = mergeFeedPage(current, cycle0(['p1']), 'append');
    expect(result.posts).toBe(current);
    expect(result.added).toBe(0);
  });
});

describe('isChainSpent', () => {
  /*
   * The stop condition is the server's answer, never the client's bookkeeping.
   * In `deploy-2026-09-06g` it was "the rollover added nothing the client did
   * not already hold", so a rollover re-offering visible posts ended Home at
   * 89 of 160 with "recommendations are exhausted".
   */
  it('is true only for a rollover that returned nothing at all', () => {
    expect(isChainSpent({ data: [], hasMore: false }, 'rollover')).toBe(true);
  });

  it('is false for a rollover that returned posts, even familiar ones', () => {
    expect(isChainSpent({ data: [post('p1')], hasMore: false }, 'rollover')).toBe(false);
  });

  it('is false for an ordinary page, however empty', () => {
    expect(isChainSpent({ data: [], hasMore: false }, 'append')).toBe(false);
    expect(isChainSpent({ data: [], hasMore: false }, 'reset')).toBe(false);
  });
});

describe('MAX_RENDERED_FEED_POSTS', () => {
  it('is a rendering ceiling well above one pass of this catalogue', () => {
    // 160 posts is the measured-safe render size (rules/user.md); the ceiling
    // exists because recycling makes the feed endless, not because the
    // catalogue ends.
    expect(MAX_RENDERED_FEED_POSTS).toBeGreaterThan(160);
  });
});
