import { act, render, waitFor } from '@testing-library/react';

const feedHook = jest.fn();

jest.mock('@hooks/use-home-feed-infinite-scroll', () => ({
  useHomeFeedInfiniteScroll: (options: any) => {
    feedHook(options);
    return {
      // One post keeps HomeFeed out of its empty-state early return, which would otherwise never
      // render the category bar this test drives.
      posts: [{ _id: 'post-1', type: 'video', files: [] }],
      hasMore: false,
      loading: false,
      loadMore: jest.fn(),
      error: null,
      updatePostInteraction: jest.fn()
    };
  }
}));

jest.mock('@hooks/use-home-feed-playback', () => ({
  useHomeFeedPlayback: () => ({
    activePostId: null,
    setActivePostId: jest.fn(),
    modalPost: null,
    closeModal: jest.fn(),
    openModal: jest.fn()
  })
}));

jest.mock('@services/search.service', () => ({
  getPostTopics: jest.fn()
}));

jest.mock('./home-feed-card', () => ({
  __esModule: true,
  default: () => null
}));

jest.mock('./post-detail-modal', () => ({
  __esModule: true,
  default: () => null
}));

jest.mock('react-infinite-scroll-component', () => ({
  __esModule: true,
  default: ({ children }: any) => children
}));

import { getPostTopics } from '@services/search.service';

import HomeFeed from './home-feed';

const mockedGetPostTopics = getPostTopics as jest.MockedFunction<typeof getPostTopics>;

const TTL_MS = 5 * 60 * 1000;

const topics = (...keys: string[]) => ({
  data: keys.map((key) => ({ key, label: key.toUpperCase() }))
});

const lastFeedOptions = () => feedHook.mock.calls[feedHook.mock.calls.length - 1][0];

/**
 * End to end for the one case dynamic categories introduced: the person has a category selected and
 * an admin disables it.
 *
 * The API answers a disabled `topicKey` with the unfiltered feed rather than an error, so nothing
 * server-side can tell them their filter is gone. The bar and the feed have to agree, and the stale
 * key must stop being sent.
 */
describe('HomeFeed with a retired category selected', () => {
  let now = Date.now();

  const advancePastTtl = () => {
    now += TTL_MS + 1;
  };

  beforeEach(() => {
    feedHook.mockClear();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    advancePastTtl();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const selectTravel = async () => {
    const view = render(<HomeFeed initialData={null} />);
    await waitFor(() => expect(mockedGetPostTopics).toHaveBeenCalled());

    const travel = await waitFor(() => {
      const buttons = Array.from(view.container.querySelectorAll('button'));
      const match = buttons.find((element) => element.textContent === 'TRAVEL');
      if (!match) throw new Error(`travel chip not rendered; found: ${buttons.map((b) => b.textContent).join(' | ')}`);
      return match;
    });

    act(() => {
      travel.click();
    });

    await waitFor(() => expect(lastFeedOptions().topicKey).toBe('travel'));
    return view;
  };

  it('clears the selection and stops sending the key once a refetch confirms it is gone', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel', 'games') as any);
    await selectTravel();

    mockedGetPostTopics.mockResolvedValue(topics('games') as any);
    advancePastTtl();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // The feed hook is re-invoked with no topic, which is what makes it reload the unfiltered
    // first page — and no later render may put the stale key back.
    await waitFor(() => expect(lastFeedOptions().topicKey).toBe(''));
    expect(lastFeedOptions().topicKey).toBe('');
  });

  it('keeps the selection when the category is still offered', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel', 'games') as any);
    const view = await selectTravel();

    mockedGetPostTopics.mockResolvedValue(topics('travel', 'games', 'music') as any);
    advancePastTtl();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    // The new category appearing in the bar is the proof the refetch landed.
    await waitFor(() => expect(
      Array.from(view.container.querySelectorAll('button')).map((element) => element.textContent)
    ).toContain('MUSIC'));
    expect(lastFeedOptions().topicKey).toBe('travel');
  });

  it('keeps the selection when the refetch fails and the list is only stale', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel', 'games') as any);
    await selectTravel();

    const callsBeforeFocus = mockedGetPostTopics.mock.calls.length;
    mockedGetPostTopics.mockRejectedValue(new Error('network down'));
    advancePastTtl();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(mockedGetPostTopics.mock.calls.length).toBeGreaterThan(callsBeforeFocus));
    expect(lastFeedOptions().topicKey).toBe('travel');
  });
});
