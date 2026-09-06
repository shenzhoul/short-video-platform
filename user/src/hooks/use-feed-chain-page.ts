'use client';

import { IPost } from '@interfaces/post';

/**
 * The shared shape of a ranked feed page, and the rules for accumulating one.
 *
 * Home and For You keep their own rankers, their own candidate sources and
 * their own session sizes — none of that is here. What they share is the
 * *browsing chain* bookkeeping: which chain a request belongs to, and when a
 * scroll has genuinely reached the end.
 */
export interface FeedChainPage {
  data: IPost[];
  hasMore: boolean;
  sessionId?: string;
  nextCursor?: string | null;
  /** The chain the server used. Echoed back on every subsequent request. */
  chainId?: string | null;
  /**
   * This browse has served every eligible post. The server says so; the client
   * never infers it.
   */
  chainExhausted?: boolean;
  total?: number;
}

/** How a page was asked for, which decides how its posts are merged. */
export type FeedFetchMode = 'reset' | 'append' | 'rollover';

/**
 * Ceiling on how many cards one browse keeps mounted.
 *
 * A pure DOM guard for a catalogue far larger than this one — a chain ends when
 * it has served every eligible post, so on the current corpus it is unreachable.
 * It is a *rendering* bound and says nothing about the catalogue, which is why
 * the end-of-feed copy names the two cases differently.
 *
 * Chosen against the measurements in rules/user.md: 160 cards is 4,176 DOM
 * nodes and 0ms of long tasks with painting suppressed, and virtualising the
 * list was measured 3-8x *slower*. So the answer to a long feed is a ceiling,
 * not a window.
 */
export const MAX_RENDERED_FEED_POSTS = 400;

/**
 * Merge an incoming page into the accumulated list.
 *
 * **De-duplication is by real post id, across the whole chain.** A post already
 * on screen is never appended again, whatever the server sends.
 *
 * The previous version keyed each entry by `<cycle>:<id>` so that a *recycled*
 * chain could show the catalogue a second time. It worked exactly as designed
 * and the design was wrong: with a 160-post corpus, Home grew to **410 cards**,
 * openly repeating itself, because a recycled post looked like a new one to
 * both this function and to React. Recycling is gone from the server, and this
 * is the guard that makes a stray repeat impossible rather than merely unlikely.
 */
export function mergeFeedPage(current: IPost[], incoming: IPost[], mode: FeedFetchMode): {
  posts: IPost[];
  added: number;
} {
  if (mode === 'reset') {
    const deduped: IPost[] = [];
    const seen = new Set<string>();
    incoming.forEach((post) => {
      if (seen.has(post._id)) return;
      seen.add(post._id);
      deduped.push(post);
    });
    return { posts: deduped, added: deduped.length };
  }

  const known = new Set(current.map((post) => post._id));
  const fresh: IPost[] = [];
  incoming.forEach((post) => {
    if (known.has(post._id)) return;
    known.add(post._id);
    fresh.push(post);
  });
  if (!fresh.length) return { posts: current, added: 0 };

  return { posts: [...current, ...fresh], added: fresh.length };
}

/**
 * Whether the browse has genuinely finished.
 *
 * Read from the **server's** answer — `chainExhausted`, or a rollover that
 * returned nothing — and never from "the client had nothing new to add". That
 * distinction broke twice:
 *
 * - `06g` inferred it from the client's own de-duplication, so a rollover
 *   answering with posts already on screen ended Home at 89 of 160;
 * - `06h` fixed that by recycling instead, which never ended at all and let the
 *   same 160 posts render 410 times over.
 *
 * The server now reports exhaustion explicitly, and the browse stops there.
 * Starting again is the viewer's decision — "Refresh recommendations" or a
 * reload — and both mint a new chain.
 */
export function isChainSpent(page: FeedChainPage, mode: FeedFetchMode): boolean {
  if (page.chainExhausted) return true;
  return mode === 'rollover' && (page.data || []).length === 0;
}
