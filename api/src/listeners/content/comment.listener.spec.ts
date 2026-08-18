import { ObjectId } from 'mongodb';
import { EVENT } from 'src/kernel/constants';

import { CommentContentListener } from './comment.listener';

/**
 * The post's authoritative comment counter.
 *
 * The delete path is the dangerous one: it subtracts the comment plus the
 * replies that go with it, and an absent `totalReply` used to turn that
 * subtraction into NaN, which collapsed the whole counter to 0.
 */
function createSubject(options: { parentComment?: any } = {}) {
  const queueMessageService = { subscribe: jest.fn() };
  const postService = { updateCommentCount: jest.fn().mockResolvedValue(undefined) };
  const commentService = {
    findById: jest.fn().mockResolvedValue(options.parentComment ?? null)
  };

  const listener = new CommentContentListener(
    queueMessageService as any,
    postService as any,
    commentService as any
  );

  return { listener, postService, commentService };
}

const postId = new ObjectId().toString();

const event = (eventName: string, data: Record<string, any>) => (
  { data: { eventName, data } } as any
);

/** The increment argument passed to the post service. */
const increment = (postService: any, call = 0) => postService.updateCommentCount.mock.calls[call][1];

describe('post comment counter', () => {
  it('adds one for a new top-level comment', async () => {
    const { listener, postService } = createSubject();

    await listener.handleComment(event(EVENT.CREATED, { objectId: postId, objectType: 'post' }));

    expect(postService.updateCommentCount).toHaveBeenCalledWith(postId, 1);
  });

  it('adds one for a reply, since replies count toward the post total', async () => {
    const rootId = new ObjectId().toString();
    const { listener, postService } = createSubject({
      parentComment: { _id: rootId, objectId: postId, objectType: 'post' }
    });

    await listener.handleComment(event(EVENT.CREATED, {
      objectId: rootId, objectType: 'comment'
    }));

    expect(postService.updateCommentCount).toHaveBeenCalledWith(postId, 1);
  });

  it('subtracts exactly one for a comment that has no replies', async () => {
    const { listener, postService } = createSubject();

    // A comment that never had a reply carries no `totalReply` field at all.
    await listener.handleComment(event(EVENT.DELETED, {
      objectId: postId, objectType: 'post'
    }));

    // `-(1 + undefined)` is NaN, and `$max: [0, NaN]` resolved to 0 — one
    // deletion silently zeroed the post's entire comment count.
    expect(increment(postService)).toBe(-1);
    expect(Number.isNaN(increment(postService))).toBe(false);
  });

  it('subtracts the comment and its replies together', async () => {
    const { listener, postService } = createSubject();

    await listener.handleComment(event(EVENT.DELETED, {
      objectId: postId, objectType: 'post', totalReply: 3
    }));

    expect(increment(postService)).toBe(-4);
  });

  it('treats an explicit zero reply count the same as none', async () => {
    const { listener, postService } = createSubject();

    await listener.handleComment(event(EVENT.DELETED, {
      objectId: postId, objectType: 'post', totalReply: 0
    }));

    expect(increment(postService)).toBe(-1);
  });

  it('subtracts one for a deleted reply', async () => {
    const rootId = new ObjectId().toString();
    const { listener, postService } = createSubject({
      parentComment: { _id: rootId, objectId: postId, objectType: 'post' }
    });

    await listener.handleComment(event(EVENT.DELETED, {
      objectId: rootId, objectType: 'comment'
    }));

    expect(postService.updateCommentCount).toHaveBeenCalledWith(postId, -1);
  });

  it('never sends a NaN adjustment, whatever the payload carries', async () => {
    const { listener, postService } = createSubject();

    await listener.handleComment(event(EVENT.DELETED, {
      objectId: postId, objectType: 'post', totalReply: undefined
    }));
    await listener.handleComment(event(EVENT.DELETED, {
      objectId: postId, objectType: 'post', totalReply: null
    }));

    postService.updateCommentCount.mock.calls.forEach(([, value]: [string, number]) => {
      expect(Number.isFinite(value)).toBe(true);
    });
  });

  it('ignores events that are neither creation nor deletion', async () => {
    const { listener, postService } = createSubject();

    await listener.handleComment(event(EVENT.UPDATED, { objectId: postId, objectType: 'post' }));

    expect(postService.updateCommentCount).not.toHaveBeenCalled();
  });

  it('does not touch a post when the reply thread cannot be resolved', async () => {
    const { listener, postService } = createSubject({ parentComment: null });

    await listener.handleComment(event(EVENT.CREATED, {
      objectId: new ObjectId().toString(), objectType: 'comment'
    }));

    expect(postService.updateCommentCount).not.toHaveBeenCalled();
  });
});
