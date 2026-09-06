'use client';

import { IPost } from '@interfaces/post';

/**
 * The shared shape of a ranked feed page, and the rules for accumulating one.
 *
 * Home and For You keep their own rankers, their own candidate sources and
 * their own session sizes — none of that is here. What they share is the
 * *browsing chain* bookkeeping: which chain a request belongs to, which cycle
 * a post arrived in, and when a scroll has genuinely reached the end. That is
 * the only thing this module owns.
 */
export interface FeedChainPage {
  data: IPost[];
  hasMore: boolean;
  sessionId?: string;
  nextCursor?: string | null;
  /** The chain the server used. Echoed back on every subsequent request. */
  chainId?: string | null;
  /** Which pass through the catalogue ranked this page. Increments on a recycle. */
  cycle?: number;
  total?: number;
}

/** How a page was asked for, which decides how its posts are merged. */
export type FeedFetchMode = 'reset' | 'append' | 'rollover';

/**
 * Ceiling on how many cards one browse keeps mounted.
 *
 * Recycling makes the feed effectively endless, so something has to bound the
 * DOM. 400 is well above the point a visitor stops scrolling and comfortably
 * above one full pass of this catalogue, and it is a *rendering* bound — it
 * says nothing about the corpus, and the UI must not describe reaching it as
 * "you have seen everything".
 *
 * Chosen against the measurements in rules/user.md: 160 cards is 4,176 DOM
 * nodes and 0ms of long tasks with painting suppressed, and virtualising the
 * list was measured 3-8x *slower*. So the fix for a long feed is a ceiling,
 * not a window.
 */
export const MAX_RENDERED_FEED_POSTS = 400;

/**
 * Give a post its render key for this cycle.
 *
 * A chain that has served every eligible post recycles and starts a new cycle,
 * so the same post can legitimately appear again further down. Two React
 * children may not share a key, and `_id` alone would collide.
 */
export function withFeedKey(post: IPost, cycle: number): IPost {
  return { ...post, feedKey: cycle > 0 ? `${cycle}:${post._id}` : post._id };
}

/**
 * Merge an incoming page into the accumulated list.
 *
 * De-duplication is by `feedKey`, not `_id`: within one cycle a post appears
 * once, across cycles it may appear again. `reset` replaces; everything else
 * appends.
 */
export function mergeFeedPage(current: IPost[], incoming: IPost[], mode: FeedFetchMode): {
  posts: IPost[];
  added: number;
} {
  if (mode === 'reset') return { posts: incoming, added: incoming.length };

  const known = new Set(current.map((post) => post.feedKey || post._id));
  const fresh = incoming.filter((post) => !known.has(post.feedKey || post._id));
  if (!fresh.length) return { posts: current, added: 0 };

  return { posts: [...current, ...fresh], added: fresh.length };
}

/**
 * Whether the scroll has genuinely finished.
 *
 * Read from the **server's** answer — a rollover that returned no post at all —
 * and never from "the client had nothing new to add". That distinction is what
 * broke in `deploy-2026-09-06g`: a rollover answering with posts the client
 * already held was reported as an exhausted catalogue, so Home stopped at 89 of
 * 160 with the message "This session's recommendations are exhausted".
 *
 * With chain recycling in place the server only returns an empty page when
 * nothing at all is eligible for this subject, which is the one case where
 * stopping is honest.
 */
export function isChainSpent(page: FeedChainPage, mode: FeedFetchMode): boolean {
  return mode === 'rollover' && (page.data || []).length === 0;
}
