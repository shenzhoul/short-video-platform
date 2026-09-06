import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import { IPost } from '@interfaces/post';

import { usePostDetailMode } from './use-post-detail-mode';
import { usePostDetailSequence } from './use-post-detail-sequence';

/**
 * The popup's navigation state machine, and the one thing that must never
 * drift: **the visible tab and the navigation source**.
 *
 * ```
 * Videos tab OPEN    -> mode 'creator'        -> next/previous walk that creator
 * any other tab OPEN -> mode 'locked'         -> next/previous do nothing
 * no tab OPEN        -> mode 'recommendation' -> next/previous walk the feed given to the modal
 * ```
 *
 * There is exactly one derivation (`usePostDetailMode`), it is a pure function
 * of the open tab, and `usePostDetailSequence` picks its list from it. No
 * second boolean, no ref holding the creator playlist past the close.
 */

const mockGetCreatorPosts = jest.fn();
jest.mock('@services/post.service', () => ({
  getCreatorPosts: (...args: any[]) => mockGetCreatorPosts(...args),
  findOne: jest.fn()
}));

/**
 * `createdAt` is distinct per post on purpose: `creator-post-order.ts` sorts
 * `isPinned`, `pinnedAt`, `createdAt`, `_id` — all descending — so identical
 * timestamps would leave the order decided by id, which is not what the grid
 * shows.
 */
const CREATED_AT: Record<string, string> = {
  r1: '2026-09-05T00:00:00.000Z',
  r2: '2026-09-04T00:00:00.000Z',
  r3: '2026-09-03T00:00:00.000Z',
  c2: '2026-09-02T00:00:00.000Z',
  c3: '2026-09-01T00:00:00.000Z',
  d2: '2026-08-31T00:00:00.000Z'
};

const post = (id: string, creatorId: string) => ({
  _id: id,
  type: 'video',
  user: { _id: creatorId, username: creatorId },
  files: [{ type: 'video/mp4', url: `https://media.test/${id}.mp4` }],
  totalLike: 0,
  createdAt: CREATED_AT[id] || '2026-09-01T00:00:00.000Z'
} as unknown as IPost);

/** The recommendation detail session behind the modal — a mix of creators. */
const recommendationFeed = [
  post('r1', 'creator-a'),
  post('r2', 'creator-b'),
  post('r3', 'creator-c')
];

/** That one creator's own catalogue. */
const creatorCatalogue = [
  post('r1', 'creator-a'),
  post('c2', 'creator-a'),
  post('c3', 'creator-a')
];

beforeEach(() => {
  mockGetCreatorPosts.mockReset();
  mockGetCreatorPosts.mockResolvedValue({
    data: { data: creatorCatalogue, hasMore: false, nextCursor: null }
  });
});

describe('usePostDetailMode', () => {
  let mode: ReturnType<typeof usePostDetailMode>;

  function Probe({ openPost, panelTab }: { openPost: IPost; panelTab: string | null }) {
    mode = usePostDetailMode({ post: openPost, panelTab, source: 'home-feed' });
    return null;
  }

  it('is recommendation with no tab open', () => {
    render(<Probe openPost={post('r1', 'creator-a')} panelTab={null} />);
    expect(mode).toEqual({ mode: 'recommendation', creatorId: null });
  });

  it('is creator while the Videos tab is open, capturing that creator', () => {
    render(<Probe openPost={post('r1', 'creator-a')} panelTab="videos" />);
    expect(mode.mode).toBe('creator');
    expect(mode.creatorId).toBe('creator-a');
  });

  it('is locked for any other tab', () => {
    render(<Probe openPost={post('r1', 'creator-a')} panelTab="comments" />);
    expect(mode).toEqual({ mode: 'locked', creatorId: null });
  });

  it('returns to recommendation and drops the creator the moment Videos closes', () => {
    const { rerender } = render(<Probe openPost={post('r1', 'creator-a')} panelTab="videos" />);
    expect(mode.creatorId).toBe('creator-a');

    // The large Back button and the avatar toggle both do exactly this.
    rerender(<Probe openPost={post('c3', 'creator-a')} panelTab={null} />);

    expect(mode.mode).toBe('recommendation');
    expect(mode.creatorId).toBeNull();
  });

  it('captures the new creator when Videos reopens on a different one', () => {
    const { rerender } = render(<Probe openPost={post('r1', 'creator-a')} panelTab="videos" />);
    expect(mode.creatorId).toBe('creator-a');

    rerender(<Probe openPost={post('r1', 'creator-a')} panelTab={null} />);
    rerender(<Probe openPost={post('r2', 'creator-b')} panelTab="videos" />);

    expect(mode.mode).toBe('creator');
    expect(mode.creatorId).toBe('creator-b');
  });
});

