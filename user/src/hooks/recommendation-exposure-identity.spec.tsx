import { act, render } from '@testing-library/react';

import { useRecommendationPhotoDwell } from './use-recommendation-photo-dwell';

const enqueue = jest.fn();
jest.mock('../lib/recommendation-event-queue', () => ({
  enqueueRecommendationEvent: (...args: unknown[]) => enqueue(...args)
}));

/**
 * One exposure produces one event, however many handlers observe it.
 *
 * ## The defect
 *
 * The review API's own log carried 19 real duplicate-key rejections over 74
 * minutes of ordinary use — 9 `photo_dwell`, 7 `final_watch`, 3 `detail_open`.
 * Every one was two emissions of a single identity landing in the same batch:
 * the visibility handler and the unmount cleanup each sent their own slice of
 * the same dwell, and a layout remount re-announced a detail open the viewer
 * had never left.
 *
 * The unique index caught them, which is what it is for. What was wrong is that
 * they were emitted at all.
 */
function DwellHarness({ postId, sessionId, enabled = true }: {
  postId: string; sessionId: string; enabled?: boolean;
}) {
  useRecommendationPhotoDwell({
    enabled, postId, sessionId, source: 'post-detail'
  });
  return null;
}

const hide = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const show = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('photo dwell is one event per exposure', () => {
  beforeEach(() => {
    enqueue.mockClear();
    jest.useFakeTimers();
    show();
  });
  afterEach(() => {
    jest.useRealTimers();
    show();
  });

  it('hiding the tab banks the time but sends nothing', () => {
    render(<DwellHarness postId="P1" sessionId="S1" />);
    act(() => { jest.advanceTimersByTime(1000); });
    act(() => hide());
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('hide, return, then close sends exactly one dwell covering both spans', () => {
    const view = render(<DwellHarness postId="P1" sessionId="S1" />);
    act(() => { jest.advanceTimersByTime(1000); });
    act(() => hide());
    act(() => { jest.advanceTimersByTime(5000); });   // away — not counted
    act(() => show());
    act(() => { jest.advanceTimersByTime(2000); });
    view.unmount();

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [event] = enqueue.mock.calls[0];
    expect(event.eventType).toBe('photo_dwell');
    expect(event.postId).toBe('P1');
    // Both visible spans, and not the time spent hidden.
    expect(event.dwellMs).toBeGreaterThanOrEqual(3000);
    expect(event.dwellMs).toBeLessThan(5000);
  });

  it('several hide/return cycles still send one event', () => {
    const view = render(<DwellHarness postId="P1" sessionId="S1" />);
    for (let i = 0; i < 4; i += 1) {
      act(() => { jest.advanceTimersByTime(500); });
      act(() => hide());
      act(() => show());
    }
    act(() => { jest.advanceTimersByTime(500); });
    view.unmount();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('a genuinely new exposure reports again', () => {
    const view = render(<DwellHarness postId="P1" sessionId="S1" />);
    act(() => { jest.advanceTimersByTime(1000); });
    view.rerender(<DwellHarness postId="P2" sessionId="S1" />);
    act(() => { jest.advanceTimersByTime(1000); });
    view.unmount();

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls[0][0].postId).toBe('P1');
    expect(enqueue.mock.calls[1][0].postId).toBe('P2');
  });

  it('the same post in a new session is a new exposure', () => {
    const view = render(<DwellHarness postId="P1" sessionId="S1" />);
    act(() => { jest.advanceTimersByTime(1000); });
    view.rerender(<DwellHarness postId="P1" sessionId="S2" />);
    act(() => { jest.advanceTimersByTime(1000); });
    view.unmount();
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('an exposure with no elapsed time sends nothing', () => {
    const view = render(<DwellHarness postId="P1" sessionId="S1" />);
    view.unmount();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('a disabled hook never reports', () => {
    const view = render(<DwellHarness postId="P1" sessionId="S1" enabled={false} />);
    act(() => { jest.advanceTimersByTime(3000); });
    view.unmount();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
