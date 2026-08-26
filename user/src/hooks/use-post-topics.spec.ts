import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('@services/search.service', () => ({
  getPostTopics: jest.fn()
}));

import { getPostTopics } from '@services/search.service';

import { isTopicKeyRetired, usePostTopics, usePostTopicsCatalogue } from './use-post-topics';

const mockedGetPostTopics = getPostTopics as jest.MockedFunction<typeof getPostTopics>;

const TTL_MS = 5 * 60 * 1000;

const topics = (...keys: string[]) => ({
  data: keys.map((key) => ({ key, label: key.toUpperCase() }))
});

/**
 * The catalogue is admin-editable now, so the client cannot hold it for the life of the tab. These
 * pin the two things that has to mean: a bounded cache, and a refetch when a backgrounded tab comes
 * back to a catalogue that has since changed.
 *
 * The cache lives in module scope, so every test starts by aging it past its TTL rather than by
 * reloading the module — re-requiring the hook would give it a second copy of React and break
 * rendering entirely.
 *
 * Time is moved by stubbing `Date.now` rather than with fake timers: the hook compares timestamps,
 * and real timers are what let `waitFor` observe the refetch resolving.
 */
describe('usePostTopics', () => {
  let now = Date.now();

  const advancePastTtl = () => {
    now += TTL_MS + 1;
  };

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    advancePastTtl();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches the catalogue on mount when the cache is stale', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel', 'food') as any);

    const { result } = renderHook(() => usePostTopics());

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current[0]).toEqual({ key: 'travel', label: 'TRAVEL' });
    expect(mockedGetPostTopics).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached catalogue across mounts inside the TTL', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel') as any);

    const first = renderHook(() => usePostTopics());
    await waitFor(() => expect(first.result.current).toHaveLength(1));
    first.unmount();

    const second = renderHook(() => usePostTopics());
    await waitFor(() => expect(second.result.current).toHaveLength(1));

    expect(mockedGetPostTopics).toHaveBeenCalledTimes(1);
  });

  it('refetches on the next mount once the cache has aged past its TTL', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel') as any);

    const first = renderHook(() => usePostTopics());
    await waitFor(() => expect(first.result.current).toHaveLength(1));
    first.unmount();

    // An admin adds a category while the tab is open.
    mockedGetPostTopics.mockResolvedValue(topics('travel', 'street-food') as any);
    advancePastTtl();

    const second = renderHook(() => usePostTopics());

    await waitFor(() => expect(second.result.current).toHaveLength(2));
    expect(mockedGetPostTopics).toHaveBeenCalledTimes(2);
    expect(second.result.current.map((topic) => topic.key)).toEqual(['travel', 'street-food']);
  });

  it('picks up an admin change when a stale tab regains focus', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel', 'games') as any);

    const { result } = renderHook(() => usePostTopics());
    await waitFor(() => expect(result.current).toHaveLength(2));

    // The admin disables one category while this tab sits in the background.
    mockedGetPostTopics.mockResolvedValue(topics('travel') as any);
    advancePastTtl();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].key).toBe('travel');
  });

  it('does not refetch on focus while the cache is still fresh', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel') as any);

    const { result } = renderHook(() => usePostTopics());
    await waitFor(() => expect(result.current).toHaveLength(1));

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(mockedGetPostTopics).toHaveBeenCalledTimes(1);
  });

  it('keeps the list it already had when a refetch fails, rather than blanking the picker', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel', 'games') as any);

    const { result } = renderHook(() => usePostTopics());
    await waitFor(() => expect(result.current).toHaveLength(2));

    mockedGetPostTopics.mockRejectedValue(new Error('network down'));
    advancePastTtl();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(mockedGetPostTopics).toHaveBeenCalledTimes(2));
    expect(result.current.map((topic) => topic.key)).toEqual(['travel', 'games']);
  });

  it('ignores a response that is not a list instead of clearing the picker', async () => {
    mockedGetPostTopics.mockResolvedValue(topics('travel') as any);

    const { result } = renderHook(() => usePostTopics());
    await waitFor(() => expect(result.current).toHaveLength(1));

    mockedGetPostTopics.mockResolvedValue({ data: null } as any);
    advancePastTtl();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(mockedGetPostTopics).toHaveBeenCalledTimes(2));
    expect(result.current).toHaveLength(1);
  });

  /**
   * `loadedAt` is what lets the home feed tell "the admin removed this category" apart from "the
   * request has not landed" and from "the refetch failed". These drive it through the real TTL and
   * focus paths, then assert the verdict the feed acts on.
   */
  describe('loadedAt and retired-key detection', () => {
    it('advances loadedAt on a successful refetch and reports the removed key as retired', async () => {
      mockedGetPostTopics.mockResolvedValue(topics('travel', 'games') as any);

      const { result } = renderHook(() => usePostTopicsCatalogue());
      await waitFor(() => expect(result.current.topics).toHaveLength(2));
      const firstLoadedAt = result.current.loadedAt;
      expect(firstLoadedAt).toBeGreaterThan(0);
      expect(isTopicKeyRetired('travel', result.current)).toBe(false);

      // The admin disables `travel` while this tab sits in the background.
      mockedGetPostTopics.mockResolvedValue(topics('games') as any);
      advancePastTtl();
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });

      await waitFor(() => expect(result.current.topics).toHaveLength(1));
      expect(result.current.loadedAt).toBeGreaterThan(firstLoadedAt);
      expect(isTopicKeyRetired('travel', result.current)).toBe(true);
    });

    it('leaves loadedAt untouched when a refetch fails, so a stale key is not called retired', async () => {
      mockedGetPostTopics.mockResolvedValue(topics('travel', 'games') as any);

      const { result } = renderHook(() => usePostTopicsCatalogue());
      await waitFor(() => expect(result.current.topics).toHaveLength(2));
      const firstLoadedAt = result.current.loadedAt;

      mockedGetPostTopics.mockRejectedValue(new Error('network down'));
      advancePastTtl();
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });

      await waitFor(() => expect(mockedGetPostTopics).toHaveBeenCalledTimes(2));
      expect(result.current.loadedAt).toBe(firstLoadedAt);
      expect(isTopicKeyRetired('travel', result.current)).toBe(false);
    });
  });
});