describe('the sequence follows the mode, and nothing else', () => {
  let sequence: ReturnType<typeof usePostDetailSequence>;

  function Probe({ openPost, panelTab }: { openPost: IPost; panelTab: string | null }) {
    const { mode, creatorId } = usePostDetailMode({ post: openPost, panelTab, source: 'home-feed' });
    sequence = usePostDetailSequence({
      post: openPost,
      feedPosts: recommendationFeed,
      mode,
      creatorId,
      onNavigate: jest.fn()
    });
    return null;
  }

  /** Scenario 1 — popup opened normally. */
  it('walks the recommendation feed with no tab open', () => {
    render(<Probe openPost={post('r1', 'creator-a')} panelTab={null} />);

    expect(sequence.navigationPosts.map((p) => p._id)).toEqual(['r1', 'r2', 'r3']);
    expect(sequence.creatorScope).toBe(false);
    expect(mockGetCreatorPosts).not.toHaveBeenCalled();
  });

  /** Scenario 2 — Videos open. */
  it('walks that creator with the Videos tab open', async () => {
    render(<Probe openPost={post('r1', 'creator-a')} panelTab="videos" />);

    await waitFor(() => expect(sequence.navigationPosts).toHaveLength(3));
    expect(sequence.navigationPosts.map((p) => p._id)).toEqual(['r1', 'c2', 'c3']);
    expect(sequence.creatorScope).toBe(true);
  });

  /** Scenarios 3, 5 and 6 — Back, the avatar toggle, or any close. */
  it('returns to the recommendation feed when Videos closes, wherever the viewer got to', async () => {
    const { rerender } = render(<Probe openPost={post('r1', 'creator-a')} panelTab="videos" />);
    await waitFor(() => expect(sequence.navigationPosts).toHaveLength(3));

    // Several creator videos in, then the tab closes and navigation returns to
    // the post it was opened from.
    rerender(<Probe openPost={post('c3', 'creator-a')} panelTab={null} />);
    rerender(<Probe openPost={post('r1', 'creator-a')} panelTab={null} />);

    expect(sequence.creatorScope).toBe(false);
    expect(sequence.navigationPosts.map((p) => p._id)).toEqual(['r1', 'r2', 'r3']);
    // The creator-only posts are gone from the sequence entirely — no stale
    // playlist surviving the close.
    expect(sequence.navigationPosts.some((p) => p._id === 'c2' || p._id === 'c3')).toBe(false);
    expect(sequence.nextPost?._id).toBe('r2');
  });

  /** Scenario 4 — reopening resumes creator navigation. */
  it('resumes creator navigation when Videos is opened again', async () => {
    const { rerender } = render(<Probe openPost={post('r1', 'creator-a')} panelTab="videos" />);
    await waitFor(() => expect(sequence.navigationPosts).toHaveLength(3));

    rerender(<Probe openPost={post('r1', 'creator-a')} panelTab={null} />);
    expect(sequence.creatorScope).toBe(false);

    rerender(<Probe openPost={post('r1', 'creator-a')} panelTab="videos" />);
    await waitFor(() => expect(sequence.creatorScope).toBe(true));
    expect(sequence.navigationPosts.map((p) => p._id)).toEqual(['r1', 'c2', 'c3']);
  });

  /** Scenario 7 — a different creator. */
  it('switches creator scope cleanly', async () => {
    const { rerender } = render(<Probe openPost={post('r1', 'creator-a')} panelTab="videos" />);
    await waitFor(() => expect(sequence.navigationPosts).toHaveLength(3));

    mockGetCreatorPosts.mockResolvedValue({
      data: {
        data: [post('r2', 'creator-b'), post('d2', 'creator-b')], hasMore: false, nextCursor: null
      }
    });
    rerender(<Probe openPost={post('r1', 'creator-a')} panelTab={null} />);
    rerender(<Probe openPost={post('r2', 'creator-b')} panelTab="videos" />);

    await waitFor(() => expect(sequence.navigationPosts.map((p) => p._id)).toEqual(['r2', 'd2']));
    // Never a mix: creator scope drops anything not belonging to the captured
    // creator, whatever the response held.
    expect(sequence.navigationPosts.every((p) => p.user?._id === 'creator-b')).toBe(true);
  });

  it('navigates nothing while a non-Videos tab is open', () => {
    render(<Probe openPost={post('r1', 'creator-a')} panelTab="comments" />);

    expect(sequence.navigationPosts).toEqual([]);
    expect(sequence.nextPost).toBeNull();
    expect(sequence.previousPost).toBeNull();
  });
});
