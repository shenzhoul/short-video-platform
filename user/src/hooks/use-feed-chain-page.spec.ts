import { IPost } from '@interfaces/post';

import {
  isChainSpent, MAX_RENDERED_FEED_POSTS, mergeFeedPage
} from './use-feed-chain-page';

const post = (id: string) => ({ _id: id } as IPost);

describe('mergeFeedPage', () => {
  it('replaces on reset', () => {
    const result = mergeFeedPage([post('p1'), post('p2')], [post('p9')], 'reset');
    expect(result.posts.map((p) => p._id)).toEqual(['p9']);
    expect(result.added).toBe(1);
  });

  it('drops an id already on screen', () => {
    const result = mergeFeedPage([post('p1'), post('p2')], [post('p2'), post('p3')], 'append');
    expect(result.posts.map((p) => p._id)).toEqual(['p1', 'p2', 'p3']);
    expect(result.added).toBe(1);
  });

  /*
   * The 410-card defect. `deploy-2026-09-06h` keyed each entry by
   * `<cycle>:<id>` so a recycled chain could show the catalogue again; on a
   * 160-post corpus Home grew to 410 cards, openly repeating itself, because a
   * repeated post looked new to both this function and to React.
   */
  it('never appends a post that is already in the list, whatever the server sends', () => {
    const current = [post('p1'), post('p2'), post('p3')];
    const result = mergeFeedPage(current, [post('p1'), post('p2'), post('p3')], 'rollover');

    expect(result.posts).toBe(current);
    expect(result.added).toBe(0);
  });

  it('de-duplicates within a single page too', () => {
    const result = mergeFeedPage([], [post('p1'), post('p1'), post('p2')], 'reset');
    expect(result.posts.map((p) => p._id)).toEqual(['p1', 'p2']);
  });

  it('keeps the accumulated list free of duplicate ids across many pages', () => {
    // What the Home acceptance measures: rendered count == unique count.
    let posts: IPost[] = [];
    for (let page = 0; page < 12; page += 1) {
      const incoming = Array.from({ length: 20 }, (_, i) => post(`p${(page * 20 + i) % 160}`));
      posts = mergeFeedPage(posts, incoming, page === 0 ? 'reset' : 'append').posts;
    }
    const ids = posts.map((p) => p._id);
    expect(ids.length).toBe(new Set(ids).size);
    expect(ids.length).toBe(160);
  });

  it('returns the same array reference when nothing was added', () => {
    const current = [post('p1')];
    const result = mergeFeedPage(current, [post('p1')], 'append');
    expect(result.posts).toBe(current);
    expect(result.added).toBe(0);
  });
});

describe('isChainSpent', () => {
  /*
   * The stop condition is the server's answer, never the client's bookkeeping.
   * `06g` inferred it from client de-duplication and ended Home at 89 of 160;
   * `06h` replaced that with recycling and never ended at all.
   */
  it('is true when the server reports the chain exhausted', () => {
    expect(isChainSpent({ data: [post('p1')], hasMore: false, chainExhausted: true }, 'rollover')).toBe(true);
    expect(isChainSpent({ data: [], hasMore: false, chainExhausted: true }, 'append')).toBe(true);
  });

  it('is true for a rollover that returned nothing at all', () => {
    expect(isChainSpent({ data: [], hasMore: false }, 'rollover')).toBe(true);
  });

  it('is false for a rollover that returned posts the client happens to hold', () => {
    // The client de-duplicates them away, but that is not the server saying the
    // catalogue is finished — inferring it here is the 89-post defect.
    expect(isChainSpent({ data: [post('p1')], hasMore: false }, 'rollover')).toBe(false);
  });

  it('is false for an ordinary page, however empty', () => {
    expect(isChainSpent({ data: [], hasMore: false }, 'append')).toBe(false);
    expect(isChainSpent({ data: [], hasMore: false }, 'reset')).toBe(false);
  });
});

describe('MAX_RENDERED_FEED_POSTS', () => {
  it('is a DOM guard above one pass of this catalogue, not a feed limit', () => {
    // 160 posts is the measured-safe render size (rules/user.md). A chain ends
    // when it has served every eligible post, so this is unreachable here.
    expect(MAX_RENDERED_FEED_POSTS).toBeGreaterThan(160);
  });
});
