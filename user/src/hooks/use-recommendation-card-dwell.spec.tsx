import { act, render } from '@testing-library/react';
import React, { useRef } from 'react';

import { useRecommendationCardDwell } from './use-recommendation-card-dwell';

const mockEnqueue = jest.fn();
jest.mock('../lib/recommendation-event-queue', () => ({
  enqueueRecommendationEvent: (...args: any[]) => mockEnqueue(...args)
}));

let observerInstances: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  disconnected = false;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observerInstances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true; }
  trigger(isIntersecting: boolean, intersectionRatio: number) {
    this.callback([{ isIntersecting, intersectionRatio } as IntersectionObserverEntry], this as any);
  }
}

function Probe({ postId = 'post-1' }) {
  const ref = useRef<HTMLDivElement>(null);
  useRecommendationCardDwell({
    elementRef: ref, enabled: true, postId, sessionId: 'sess-1', source: 'home'
  });
  return <div ref={ref} />;
}

describe('useRecommendationCardDwell', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockEnqueue.mockReset();
    observerInstances = [];
    (global as any).IntersectionObserver = FakeIntersectionObserver;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accumulates dwell across multiple visibility bouts and flushes the total on unmount', () => {
    const { unmount } = render(<Probe />);
    const observer = observerInstances[0];

    act(() => { observer.trigger(true, 0.6); });
    act(() => { jest.advanceTimersByTime(1000); });
    act(() => { observer.trigger(false, 0); }); // scrolled away

    act(() => { jest.advanceTimersByTime(5000); }); // time passes off-screen, must not count
    act(() => { observer.trigger(true, 0.6); }); // scrolled back
    act(() => { jest.advanceTimersByTime(500); });

    unmount();

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const dwellMs = mockEnqueue.mock.calls[0][0].dwellMs;
    expect(dwellMs).toBeGreaterThanOrEqual(1400);
    expect(dwellMs).toBeLessThan(2000); // must not include the 5s off-screen gap
  });

  it('sends nothing if the card was never visible', () => {
    const { unmount } = render(<Probe />);
    act(() => { jest.advanceTimersByTime(3000); });
    unmount();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
