import { act, render } from '@testing-library/react';
import React from 'react';

import { useRecommendationDetailTracking } from './use-recommendation-detail-tracking';

const mockEnqueue = jest.fn();
jest.mock('../lib/recommendation-event-queue', () => ({
  enqueueRecommendationEvent: (...args: any[]) => mockEnqueue(...args)
}));

const POST = { _id: 'post-1', user: { _id: 'creator-1' } } as any;

let latest: ReturnType<typeof useRecommendationDetailTracking>;

function Probe({
  post = POST, source = 'home-feed' as any, sessionId = 'sess-1' as string | null
}) {
  latest = useRecommendationDetailTracking({ post, source, sessionId });
  return null;
}

describe('useRecommendationDetailTracking', () => {
  beforeEach(() => {
    mockEnqueue.mockReset();
  });

  it('reports detail_open once for a post/session pair', () => {
    const { rerender } = render(<Probe />);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'detail_open', postId: 'post-1', sessionId: 'sess-1', source: 'post-detail'
    }));

    mockEnqueue.mockClear();
    rerender(<Probe />);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('reports for-you events under the for-you source, continuing that feed session', () => {
    render(<Probe source="for-you" />);
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'detail_open', source: 'for-you'
    }));
  });

  describe('comment attribution (rules/instructions §2)', () => {
    it('sends one comment event carrying the real commentId when a comment was genuinely created', () => {
      render(<Probe />);
      mockEnqueue.mockClear();

      act(() => { latest.trackCommentCreate({ _id: 'comment-abc' } as any); });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith({
        postId: 'post-1',
        sessionId: 'sess-1',
        eventType: 'comment',
        source: 'post-detail',
        commentId: 'comment-abc'
      });
    });

    it('attributes a reply to the POST it belongs to, once — not to the parent comment, and not twice', () => {
      // The hook is mounted for the post; a reply's own id is what comes back
      // from `CommentWrapper.onCommentCreate`, and the server resolves it to
      // this post through the parent. One call in, one event out.
      render(<Probe />);
      mockEnqueue.mockClear();

      act(() => { latest.trackCommentCreate({ _id: 'reply-xyz' } as any); });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({
        postId: 'post-1', eventType: 'comment', commentId: 'reply-xyz'
      }));
    });

    it('sends nothing when the create did not actually produce a comment (auth modal, validation failure)', () => {
      render(<Probe />);
      mockEnqueue.mockClear();

      act(() => { latest.trackCommentCreate(null); });
      act(() => { latest.trackCommentCreate(undefined); });
      act(() => { latest.trackCommentCreate({} as any); });

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('sends nothing without an active recommendation session (creator-scoped / following sources)', () => {
      render(<Probe sessionId={null} />);
      mockEnqueue.mockClear();

      act(() => { latest.trackCommentCreate({ _id: 'comment-abc' } as any); });

      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  it('reports a like only on liking, never on unliking, and still calls the real handler either way', () => {
    const original = jest.fn();
    render(<Probe />);
    mockEnqueue.mockClear();

    act(() => { latest.trackLikeChange(original)(false, 4); });
    expect(original).toHaveBeenCalledWith(false, 4);
    expect(mockEnqueue).not.toHaveBeenCalled();

    act(() => { latest.trackLikeChange(original)(true, 5); });
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'like' }));
  });

  it('reports follow_after_view only for this post\'s own creator', () => {
    render(<Probe />);
    mockEnqueue.mockClear();

    act(() => { latest.trackFollow('someone-else'); });
    expect(mockEnqueue).not.toHaveBeenCalled();

    act(() => { latest.trackFollow('creator-1'); });
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'follow_after_view' }));
  });
});
