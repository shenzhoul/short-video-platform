const mockRecordRecommendationEvents = jest.fn();
jest.mock('@services/post.service', () => ({
  recordRecommendationEvents: (...args: any[]) => mockRecordRecommendationEvents(...args)
}));
jest.mock('@services/api-request', () => ({
  getBaseApiEndpoint: () => '/api/v1',
  TOKEN: 'token'
}));
jest.mock('js-cookie', () => ({ get: jest.fn(() => 'test-token') }));
jest.mock('./recommendation-anonymous-id', () => ({
  getRecommendationAnonymousId: () => 'anon-123'
}));

import {
__resetRecommendationEventQueueForTests,
  enqueueRecommendationEvent, flush, flushOnUnload } from './recommendation-event-queue';

function event(overrides: Partial<Parameters<typeof enqueueRecommendationEvent>[0]> = {}) {
  return {
    postId: 'post-1', sessionId: 'sess-1', eventType: 'impression' as const, source: 'home' as const, ...overrides
  };
}

describe('recommendation event queue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRecordRecommendationEvents.mockReset();
    mockRecordRecommendationEvents.mockResolvedValue({});
    __resetRecommendationEventQueueForTests();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('batches events and flushes once after the interval instead of one call per event', async () => {
    enqueueRecommendationEvent(event({ postId: 'post-1' }));
    enqueueRecommendationEvent(event({ postId: 'post-2' }));
    enqueueRecommendationEvent(event({ postId: 'post-3' }));

    expect(mockRecordRecommendationEvents).not.toHaveBeenCalled();

    jest.advanceTimersByTime(4000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRecordRecommendationEvents).toHaveBeenCalledTimes(1);
    const [events] = mockRecordRecommendationEvents.mock.calls[0];
    expect(events).toHaveLength(3);
  });

  it('flushes immediately once the batch reaches the configured max size', async () => {
    for (let i = 0; i < 20; i += 1) {
      enqueueRecommendationEvent(event({ postId: `post-${i}` }));
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRecordRecommendationEvents).toHaveBeenCalledTimes(1);
    expect(mockRecordRecommendationEvents.mock.calls[0][0]).toHaveLength(20);
  });

  it('requeues events for a later retry when the flush fails, and eventually sends them', async () => {
    mockRecordRecommendationEvents.mockRejectedValueOnce(new Error('network down'));
    mockRecordRecommendationEvents.mockResolvedValueOnce({});

    enqueueRecommendationEvent(event());
    jest.advanceTimersByTime(4000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRecordRecommendationEvents).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(4000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRecordRecommendationEvents).toHaveBeenCalledTimes(2);
  });

  it('never throws out of enqueue even if the underlying request rejects', async () => {
    mockRecordRecommendationEvents.mockRejectedValue(new Error('boom'));
    expect(() => enqueueRecommendationEvent(event())).not.toThrow();
    jest.advanceTimersByTime(4000);
    await Promise.resolve();
    await Promise.resolve();
    // No unhandled rejection / throw reaches the caller.
  });

  it('flushOnUnload sends a keepalive fetch carrying the auth header, not sendBeacon', () => {
    enqueueRecommendationEvent(event());
    flushOnUnload();

    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('/api/v1/posts/recommendation-events');
    expect(init.keepalive).toBe(true);
    expect(init.headers.Authorization).toBe('test-token');
    const body = JSON.parse(init.body);
    expect(body.events).toHaveLength(1);
    expect(body.anonymousId).toBe('anon-123');
  });

  it('flushOnUnload does nothing when the queue is empty', () => {
    flushOnUnload();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('flush() is a no-op when nothing is queued', async () => {
    await flush();
    expect(mockRecordRecommendationEvents).not.toHaveBeenCalled();
  });
});
