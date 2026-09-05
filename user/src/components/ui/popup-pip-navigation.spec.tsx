import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { openPopupPip, readPopupPipState, writePopupPipState } from '@lib/popup-pip';

import PopupPipPlayer from './popup-pip-player';

/**
 * Picture-in-picture next/previous.
 *
 * What this replaced: `openPopupPip(video, playlist)` was handed the Home
 * grid's video posts in **rendered order**, and next/previous stepped through
 * that array. So "next" was whichever card happened to sit below the one
 * playing — the DOM, not a recommendation — and closing the grid or scrolling
 * changed what "next" meant.
 *
 * It now walks a Post Detail recommendation session, the same anchor-based
 * sequence `useRecommendationDetailFeed` uses, asked for video posts only.
 */

const mockOpenSession = jest.fn();
const mockNext = jest.fn();
const mockFindOne = jest.fn();

jest.mock('@services/post.service', () => ({
  findOne: (...args: any[]) => mockFindOne(...args),
  openPostDetailRecommendationSession: (...args: any[]) => mockOpenSession(...args),
  stepPostDetailRecommendationNext: (...args: any[]) => mockNext(...args)
}));

jest.mock('@lib/recommendation-anonymous-id', () => ({
  getRecommendationAnonymousId: () => 'anon-test-subject'
}));

function videoPost(id: string, overrides: Record<string, any> = {}) {
  return {
    _id: id,
    type: 'video',
    text: `post ${id}`,
    user: { _id: `creator-${id}`, username: `creator-${id}` },
    files: [{ type: 'video/mp4', url: `https://media.test/${id}.mp4`, duration: 30 }],
    ...overrides
  };
}

function photoPost(id: string) {
  return {
    _id: id,
    type: 'photo',
    text: `photo ${id}`,
    user: { _id: `creator-${id}`, username: `creator-${id}` },
    files: [{ type: 'photo', url: `https://media.test/${id}.jpg` }]
  };
}

function openOn(post: any) {
  const { getPopupVideo } = jest.requireActual('@components/content/post/home-feed-media');
  openPopupPip(getPopupVideo(post));
}

const nextButton = () => screen.getByLabelText('Next video');
const previousButton = () => screen.getByLabelText('Previous video');

async function pressNext() {
  await act(async () => {
    fireEvent.click(nextButton());
  });
}

beforeEach(() => {
  window.localStorage.clear();
  // `openPopupPip` also opens the floating window; jsdom has no implementation
  // and would print a "not implemented" trace for every test in this file.
  window.open = jest.fn().mockReturnValue(null);
  mockOpenSession.mockReset();
  mockNext.mockReset();
  mockFindOne.mockReset();
  mockOpenSession.mockResolvedValue({ data: { sessionId: 'detail-session-1', postId: 'a' } });
  // jsdom has no media pipeline; play() rejecting is the normal path here.
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: () => Promise.reject(new Error('jsdom'))
  });
});

