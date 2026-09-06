import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import { IPost } from '@interfaces/post';
import { __clearPostInteractionListenersForTest, publishPostInteraction } from '@lib/post-interaction-bus';

import { useCreatorVideos } from './use-creator-videos';
import { usePostInteractionState, usePostInteractionUpdater } from './use-post-interactions';
import { usePostViewerStateHydration } from './use-post-viewer-state';

/**
 * The three production bugs that shared one cause: **many independent copies of
 * the same post, and an update that reached exactly one of them**.
 *
 * Twelve hooks own an `IPost[]`; `usePostInteractionState` owns a thirteenth
 * for whichever post is open. There is one `IPost` shape and one `PostDto`
 * behind it, so the copies were compatible — what was missing was any way for a
 * change to reach more than the list that happened to supply the callback.
 */

const mockGetCreatorPosts = jest.fn();
const mockFindOne = jest.fn();

jest.mock('@services/post.service', () => ({
  getCreatorPosts: (...args: any[]) => mockGetCreatorPosts(...args),
  findOne: (...args: any[]) => mockFindOne(...args)
}));

const post = (id: string, overrides: Partial<IPost> = {}) => ({
  _id: id,
  type: 'video',
  user: { _id: 'creator-1', username: 'creator-1' },
  totalLike: 10,
  totalComment: 0,
  totalShare: 0,
  isLiked: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...overrides
} as unknown as IPost);

beforeEach(() => {
  __clearPostInteractionListenersForTest();
  mockGetCreatorPosts.mockReset();
  mockFindOne.mockReset();
});

// ---------------------------------------------------------------- BUG 2
describe('a like reaches every mounted copy of the post', () => {
  let detail: ReturnType<typeof usePostInteractionState>;
  let listA: IPost[] = [];
  let listB: IPost[] = [];

  function Probe({ openPost }: { openPost: IPost }) {
    const [a, setA] = React.useState<IPost[]>([post('p1'), post('p2')]);
    const [b, setB] = React.useState<IPost[]>([post('p1'), post('p9')]);
    const updateA = usePostInteractionUpdater(setA);
    usePostInteractionUpdater(setB);
    detail = usePostInteractionState(openPost, updateA);
    listA = a;
    listB = b;
    return null;
  }

  it('updates the list that opened the post AND every other list holding it', async () => {
    render(<Probe openPost={post('p1')} />);

    act(() => {
      detail.handleLikeChange(true, 11);
    });

    await waitFor(() => expect(detail.totalLike).toBe(11));
    expect(detail.isLiked).toBe(true);
    // The list the modal was opened from...
    expect(listA.find((p) => p._id === 'p1')?.totalLike).toBe(11);
    expect(listA.find((p) => p._id === 'p1')?.isLiked).toBe(true);
    // ...and the *other* one, which is the case that shipped broken: the
    // creator "Videos" card kept the old total beside the modal that changed.
    expect(listB.find((p) => p._id === 'p1')?.totalLike).toBe(11);
    expect(listB.find((p) => p._id === 'p1')?.isLiked).toBe(true);
    // Untouched posts stay untouched.
    expect(listA.find((p) => p._id === 'p2')?.totalLike).toBe(10);
    expect(listB.find((p) => p._id === 'p9')?.totalLike).toBe(10);
  });

  it('unlikes everywhere too', async () => {
    render(<Probe openPost={post('p1', { isLiked: true, totalLike: 11 })} />);

    act(() => {
      detail.handleLikeChange(false, 10);
    });

    await waitFor(() => expect(detail.isLiked).toBe(false));
    expect(listA.find((p) => p._id === 'p1')?.isLiked).toBe(false);
    expect(listB.find((p) => p._id === 'p1')?.isLiked).toBe(false);
    expect(listB.find((p) => p._id === 'p1')?.totalLike).toBe(10);
  });

  /*
   * Every field of a patch is absolute — `totalLike: 11`, never `+1` — so an
   * optimistic like and the websocket snapshot describing the same change
   * assign the same number instead of counting twice.
   */
  it('does not double-count when the same change arrives twice', async () => {
    render(<Probe openPost={post('p1')} />);

    act(() => {
      detail.handleLikeChange(true, 11);
    });
    await waitFor(() => expect(detail.totalLike).toBe(11));

    act(() => {
      // The realtime snapshot for the same like, arriving after.
      publishPostInteraction('p1', { totalLike: 11, totalComment: 0, totalShare: 0 });
    });

    expect(detail.totalLike).toBe(11);
    expect(listA.find((p) => p._id === 'p1')?.totalLike).toBe(11);
    expect(listB.find((p) => p._id === 'p1')?.totalLike).toBe(11);
  });

  it('applies a change published by another surface to the open post', async () => {
    render(<Probe openPost={post('p1')} />);

    act(() => {
      publishPostInteraction('p1', { isLiked: true, totalLike: 42 });
    });

    await waitFor(() => expect(detail.totalLike).toBe(42));
    expect(detail.isLiked).toBe(true);
  });
});

