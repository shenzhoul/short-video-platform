import { act, render } from '@testing-library/react';
import React from 'react';

import { useRecommendationPhotoDwell } from './use-recommendation-photo-dwell';

const mockEnqueue = jest.fn();
jest.mock('../lib/recommendation-event-queue', () => ({
  enqueueRecommendationEvent: (...args: any[]) => mockEnqueue(...args)
}));

function Probe({
  enabled = true, postId = 'post-1', sessionId = 'sess-1' as string | null
}) {
  useRecommendationPhotoDwell({
    enabled, postId, sessionId, source: 'for-you'
  });
  return null;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useRecommendationPhotoDwell', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockEnqueue.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    setVisibility('visible');
  });

  it('flushes accumulated dwell time on unmount', () => {
    const { unmount } = render(<Probe />);
    act(() => { jest.advanceTimersByTime(3000); });
    unmount();

    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      postId: 'post-1', sessionId: 'sess-1', eventType: 'photo_dwell', source: 'for-you'
    }));
    const call = mockEnqueue.mock.calls[0][0];
    expect(call.dwellMs).toBeGreaterThanOrEqual(2900);
  });

  it('flushes on switching to a different post and starts a fresh timer for the new one', () => {
    const { rerender } = render(<Probe postId="post-1" />);
    act(() => { jest.advanceTimersByTime(2000); });
    rerender(<Probe postId="post-2" />);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0][0].postId).toBe('post-1');

    mockEnqueue.mockClear();
    const { unmount } = render(<Probe postId="post-2" />);
    act(() => { jest.advanceTimersByTime(1000); });
    unmount();
    // The new exposure reports its own dwell, once.
    expect(mockEnqueue.mock.calls.some((c) => c[0].postId === 'post-2')).toBe(true);
    expect(mockEnqueue.mock.calls.filter((c) => c[0].postId === 'post-2')).toHaveLength(1);
  });

  it('banks dwell when the tab goes hidden without emitting, and reports once for the exposure', () => {
    const { unmount } = render(<Probe />);
    act(() => { jest.advanceTimersByTime(1500); });
    act(() => { setVisibility('hidden'); });

    // Hiding is not the end of the exposure. Emitting here *and* on unmount is
    // what sent two `photo_dwell` events for one identity — 9 of the 19 real
    // duplicate-key rejections in the review API's log.
    expect(mockEnqueue).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(5000); });  // time away, not dwell
    act(() => { setVisibility('visible'); });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(mockEnqueue).not.toHaveBeenCalled();

    unmount();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const { dwellMs } = mockEnqueue.mock.calls[0][0];
    // Both visible spans, and none of the hidden one.
    expect(dwellMs).toBeGreaterThanOrEqual(2400);
    expect(dwellMs).toBeLessThan(5000);
  });

  it('clamps an absurdly long dwell (e.g. a tab left open) to the configured maximum', () => {
    const { unmount } = render(<Probe />);
    act(() => { jest.advanceTimersByTime(10 * 60 * 1000); }); // 10 minutes
    unmount();

    expect(mockEnqueue.mock.calls[0][0].dwellMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('does nothing without an active session', () => {
    const { unmount } = render(<Probe sessionId={null} />);
    act(() => { jest.advanceTimersByTime(3000); });
    unmount();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const { unmount } = render(<Probe enabled={false} />);
    act(() => { jest.advanceTimersByTime(3000); });
    unmount();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