describe('PiP next', () => {
  /** Scenario 4: next is NOT the next Home DOM post. */
  it('asks the recommendation session rather than following any rendered order', async () => {
    openOn(videoPost('anchor'));
    mockNext.mockResolvedValue({ data: { postId: 'recommended' } });
    mockFindOne.mockResolvedValue({ data: videoPost('recommended') });

    render(<PopupPipPlayer />);
    await pressNext();

    expect(mockOpenSession).toHaveBeenCalledWith('anchor', 'anon-test-subject');
    expect(mockNext).toHaveBeenCalledWith('detail-session-1', 'anon-test-subject', true);
    expect(readPopupPipState()?.video.postId).toBe('recommended');
  });

  /** Scenario 7: only video posts are ever selected. */
  it('asks the server for video posts only, so a photo post can never be chosen', async () => {
    openOn(videoPost('anchor'));
    mockNext.mockResolvedValue({ data: { postId: 'recommended' } });
    mockFindOne.mockResolvedValue({ data: videoPost('recommended') });

    render(<PopupPipPlayer />);
    await pressNext();

    // The third argument is `videoOnly`. Filtering client-side instead would
    // mean asking again for each photo, and each ask burns a slot in the
    // session for good.
    expect(mockNext.mock.calls[0][2]).toBe(true);
  });

  it('skips a post that has no playable video and asks again', async () => {
    openOn(videoPost('anchor'));
    mockNext
      .mockResolvedValueOnce({ data: { postId: 'broken' } })
      .mockResolvedValueOnce({ data: { postId: 'good' } });
    mockFindOne.mockImplementation((id: string) => Promise.resolve({
      data: id === 'broken' ? photoPost('broken') : videoPost('good')
    }));

    render(<PopupPipPlayer />);
    await pressNext();

    expect(readPopupPipState()?.video.postId).toBe('good');
    expect(readPopupPipState()?.history.map((item) => item.postId)).toEqual(['anchor', 'good']);
  });

  /** Scenario 5: next never selects the post that is playing. */
  it('never lands on the post already playing, even if the server names it', async () => {
    openOn(videoPost('anchor'));
    mockNext
      .mockResolvedValueOnce({ data: { postId: 'anchor' } })
      .mockResolvedValueOnce({ data: { postId: 'other' } });
    mockFindOne.mockResolvedValue({ data: videoPost('other') });

    render(<PopupPipPlayer />);
    await pressNext();

    expect(readPopupPipState()?.video.postId).toBe('other');
    // It did not even fetch the repeat — the history check comes first.
    expect(mockFindOne).not.toHaveBeenCalledWith('anchor');
  });

  /** Scenario 8: repeated next distributes across the corpus. */
  it('walks distinct posts across repeated presses', async () => {
    openOn(videoPost('anchor'));
    const served = ['v1', 'v2', 'v3', 'v4', 'v5'];
    let index = 0;
    mockNext.mockImplementation(() => Promise.resolve({
      data: index < served.length ? { postId: served[index++] } : null
    }));
    mockFindOne.mockImplementation((id: string) => Promise.resolve({ data: videoPost(id) }));

    render(<PopupPipPlayer />);
    for (let step = 0; step < served.length; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await pressNext();
    }

    const history = readPopupPipState()!.history.map((item) => item.postId);
    expect(history).toEqual(['anchor', 'v1', 'v2', 'v3', 'v4', 'v5']);
    expect(new Set(history).size).toBe(history.length);
  });

  it('recycles deterministically to the start of its own history when the server runs out', async () => {
    openOn(videoPost('anchor'));
    mockNext
      .mockResolvedValueOnce({ data: { postId: 'v1' } })
      .mockResolvedValue({ data: null });
    mockFindOne.mockImplementation((id: string) => Promise.resolve({ data: videoPost(id) }));

    render(<PopupPipPlayer />);
    await pressNext();
    expect(readPopupPipState()?.video.postId).toBe('v1');

    await pressNext();

    // Back to the first thing this window played — the same sequence again in
    // the same order, rather than a random pick from posts just rejected.
    const state = readPopupPipState()!;
    expect(state.video.postId).toBe('anchor');
    expect(state.historyIndex).toBe(0);
    expect(state.exhausted).toBe(true);
  });

  it('leaves the state alone when the request fails, so the next press retries', async () => {
    openOn(videoPost('anchor'));
    mockNext.mockRejectedValue(new Error('offline'));

    render(<PopupPipPlayer />);
    await pressNext();

    expect(readPopupPipState()?.video.postId).toBe('anchor');
    expect(readPopupPipState()?.exhausted).toBe(false);
  });
});