// ---------------------------------------------------------------- BUG 3
describe('the creator Videos tab survives close and reopen', () => {
  let videos: ReturnType<typeof useCreatorVideos>;

  function Probe({ userId, currentPost, enabled }: {
    userId?: string; currentPost: IPost | null; enabled: boolean;
  }) {
    videos = useCreatorVideos({ userId, currentPost, enabled });
    return null;
  }

  const creatorPage = (ids: string[], hasMore = false) => ({
    data: {
      data: ids.map((id) => post(id)),
      hasMore,
      nextCursor: hasMore ? { id: ids[ids.length - 1], createdAt: '2026-09-01T00:00:00.000Z' } : null
    }
  });

  it('keeps the full list when the modal is closed and reopened on the same creator', async () => {
    mockGetCreatorPosts.mockResolvedValue(creatorPage(['p1', 'p2', 'p3', 'p4', 'p5']));

    const { rerender } = render(
      <Probe userId="creator-1" currentPost={post('p1')} enabled />
    );
    await waitFor(() => expect(videos.posts).toHaveLength(5));

    // Back button: the modal closes, so there is no open post any more.
    rerender(<Probe userId={undefined} currentPost={null} enabled={false} />);
    expect(videos.posts).toHaveLength(0);

    // Reopen the same creator. Previously this took the "already loaded" branch
    // over an array that close() had emptied, leaving exactly one video and
    // "All videos loaded".
    mockGetCreatorPosts.mockClear();
    rerender(<Probe userId="creator-1" currentPost={post('p3')} enabled />);

    await waitFor(() => expect(videos.posts).toHaveLength(5));
    expect(videos.posts.map((p) => p._id).sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('keeps each creator cached separately', async () => {
    mockGetCreatorPosts.mockImplementation((creatorId: string) => Promise.resolve(
      creatorId === 'creator-1'
        ? creatorPage(['p1', 'p2', 'p3'])
        : creatorPage(['q1', 'q2'])
    ));

    const { rerender } = render(<Probe userId="creator-1" currentPost={post('p1')} enabled />);
    await waitFor(() => expect(videos.posts).toHaveLength(3));

    rerender(
      <Probe
        userId="creator-2"
        currentPost={post('q1', { user: { _id: 'creator-2', username: 'creator-2' } as any })}
        enabled
      />
    );
    await waitFor(() => expect(videos.posts.map((p) => p._id).sort()).toEqual(['q1', 'q2']));

    rerender(<Probe userId="creator-1" currentPost={post('p2')} enabled />);
    await waitFor(() => expect(videos.posts).toHaveLength(3));
    expect(videos.posts.map((p) => p._id).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('keeps pagination valid after a close and reopen', async () => {
    mockGetCreatorPosts.mockResolvedValue(creatorPage(['p1', 'p2'], true));

    const { rerender } = render(<Probe userId="creator-1" currentPost={post('p1')} enabled />);
    await waitFor(() => expect(videos.posts).toHaveLength(2));
    expect(videos.hasMore).toBe(true);

    rerender(<Probe userId={undefined} currentPost={null} enabled={false} />);
    rerender(<Probe userId="creator-1" currentPost={post('p1')} enabled />);
    await waitFor(() => expect(videos.posts).toHaveLength(2));

    // "All videos loaded" must reflect the creator's real pagination, not a
    // state left over from a close.
    expect(videos.hasMore).toBe(true);

    mockGetCreatorPosts.mockResolvedValueOnce(creatorPage(['p3', 'p4']));
    act(() => {
      videos.loadMore();
    });
    await waitFor(() => expect(videos.posts).toHaveLength(4));
  });

  it('reflects a like made elsewhere in the creator grid', async () => {
    mockGetCreatorPosts.mockResolvedValue(creatorPage(['p1', 'p2']));
    render(<Probe userId="creator-1" currentPost={post('p1')} enabled />);
    await waitFor(() => expect(videos.posts).toHaveLength(2));

    act(() => {
      publishPostInteraction('p1', { isLiked: true, totalLike: 11 });
    });

    await waitFor(() => expect(videos.posts.find((p) => p._id === 'p1')?.totalLike).toBe(11));
    expect(videos.posts.find((p) => p._id === 'p1')?.isLiked).toBe(true);
  });
});

// ---------------------------------------------------------------- BUG 4
describe('viewer state is hydrated whatever opened the modal', () => {
  let seen: { isLiked: boolean; totalLike: number } | null = null;

  function Probe({ postId }: { postId: string }) {
    usePostViewerStateHydration(postId);
    const [posts, setPosts] = React.useState<IPost[]>([post(postId)]);
    usePostInteractionUpdater(setPosts);
    seen = {
      isLiked: Boolean(posts[0].isLiked), totalLike: posts[0].totalLike
    };
    return null;
  }

  /*
   * `SearchService.searchAll` answered without the viewer, so `isLiked` came
   * back false beside a correct `totalLike` — an already-liked post opened from
   * Summary search with a white heart.
   */
  it('corrects a liked post that a listing reported as unliked', async () => {
    mockFindOne.mockResolvedValue({ data: { _id: 'p1', isLiked: true, totalLike: 10, totalComment: 0, totalShare: 0 } });

    render(<Probe postId="p1" />);

    await waitFor(() => expect(seen?.isLiked).toBe(true));
    expect(seen?.totalLike).toBe(10);
  });

  it('leaves an unliked post unliked', async () => {
    mockFindOne.mockResolvedValue({ data: { _id: 'p1', isLiked: false, totalLike: 10, totalComment: 0, totalShare: 0 } });

    render(<Probe postId="p1" />);
    await waitFor(() => expect(mockFindOne).toHaveBeenCalledWith('p1'));

    expect(seen?.isLiked).toBe(false);
  });

  it('asks once per post, not once per render', async () => {
    mockFindOne.mockResolvedValue({ data: { _id: 'p1', isLiked: true, totalLike: 10 } });

    const { rerender } = render(<Probe postId="p1" />);
    await waitFor(() => expect(seen?.isLiked).toBe(true));
    rerender(<Probe postId="p1" />);
    rerender(<Probe postId="p1" />);

    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  it('leaves the post alone when the request fails', async () => {
    mockFindOne.mockRejectedValue(new Error('offline'));

    render(<Probe postId="p1" />);
    await waitFor(() => expect(mockFindOne).toHaveBeenCalled());

    // A failed correction must never blank a heart or a counter.
    expect(seen?.isLiked).toBe(false);
    expect(seen?.totalLike).toBe(10);
  });

  it('ignores an answer for a different post', async () => {
    mockFindOne.mockResolvedValue({ data: { _id: 'somebody-else', isLiked: true, totalLike: 99 } });

    render(<Probe postId="p1" />);
    await waitFor(() => expect(mockFindOne).toHaveBeenCalled());

    expect(seen?.totalLike).toBe(10);
    expect(seen?.isLiked).toBe(false);
  });
});
