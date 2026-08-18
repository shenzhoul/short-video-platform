import { act, render } from '@testing-library/react';
import React from 'react';

import { LIVE_COMMENT_POLICY, usePostLiveComments } from './use-post-live-comments';

/**
 * The hybrid incoming-comment rules: absorb quietly when that is safe, queue
 * behind a count otherwise, and never let a viral post insert rows unbounded.
 */

const handlers = new Map<string, (payload: any) => void>();
jest.mock('src/socket/use-socket-listener', () => ({
  useSocketListener: (event: string, handler: (payload: any) => void, options: any) => {
    if (options?.enabled !== false) handlers.set(event, handler);
  }
}));

const onInsert = jest.fn();
const onRemove = jest.fn();
let pendingCount = 0;
let revealPending: () => void = () => undefined;

function Probe({ atNewest, postId = 'p1' }: { atNewest: boolean; postId?: string | null }) {
  const live = usePostLiveComments({
    postId, atNewest, onInsert, onRemove
  });
  pendingCount = live.pendingCount;
  revealPending = live.revealPending;
  return null;
}

function deliver(event: string, payload: any) {
  act(() => { handlers.get(event)?.(payload); });
}

function comment(id: string) {
  return {
    _id: id, content: `comment ${id}`, postId: 'p1'
  };
}

beforeEach(() => {
  handlers.clear();
  onInsert.mockClear();
  onRemove.mockClear();
  pendingCount = 0;
});

describe('auto-insert while the reader is at the newest comments', () => {
  it('inserts a quiet arrival directly', () => {
    render(<Probe atNewest />);

    deliver('post:comment_created', { postId: 'p1', comment: comment('c1') });

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(pendingCount).toBe(0);
  });

  it('queues once arrivals exceed the burst limit', () => {
    render(<Probe atNewest />);

    const total = LIVE_COMMENT_POLICY.AUTO_INSERT_BURST_LIMIT + 4;
    for (let index = 0; index < total; index += 1) {
      deliver('post:comment_created', { postId: 'p1', comment: comment(`c${index}`) });
    }

    // Even at the top, a busy post must not insert rows without bound.
    expect(onInsert.mock.calls.length).toBeLessThanOrEqual(
      LIVE_COMMENT_POLICY.AUTO_INSERT_BURST_LIMIT
    );
    expect(pendingCount).toBeGreaterThan(0);
    expect(onInsert.mock.calls.length + pendingCount).toBe(total);
  });
});

describe('queueing while the reader is scrolled away', () => {
  it('never inserts under a reader looking at older comments', () => {
    render(<Probe atNewest={false} />);

    deliver('post:comment_created', { postId: 'p1', comment: comment('c1') });
    deliver('post:comment_created', { postId: 'p1', comment: comment('c2') });

    expect(onInsert).not.toHaveBeenCalled();
    expect(pendingCount).toBe(2);
  });

  it('reveals exactly what was counted, oldest first', () => {
    render(<Probe atNewest={false} />);
    deliver('post:comment_created', { postId: 'p1', comment: comment('c1') });
    deliver('post:comment_created', { postId: 'p1', comment: comment('c2') });

    act(() => revealPending());

    // The count shown and the rows revealed always match.
    expect(onInsert.mock.calls.map(([item]) => item._id)).toEqual(['c1', 'c2']);
    expect(pendingCount).toBe(0);
  });
});

describe('deduplication and scoping', () => {
  it('ignores a redelivered comment', () => {
    render(<Probe atNewest />);
    const payload = { postId: 'p1', comment: comment('c1') };

    deliver('post:comment_created', payload);
    deliver('post:comment_created', payload);

    // Queue jobs retry; the reader must not see the comment twice.
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it('ignores events for a different post', () => {
    render(<Probe atNewest />);

    deliver('post:comment_created', { postId: 'other', comment: comment('c1') });

    expect(onInsert).not.toHaveBeenCalled();
    expect(pendingCount).toBe(0);
  });

  it('subscribes to nothing when no post is open', () => {
    render(<Probe atNewest postId={null} />);
    expect(handlers.size).toBe(0);
  });
});

describe('deletions apply immediately', () => {
  it('removes a deleted comment even while the reader is scrolled away', () => {
    render(<Probe atNewest={false} />);

    deliver('post:comment_deleted', { postId: 'p1', commentId: 'c9' });

    // Removing a row cannot push content under the reader, and leaving a
    // deleted comment on screen is worse than a small reflow.
    expect(onRemove).toHaveBeenCalledWith('c9');
  });

  it('drops a queued comment that was deleted before being revealed', () => {
    render(<Probe atNewest={false} />);
    deliver('post:comment_created', { postId: 'p1', comment: comment('c1') });
    expect(pendingCount).toBe(1);

    deliver('post:comment_deleted', { postId: 'p1', commentId: 'c1' });

    expect(pendingCount).toBe(0);
  });

  it('ignores a deletion for another post', () => {
    render(<Probe atNewest />);
    deliver('post:comment_deleted', { postId: 'other', commentId: 'c9' });
    expect(onRemove).not.toHaveBeenCalled();
  });
});

describe('replies', () => {
  it('does not displace the list for a reply', () => {
    render(<Probe atNewest />);

    deliver('post:reply_created', { postId: 'p1', rootId: 'c1', reply: comment('r1') });

    // Replies live inside a collapsed thread, so they never move the list.
    expect(onInsert).not.toHaveBeenCalled();
    expect(pendingCount).toBe(0);
  });
});