describe('PiP previous', () => {
  /** Scenario 6: previous follows PiP history. */
  it('replays what this window actually showed, in reverse, without asking the server', async () => {
    openOn(videoPost('anchor'));
    mockNext
      .mockResolvedValueOnce({ data: { postId: 'v1' } })
      .mockResolvedValueOnce({ data: { postId: 'v2' } });
    mockFindOne.mockImplementation((id: string) => Promise.resolve({ data: videoPost(id) }));

    render(<PopupPipPlayer />);
    await pressNext();
    await pressNext();
    expect(readPopupPipState()?.video.postId).toBe('v2');

    const callsBefore = mockNext.mock.calls.length;
    await act(async () => { fireEvent.click(previousButton()); });
    expect(readPopupPipState()?.video.postId).toBe('v1');

    await act(async () => { fireEvent.click(previousButton()); });
    expect(readPopupPipState()?.video.postId).toBe('anchor');
    expect(mockNext.mock.calls.length).toBe(callsBefore);
  });

  it('is disabled at the start of history', async () => {
    openOn(videoPost('anchor'));
    render(<PopupPipPlayer />);
    expect(previousButton()).toBeDisabled();
  });

  it('stepping back then forward replays the same post instead of recomputing', async () => {
    openOn(videoPost('anchor'));
    mockNext.mockResolvedValueOnce({ data: { postId: 'v1' } });
    mockFindOne.mockImplementation((id: string) => Promise.resolve({ data: videoPost(id) }));

    render(<PopupPipPlayer />);
    await pressNext();
    await act(async () => { fireEvent.click(previousButton()); });
    expect(readPopupPipState()?.video.postId).toBe('anchor');

    const callsBefore = mockNext.mock.calls.length;
    await pressNext();

    expect(readPopupPipState()?.video.postId).toBe('v1');
    expect(mockNext.mock.calls.length).toBe(callsBefore);
  });
});

describe('PiP state carried across a track change', () => {
  it('keeps the recommendation session, so the next step still excludes what was shown', async () => {
    openOn(videoPost('anchor'));
    mockNext
      .mockResolvedValueOnce({ data: { postId: 'v1' } })
      .mockResolvedValueOnce({ data: { postId: 'v2' } });
    mockFindOne.mockImplementation((id: string) => Promise.resolve({ data: videoPost(id) }));

    render(<PopupPipPlayer />);
    await pressNext();
    expect(readPopupPipState()?.sessionId).toBe('detail-session-1');

    await pressNext();
    // One session for the whole PiP browse: opening a second would reset the
    // exclusions and start recommending posts already in this history.
    expect(mockOpenSession).toHaveBeenCalledTimes(1);
  });

  it('re-opening PiP on the video already playing keeps the history and session', async () => {
    openOn(videoPost('anchor'));
    mockNext.mockResolvedValueOnce({ data: { postId: 'v1' } });
    mockFindOne.mockImplementation((id: string) => Promise.resolve({ data: videoPost(id) }));

    render(<PopupPipPlayer />);
    await pressNext();

    const before = readPopupPipState()!;
    openOn(videoPost('v1'));
    const after = readPopupPipState()!;

    expect(after.history.map((item) => item.postId)).toEqual(before.history.map((item) => item.postId));
    expect(after.sessionId).toBe('detail-session-1');
  });

  it('reads an older stored state that still has a playlist and no history', () => {
    // A PiP window open across a deploy. Whatever that list held, the viewer
    // has only actually watched what is playing, so history rebuilds from it.
    window.localStorage.setItem('douyin-clone-popup-pip-state', JSON.stringify({
      active: true,
      video: { videoId: 'home-feed-legacy', src: 'https://media.test/legacy.mp4' },
      playlist: [
        { videoId: 'home-feed-legacy', src: 'https://media.test/legacy.mp4' },
        { videoId: 'home-feed-other', src: 'https://media.test/other.mp4' }
      ]
    }));

    const state = readPopupPipState()!;
    expect(state.video.postId).toBe('legacy');
    expect(state.history.map((item) => item.postId)).toEqual(['legacy']);
    expect(state.historyIndex).toBe(0);
    expect(state.sessionId).toBeNull();
  });

  it('survives a state write that carries no video', () => {
    writePopupPipState(null);
    expect(readPopupPipState()).toBeNull();
  });
});
