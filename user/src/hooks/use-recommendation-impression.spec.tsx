import { act, render } from '@testing-library/react';
import React, { useRef } from 'react';

import { useRecommendationImpression } from './use-recommendation-impression';

const mockEnqueue = jest.fn();
jest.mock('../lib/recommendation-event-queue', () => ({
  enqueueRecommendationEvent: (...args: any[]) => mockEnqueue(...args)
}));

let observerInstances: FakeIntersectionObserver[] = [];

class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    observerInstances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  trigger(isIntersecting: boolean, intersectionRatio: number) {
    this.callback([{ isIntersecting, intersectionRatio } as IntersectionObserverEntry], this as any);
  }
}

function Probe({
  enabled = true, postId = 'post-1', sessionId = 'sess-1', source = 'home' as const
}) {
  const ref = useRef<HTMLDivElement>(null);
  useRecommendationImpression({
    elementRef: ref, enabled, postId, sessionId, source
  });
  return <div ref={ref} />;
}

describe('useRecommendationImpression', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockEnqueue.mockReset();
    observerInstances = [];
    (global as any).IntersectionObserver = FakeIntersectionObserver;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires impression only after the element is visible >=50% for >=1s', () => {
    render(<Probe />);
    const observer = observerInstances[0];

    act(() => { observer.trigger(true, 0.5); });
    expect(mockEnqueue).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(999); });
    expect(mockEnqueue).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(1); });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith({
      postId: 'post-1', sessionId: 'sess-1', eventType: 'impression', source: 'home'
    });
  });

  it('does not count a fast scroll-past below the dwell threshold', () => {
    render(<Probe />);
    const observer = observerInstances[0];

    act(() => { observer.trigger(true, 0.6); });
    act(() => { jest.advanceTimersByTime(400); });
    act(() => { observer.trigger(false, 0); }); // scrolled away before 1s
    act(() => { jest.advanceTimersByTime(2000); });

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('does not count visibility below the 50% ratio threshold', () => {
    render(<Probe />);
    const observer = observerInstances[0];

    act(() => { observer.trigger(true, 0.2); }); // barely visible, below threshold
    act(() => { jest.advanceTimersByTime(2000); });

    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('fires only once per (session, post) exposure even if visibility toggles repeatedly', () => {
    render(<Probe />);
    const observer = observerInstances[0];

    act(() => { observer.trigger(true, 0.6); });
    act(() => { jest.advanceTimersByTime(1000); });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);

    // Observer disconnects after firing, so no further triggers are possible,
    // but simulate a stray callback anyway to be defensive.
    act(() => { observer.trigger(true, 0.6); });
    act(() => { jest.advanceTimersByTime(2000); });
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled (e.g. a creator-profile card, not a recommendation surface)', () => {
    render(<Probe enabled={false} />);
    expect(observerInstances).toHaveLength(0);
  });

  it('does nothing without an active session', () => {
    render(<Probe sessionId={null as any} />);
    expect(observerInstances).toHaveLength(0);
  });

  it('cleans up the observer and pending timer on unmount', () => {
    const { unmount } = render(<Probe />);
    const observer = observerInstances[0];
    act(() => { observer.trigger(true, 0.6); });

    unmount();
    act(() => { jest.advanceTimersByTime(2000); });

    expect(observer.disconnected).toBe(true);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
