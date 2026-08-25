import { ObjectId } from 'mongodb';
import { REACTION_CHANNELS } from 'src/common/constants/community';
import { EVENT } from 'src/kernel/constants';

import { ReactionCommentListener } from './comment-reaction.listener';
import { ReplyCommentListener } from './comment-reply.listener';

/**
 * Ordering between the counter write and the snapshot mark.
 *
 * The mark has to happen *after* the counter moves. Marking first leaves a
 * window where a flush reads the pre-increment total and publishes it as final —
 * and with no further mutation coming, that stale number is the last thing every
 * viewer sees. Ordering is the whole reason these marks live beside the writes
 * instead of in a second subscriber on the same channel.
 */
describe('comment counter marking', () => {
  const commentId = new ObjectId();

  describe('likes', () => {
    function createSubject() {
      const order: string[] = [];
      const CommentModel = {
        findById: jest.fn().mockResolvedValue({ _id: commentId }),
        updateOne: jest.fn(async () => {
          order.push('increment');
          return { modifiedCount: 1 };
        })
      };
      const queueMessageService = { subscribe: jest.fn() };
      const coalescer = {
        markDirty: jest.fn(async () => {
          order.push('mark');
        })
      };

      const listener = new ReactionCommentListener(
        CommentModel as any,
        queueMessageService as any,
        coalescer as any
      );

      return {
        listener, CommentModel, coalescer, order, queueMessageService
      };
    }

    const likeEvent = (eventName: string) => ({
      data: {
        eventName,
        data: { objectId: commentId, objectType: 'comment', action: 'like' }
      }
    }) as any;

    it('marks the comment dirty only after the like has been counted', async () => {
      const { listener, coalescer, order } = createSubject();

      await listener.handleReactComment(likeEvent(EVENT.CREATED));

      expect(coalescer.markDirty).toHaveBeenCalledWith(commentId);
      expect(order).toEqual(['increment', 'mark']);
    });

    it('marks on an unlike too, so the count comes back down live', async () => {
      const { listener, coalescer, order } = createSubject();

      await listener.handleReactComment(likeEvent(EVENT.DELETED));

      expect(coalescer.markDirty).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['increment', 'mark']);
    });

    it('ignores a reaction on something that is not a comment', async () => {
      const { listener, coalescer } = createSubject();

      await listener.handleReactComment({
        data: {
          eventName: EVENT.CREATED,
          data: { objectId: new ObjectId(), objectType: 'post', action: 'like' }
        }
      } as any);

      expect(coalescer.markDirty).not.toHaveBeenCalled();
    });

    it('subscribes to the reaction channel under its own topic', () => {
      const { queueMessageService } = createSubject();

      expect(queueMessageService.subscribe).toHaveBeenCalledWith(
        REACTION_CHANNELS.REACTION,
        'REACTION_COMMENT_TOPIC',
        expect.any(Function)
      );
    });
  });

  describe('replies', () => {
    function createSubject() {
      const order: string[] = [];
      const commentService = {
        incrementReplyCount: jest.fn(async () => {
          order.push('increment');
        })
      };
      const coalescer = {
        markDirty: jest.fn(async () => {
          order.push('mark');
        })
      };
      const listener = new ReplyCommentListener(
        { subscribe: jest.fn() } as any,
        commentService as any,
        coalescer as any
      );

      return {
        listener, commentService, coalescer, order
      };
    }

    const replyEvent = (eventName: string) => ({
      data: { eventName, data: { objectId: commentId, objectType: 'comment' } }
    }) as any;

    it('marks the parent dirty after its reply count moves', async () => {
      const { listener, coalescer, order } = createSubject();

      await listener.handleReplyComment(replyEvent(EVENT.CREATED));

      // This is what moves "Expand N replies" for a viewer with the thread
      // collapsed, without sending them the reply itself.
      expect(coalescer.markDirty).toHaveBeenCalledWith(commentId);
      expect(order).toEqual(['increment', 'mark']);
    });

    it('marks on a deleted reply too', async () => {
      const { listener, commentService, coalescer } = createSubject();

      await listener.handleReplyComment(replyEvent(EVENT.DELETED));

      expect(commentService.incrementReplyCount).toHaveBeenCalledWith(commentId, -1);
      expect(coalescer.markDirty).toHaveBeenCalledTimes(1);
    });

    it('ignores a top-level comment, which has no parent to count', async () => {
      const { listener, coalescer } = createSubject();

      await listener.handleReplyComment({
        data: { eventName: EVENT.CREATED, data: { objectId: new ObjectId(), objectType: 'post' } }
      } as any);

      expect(coalescer.markDirty).not.toHaveBeenCalled();
    });
  });
});
