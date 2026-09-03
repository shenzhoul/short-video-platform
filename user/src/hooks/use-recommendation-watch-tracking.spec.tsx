import { act, render } from '@testing-library/react';
import React from 'react';

import { useRecommendationWatchTracking } from './use-recommendation-watch-tracking';

const mockEnqueue = jest.fn();
jest.mock('../lib/recommendation-event-queue', () => ({
  enqueueRecommendationEvent: (...args: any[]) => mockEnqueue(...args)
}));

let latest: ReturnType<typeof useRecommendationWatchTracking>;

function Probe({ postId = 'post-1', sessionId = 'sess-1' as string | null }) {
  latest = useRecommendationWatchTracking({
    enabled: true, postId, sessionId, source: 'for-you'
  });
  return null;
}

describe('useRecommendationWatchTracking', () => {
  beforeEach(() => {
    mockEnqueue.mockReset();
  });

  it('sends nothing if the video never actually started (no progress observed)', () => {
    const { unmount } = render(<Probe />);
    act(() => { latest.handlePause(); });
    unmount();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('sends final_watch on pause once playback has started', () => {
    render(<Probe />);
    act(() => { latest.handleTimeUpdate(2, 10); });
    act(() => { latest.handlePause(); });

    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'final_watch', watchMs: 2000, durationMs: 10000
    }));
  });

  it('sends completion once ratio crosses 90%, and does not resend it on further progress', () => {
    render(<Probe />);
    act(() => { latest.handleTimeUpdate(5, 10); });
    expect(mockEnqueue).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'completion' }));

    act(() => { latest.handleTimeUpdate(9.2, 10); });
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'completion', watchMs: 9200 }));

    mockEnqueue.mockClear();
    act(() => { latest.handleTimeUpdate(9.5, 10); });
    expect(mockEnqueue).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'completion' }));
  });

  it('detects a replay: reaching near the end then jumping back near the start', () => {
    render(<Probe />);
    act(() => { latest.handleTimeUpdate(9.3, 10); }); // near end
    act(() => { latest.handleTimeUpdate(0.5, 10); }); // jump back to start

    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'replay' }));
  });

  it('does not classify a short video watched mostly through as a low-signal exposure', () => {
    // A 2-second video watched to 1.8s: tiny absolute watch time, high ratio.
    // The hook itself does not classify quick-skip at all (the server does,
    // from watchMs/durationMs) — this test documents that final_watch still
    // carries the numbers that make that server-side classification correct.
    render(<Probe />);
    act(() => { latest.handleTimeUpdate(1.8, 2); });
    act(() => { latest.flushFinalWatch(); });

    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'final_watch', watchMs: 1800, durationMs: 2000
    }));
  });

  it('never sends a standalone quick_skip event from this hook', () => {
    render(<Probe />);
    act(() => { latest.handleTimeUpdate(0.1, 10); }); // started, barely watched
    act(() => { latest.handlePause(); });

    expect(mockEnqueue).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'quick_skip' }));
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'final_watch' }));
  });

  it('flushes the outgoing exposure exactly once when the post changes, and resets for the new one', () => {
    const { rerender } = render(<Probe postId="post-1" />);
    act(() => { latest.handleTimeUpdate(4, 10); });

    rerender(<Probe postId="post-2" />);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ postId: 'post-1', eventType: 'final_watch' }));

    mockEnqueue.mockClear();
    // New exposure has its own clean accumulator — pausing immediately with
    // no progress sends nothing.
    act(() => { latest.handlePause(); });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('flushes on unmount', () => {
    const { unmount } = render(<Probe />);
    act(() => { latest.handleTimeUpdate(3, 10); });
    unmount();
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'final_watch', watchMs: 3000 }));
  });

  it('does not track without an active session', () => {
    render(<Probe sessionId={null} />);
    act(() => { latest.handleTimeUpdate(5, 10); });
    act(() => { latest.handlePause(); });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('sends a second, larger final_watch after pause -> resume -> pause again (rules/instructions §1.1/§1.4)', () => {
    render(<Probe />);
    act(() => { latest.handleTimeUpdate(2, 10); });
    act(() => { latest.handlePause(); }); // first pause: flushes 2000ms
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'final_watch', watchMs: 2000 }));

    mockEnqueue.mockClear();
    act(() => { latest.handleTimeUpdate(8, 10); }); // resumed, watched further
    act(() => { latest.handlePause(); }); // second pause: must flush the improved watch, not be swallowed

    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'final_watch', watchMs: 8000 }));
  });

  it('does not resend a redundant final_watch when no new progress happened since the last flush', () => {
    render(<Probe />);
    act(() => { latest.handleTimeUpdate(6, 10); });
    act(() => { latest.handlePause(); });
    mockEnqueue.mockClear();

    // Paused again with no intervening progress (e.g. a stray extra pause event).
    act(() => { latest.handlePause(); });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('attaches a stable clientExposureId to a replay event', () => {
    render(<Probe />);
    act(() => { latest.handleTimeUpdate(9.3, 10); });
    act(() => { latest.handleTimeUpdate(0.5, 10); });

    const replayCall = mockEnqueue.mock.calls.find((call) => call[0].eventType === 'replay');
    expect(replayCall?.[0].clientExposureId).toEqual(expect.any(String));
    expect(replayCall?.[0].clientExposureId.length).toBeGreaterThan(0);
  });

  it('gives two distinct replay crossings two different clientExposureIds', () => {
    render(<Probe />);
    act(() => { latest.handleTimeUpdate(9.3, 10); });
    act(() => { latest.handleTimeUpdate(0.5, 10); }); // replay #1

    act(() => { latest.handleTimeUpdate(9.4, 10); });
    act(() => { latest.handleTimeUpdate(0.2, 10); }); // replay #2

    const replayCalls = mockEnqueue.mock.calls.filter((call) => call[0].eventType === 'replay');
    expect(replayCalls).toHaveLength(2);
    expect(replayCalls[0][0].clientExposureId).not.toEqual(replayCalls[1][0].clientExposureId);
  });
});
